import { selectRows } from "./api.js";
import { periodIsComplete } from "./analysis.js";
import { filterSignature } from "./reports.js";

const DEFAULT_FILTER_SIGNATURE = "{}";
let contextPromise = null;
let importsPromise = null;
const observationQueryCache = new Map();

function cachedQuery(key, loader) {
  if(observationQueryCache.has(key)) return observationQueryCache.get(key);
  const promise=Promise.resolve().then(loader).catch((error)=>{
    observationQueryCache.delete(key);
    throw error;
  });
  observationQueryCache.set(key,promise);
  return promise;
}

function applyDateRange(params, range = {}) {
  if (range?.startDate) params.set("period_start", `gte.${range.startDate}`);
  if (range?.endDate) params.set("period_end", `lte.${range.endDate}`);
  return params;
}

export function invalidateDataCache() {
  contextPromise = null;
  importsPromise = null;
  observationQueryCache.clear();
}

export async function loadImports() {
  if(importsPromise) return importsPromise;
  const query = new URLSearchParams({
    select: "id,source_filename,report_type,grain,report_start,report_end,report_run_date,selected_program,status,row_count,parser_version,imported_by_email,imported_at,notes,filter_context",
    order: "imported_at.desc",
    limit: "500"
  }).toString();
  importsPromise=selectRows("wnmufm_analytics_imports", query).catch((error)=>{
    importsPromise=null;
    throw error;
  });
  return importsPromise;
}

export function selectAvailableObservationRange(rows) {
  const dated = (rows || []).filter((row) =>
    row?.period_start &&
    row?.period_end &&
    row.station_value !== null &&
    row.station_value !== undefined
  );
  if (!dated.length) return { startDate:"", endDate:"" };
  return {
    startDate:dated.reduce((earliest,row) => !earliest || row.period_start < earliest ? row.period_start : earliest, ""),
    endDate:dated.reduce((latest,row) => !latest || row.period_end > latest ? row.period_end : latest, "")
  };
}

const ANOMALY_SEVERITY_RANK=Object.freeze({high:3,warning:2,info:1});

function anomalySeverityRank(value) {
  return ANOMALY_SEVERITY_RANK[String(value || "").toLowerCase()] || 0;
}

export function collapseOpenAnomalies(rows = []) {
  const grouped=new Map();
  (rows || []).forEach((row)=>{
    const anomalyKey=String(row?.anomaly_key || `id:${row?.id ?? ""}`);
    const grain=String(row?.grain || row?.evidence?.grain || "unknown");
    const key=`${anomalyKey}|grain:${grain}`;
    const existing=grouped.get(key);
    if(!existing) {
      grouped.set(key,{...row,occurrenceCount:1});
      return;
    }
    const rowRank=anomalySeverityRank(row?.severity);
    const existingRank=anomalySeverityRank(existing?.severity);
    const preferRow=rowRank>existingRank ||
      (rowRank===existingRank && String(row?.detected_at || "")>String(existing?.detected_at || ""));
    grouped.set(key,{
      ...(preferRow ? row : existing),
      occurrenceCount:Number(existing.occurrenceCount || 1)+1
    });
  });
  return [...grouped.values()].sort((a,b)=>
    anomalySeverityRank(b?.severity)-anomalySeverityRank(a?.severity) ||
    String(b?.detected_at || "").localeCompare(String(a?.detected_at || "")) ||
    String(a?.anomaly_key || "").localeCompare(String(b?.anomaly_key || ""))
  );
}

async function selectPagedRows(table, params, { pageSize=500, maxRows=10000 }={}) {
  const rows=[];
  for(let offset=0;offset<maxRows;offset+=pageSize) {
    const pageParams=new URLSearchParams(params);
    pageParams.set("limit",String(pageSize));
    pageParams.set("offset",String(offset));
    const page=await selectRows(table,pageParams.toString());
    rows.push(...page);
    if(page.length<pageSize) break;
  }
  return rows;
}

export async function loadOpenAnomalies() {
  const params = new URLSearchParams({
    select: "id,import_id,anomaly_key,grain,severity,status,title,detail,evidence,detected_at,reviewed_by_email,reviewed_at",
    status: "eq.open",
    order: "detected_at.desc"
  });
  return collapseOpenAnomalies(await selectPagedRows("wnmufm_analytics_anomalies", params));
}

export async function loadReviewedAnomalies() {
  const params = new URLSearchParams({
    select: "id,import_id,anomaly_key,grain,status,evidence,reviewed_at",
    status: "in.(expected,resolved,excluded)",
    order: "reviewed_at.desc"
  });
  return selectPagedRows("wnmufm_analytics_anomalies", params);
}

function monthStart(value) {
  return /^\d{4}-\d{2}/.test(String(value || "")) ? `${String(value).slice(0,7)}-01` : "";
}

function monthEndFromStart(value) {
  const start=monthStart(value);
  if(!start) return "";
  const date=new Date(`${start}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth()+1);
  date.setUTCDate(0);
  return date.toISOString().slice(0,10);
}

export async function loadScheduleEvidenceRange() {
  return cachedQuery("schedule-evidence-range",async ()=>{
    const queries=[
      ["wnmufm_schedule_newsletter_entries",new URLSearchParams({select:"issue_month",entry_type:"eq.monthly_grid",order:"issue_month.asc",limit:"1"}).toString()],
      ["wnmufm_schedule_newsletter_entries",new URLSearchParams({select:"issue_month",entry_type:"eq.monthly_grid",order:"issue_month.desc",limit:"1"}).toString()],
      ["wnmufm_schedule_newsletter_entries",new URLSearchParams({select:"specific_date",entry_type:"eq.dated_override",specific_date:"not.is.null",order:"specific_date.asc",limit:"1"}).toString()],
      ["wnmufm_schedule_newsletter_entries",new URLSearchParams({select:"specific_date",entry_type:"eq.dated_override",specific_date:"not.is.null",order:"specific_date.desc",limit:"1"}).toString()],
      ["wnmufm_schedule_daily_archive",new URLSearchParams({select:"capture_date",order:"capture_date.asc",limit:"1"}).toString()],
      ["wnmufm_schedule_daily_archive",new URLSearchParams({select:"capture_date",order:"capture_date.desc",limit:"1"}).toString()]
    ];
    const [gridFirst,gridLast,datedFirst,datedLast,archiveFirst,archiveLast]=await Promise.all(
      queries.map(([table,query])=>selectRows(table,query))
    );
    const starts=[
      gridFirst?.[0]?.issue_month,
      datedFirst?.[0]?.specific_date,
      archiveFirst?.[0]?.capture_date
    ].filter(Boolean).sort();
    const ends=[
      gridLast?.[0]?.issue_month ? monthEndFromStart(gridLast[0].issue_month) : "",
      datedLast?.[0]?.specific_date,
      archiveLast?.[0]?.capture_date
    ].filter(Boolean).sort();
    return {
      startDate:starts[0] || "",
      endDate:ends.at(-1) || ""
    };
  });
}

export async function loadNewsletterScheduleEvidence(range = {}) {
  const cacheKey=`newsletter-schedule|${range?.startDate || ""}|${range?.endDate || ""}`;
  return cachedQuery(cacheKey,async ()=>{
    const sourceParams=new URLSearchParams({
      select:"id,source_key,issue_month,listings_current_as_of,title,file_name,schedule_page,timezone,notes,created_at",
      order:"issue_month.asc",
      limit:"120"
    });
    const startMonth=monthStart(range?.startDate);
    const endMonth=monthStart(range?.endDate);
    if(startMonth) sourceParams.set("issue_month",`gte.${startMonth}`);
    if(endMonth) sourceParams.append("issue_month",`lte.${endMonth}`);

    const entrySelect="id,entry_key,source_id,issue_month,entry_type,specific_date,source_weekday,weekday,effective_start,effective_end,start_time,end_time,program_title,replaces_program_title,source_page,confidence,date_scope,evidence_basis,notes";
    const monthlyParams=new URLSearchParams({
      select:entrySelect,
      entry_type:"eq.monthly_grid",
      order:"issue_month.asc,weekday.asc,start_time.asc"
    });
    if(startMonth) monthlyParams.set("issue_month",`gte.${startMonth}`);
    if(endMonth) monthlyParams.append("issue_month",`lte.${endMonth}`);

    const datedParams=new URLSearchParams({
      select:entrySelect,
      entry_type:"eq.dated_override",
      order:"specific_date.asc,start_time.asc",
      limit:"1000"
    });
    if(range?.startDate) datedParams.set("specific_date",`gte.${range.startDate}`);
    if(range?.endDate) datedParams.append("specific_date",`lte.${range.endDate}`);

    const [monthSources,monthlyEntries,datedEntries]=await Promise.all([
      selectRows("wnmufm_schedule_newsletter_sources",sourceParams.toString()),
      selectPagedRows("wnmufm_schedule_newsletter_entries",monthlyParams,{pageSize:1000,maxRows:10000}),
      selectRows("wnmufm_schedule_newsletter_entries",datedParams.toString())
    ]);

    const knownSourceIds=new Set(monthSources.map((source)=>Number(source.id)));
    const missingSourceIds=[...new Set(datedEntries.map((row)=>Number(row.source_id)).filter((id)=>Number.isFinite(id) && !knownSourceIds.has(id)))];
    let extraSources=[];
    if(missingSourceIds.length) {
      const extraParams=new URLSearchParams({
        select:"id,source_key,issue_month,listings_current_as_of,title,file_name,schedule_page,timezone,notes,created_at",
        id:`in.(${missingSourceIds.join(",")})`,
        order:"issue_month.asc",
        limit:String(missingSourceIds.length)
      }).toString();
      extraSources=await selectRows("wnmufm_schedule_newsletter_sources",extraParams);
    }

    const sources=[...monthSources,...extraSources]
      .filter((source,index,list)=>list.findIndex((candidate)=>Number(candidate.id)===Number(source.id))===index)
      .sort((a,b)=>String(a.issue_month).localeCompare(String(b.issue_month)));
    return {sources,entries:[...monthlyEntries,...datedEntries]};
  });
}

function importSourceKey(item) {
  const reportType=String(item?.report_type || "");
  if(!reportType) return "";
  if(reportType==="audio_program_drilldown") {
    return `${reportType}|${String(item?.selected_program || "").trim()}`;
  }
  return reportType;
}

function importReviewScope(item) {
  const reportType=String(item?.report_type || "");
  if(!reportType) return "";
  return `${reportType}|${filterSignature(item?.filter_context || {},item?.selected_program || null)}`;
}

function importSourceGrainKey(item) {
  const reviewScope=importReviewScope(item);
  const grain=String(item?.grain || "unknown");
  return reviewScope ? `${reviewScope}|grain:${grain}` : "";
}

export function buildObservationExclusionContext(imports = [], excluded = []) {
  const runDateByImport = new Map();
  const sourceKeyByImport = new Map();
  const reviewScopeByImport = new Map();
  const sourceGrainKeyByImport = new Map();
  imports.forEach((item) => {
    const id=Number(item.id);
    runDateByImport.set(id, item.report_run_date || String(item.imported_at || "").slice(0, 10) || null);
    sourceKeyByImport.set(id,importSourceKey(item));
    reviewScopeByImport.set(id,importReviewScope(item));
    sourceGrainKeyByImport.set(id,importSourceGrainKey(item));
  });

  const excludedDatesBySource = new Map();
  excluded.forEach((item) => {
    const date=String(item?.evidence?.date || "");
    const importId=Number(item.import_id);
    const reviewScope=String(item?.evidence?.review_scope || reviewScopeByImport.get(importId) || "");
    const grain=String(item?.grain || item?.evidence?.grain || "").trim();
    const sourceGrainKey=reviewScope && grain ? `${reviewScope}|grain:${grain}` : sourceGrainKeyByImport.get(importId) || "";
    if(!date || !sourceGrainKey) return;
    if(!excludedDatesBySource.has(sourceGrainKey)) excludedDatesBySource.set(sourceGrainKey,new Set());
    excludedDatesBySource.get(sourceGrainKey).add(date);
  });

  return { imports, runDateByImport, sourceKeyByImport, reviewScopeByImport, sourceGrainKeyByImport, excludedDatesBySource };
}

async function loadAnalysisContext() {
  if (contextPromise) return contextPromise;
  contextPromise = Promise.all([
    loadImports(),
    selectPagedRows("wnmufm_analytics_anomalies", new URLSearchParams({
      select: "id,import_id,grain,status,evidence",
      status: "eq.excluded",
      order: "reviewed_at.desc"
    }))
  ]).then(([imports, excluded]) => buildObservationExclusionContext(imports,excluded));
  return contextPromise;
}

function rowIsUsable(row, context) {
  const importId = Number(row.source_import_id);
  const runDate = context.runDateByImport.get(importId);
  if (!periodIsComplete(row.period_end, runDate)) return false;
  const sourceGrainKey=context.sourceGrainKeyByImport.get(importId);
  const excludedDates=sourceGrainKey ? context.excludedDatesBySource.get(sourceGrainKey) : null;
  if (excludedDates?.has(row.period_start)) return false;
  return true;
}

function breakdownRowIsUsable(row, context) {
  const importId = Number(row.source_import_id);
  const runDate = context.runDateByImport.get(importId);
  if (runDate && row.period_end > runDate) return false;
  return true;
}

function withBreakdownStatus(row, context) {
  const runDate = context.runDateByImport.get(Number(row.source_import_id));
  return {
    ...row,
    analysis_tail_incomplete: Boolean(runDate && row.period_end >= runDate),
    report_run_date: runDate || null
  };
}

export async function loadAvailableDataRange() {
  const context = await loadAnalysisContext();
  const query = (order) => new URLSearchParams({
    select:"period_start,period_end,station_value,source_import_id",
    dimension_type:"eq.",
    filter_signature:`eq.${DEFAULT_FILTER_SIGNATURE}`,
    order,
    limit:"500"
  }).toString();

  const [earlyRows, lateRows] = await Promise.all([
    selectRows("wnmufm_analytics_observations", query("period_start.asc")),
    selectRows("wnmufm_analytics_observations", query("period_end.desc"))
  ]);
  const usable = [...earlyRows,...lateRows].filter((row) => rowIsUsable(row,context));
  return selectAvailableObservationRange(usable);
}

export async function loadTimeSeriesRange(metricKey, grain = "day", filterSignature = DEFAULT_FILTER_SIGNATURE) {
  const cacheKey=`time-series-range|${metricKey}|${grain}|${filterSignature}`;
  return cachedQuery(cacheKey,async ()=>{
    const context = await loadAnalysisContext();
    const query = (order) => new URLSearchParams({
      select: "period_start,period_end,station_value,source_import_id",
      metric_key: `eq.${metricKey}`,
      grain: `eq.${grain}`,
      dimension_type: "eq.",
      filter_signature: `eq.${filterSignature}`,
      order,
      limit: "500"
    }).toString();

    const [earlyRows, lateRows] = await Promise.all([
      selectRows("wnmufm_analytics_observations", query("period_start.asc")),
      selectRows("wnmufm_analytics_observations", query("period_end.desc"))
    ]);
    const usable = [...earlyRows,...lateRows].filter((row) => rowIsUsable(row, context));
    return selectAvailableObservationRange(usable);
  });
}

export async function loadTimeSeries(metricKey, grain = "day", filterSignature = DEFAULT_FILTER_SIGNATURE, range = {}) {
  const cacheKey=`time-series|${metricKey}|${grain}|${filterSignature}|${range?.startDate || ""}|${range?.endDate || ""}`;
  return cachedQuery(cacheKey,async ()=>{
    const params = applyDateRange(new URLSearchParams({
      select: "period_start,period_end,station_value,benchmark_value,benchmark_label,unit,quality_flags,source_import_id",
      metric_key: `eq.${metricKey}`,
      grain: `eq.${grain}`,
      dimension_type: "eq.",
      filter_signature: `eq.${filterSignature}`,
      order: "period_start.asc",
      limit: "1000"
    }), range);
    const [rows, context] = await Promise.all([
      selectRows("wnmufm_analytics_observations", params.toString()),
      loadAnalysisContext()
    ]);
    return rows.filter((row) => rowIsUsable(row, context));
  });
}

export async function loadLatestBreakdown(metricKey, dimensionType, filterSignature = DEFAULT_FILTER_SIGNATURE, range = {}) {
  const cacheKey=`latest-breakdown|${metricKey}|${dimensionType}|${filterSignature}|${range?.startDate || ""}|${range?.endDate || ""}`;
  return cachedQuery(cacheKey,async ()=>{
    const params = applyDateRange(new URLSearchParams({
      select: "dimension_value,station_value,benchmark_value,benchmark_label,unit,period_start,period_end,grain,source_import_id",
      metric_key: `eq.${metricKey}`,
      dimension_type: `eq.${dimensionType}`,
      filter_signature: `eq.${filterSignature}`,
      order: "period_end.desc",
      limit: "1000"
    }), range);
    const [rows, context] = await Promise.all([
      selectRows("wnmufm_analytics_observations", params.toString()),
      loadAnalysisContext()
    ]);
    const usable = rows.filter((row) => breakdownRowIsUsable(row, context));
    if (!usable.length) return [];

    const complete = usable.filter((row) => periodIsComplete(
      row.period_end,
      context.runDateByImport.get(Number(row.source_import_id))
    ));
    const pool = complete.length ? complete : usable;
    const latestEnd = pool.reduce((latest, row) => !latest || row.period_end > latest ? row.period_end : latest, null);
    const latest = pool.filter((row) => row.period_end === latestEnd);
    const latestStart = latest.reduce((earliest, row) => !earliest || row.period_start < earliest ? row.period_start : earliest, null);
    return latest.filter((row) => row.period_start === latestStart).map((row) => withBreakdownStatus(row, context));
  });
}


export function selectLongestBreakdownRows(rows) {
  if (!rows?.length) return [];
  const groups = new Map();
  rows.forEach((row) => {
    const id = Number(row.source_import_id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  });
  const spanDays = (rowsForImport) => {
    const first = rowsForImport[0];
    const start = new Date(`${first.period_start}T12:00:00Z`);
    const end = new Date(`${first.period_end}T12:00:00Z`);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
      ? Math.max(0, (end - start) / 86400000)
      : -1;
  };
  const candidates = [...groups.values()].sort((a,b) =>
    spanDays(b) - spanDays(a) ||
    String(b[0]?.period_end || "").localeCompare(String(a[0]?.period_end || ""))
  );
  return candidates[0] || [];
}

export async function loadLongestBreakdown(metricKey, dimensionType, filterSignature = DEFAULT_FILTER_SIGNATURE, range = {}) {
  const params = applyDateRange(new URLSearchParams({
    select: "dimension_value,station_value,benchmark_value,benchmark_label,unit,period_start,period_end,grain,source_import_id",
    metric_key: `eq.${metricKey}`,
    dimension_type: `eq.${dimensionType}`,
    filter_signature: `eq.${filterSignature}`,
    order: "period_start.asc",
    limit: "2000"
  }), range);
  const [rows, context] = await Promise.all([
    selectRows("wnmufm_analytics_observations", params.toString()),
    loadAnalysisContext()
  ]);
  const usable = rows.filter((row) => breakdownRowIsUsable(row, context));
  if (!usable.length) return [];

  return selectLongestBreakdownRows(usable).map((row) => withBreakdownStatus(row, context));
}

export async function loadBreakdownDimensionMetrics(metricKeys, dimensionType, dimensionValue, sourceImportId) {
  if(!metricKeys?.length || !dimensionType || !dimensionValue || !sourceImportId) return [];
  const params=new URLSearchParams({
    select:"metric_key,metric_label,station_value,unit,period_start,period_end,grain,dimension_type,dimension_value,source_import_id",
    metric_key:`in.(${metricKeys.join(",")})`,
    dimension_type:`eq.${dimensionType}`,
    dimension_value:`eq.${dimensionValue}`,
    source_import_id:`eq.${sourceImportId}`,
    filter_signature:`eq.${DEFAULT_FILTER_SIGNATURE}`,
    limit:"100"
  });
  const [rows,context]=await Promise.all([
    selectRows("wnmufm_analytics_observations",params.toString()),
    loadAnalysisContext()
  ]);
  return rows.filter((row)=>breakdownRowIsUsable(row,context)).map((row)=>withBreakdownStatus(row,context));
}

export async function loadLatestBreakdownForImportScope(metricKey, dimensionType, { reportType="", selectedProgram=null, range={} } = {}) {
  const context=await loadAnalysisContext();
  const candidates=context.imports.filter((item)=>{
    if(reportType && item.report_type!==reportType) return false;
    if(selectedProgram!==null && String(item.selected_program || "")!==String(selectedProgram || "")) return false;
    if(range?.startDate && item.report_start && item.report_start < range.startDate) return false;
    if(range?.endDate && item.report_end && item.report_end > range.endDate) return false;
    return true;
  });
  if(!candidates.length) return [];

  const spanDays=(item)=>{
    const start=new Date(`${item.report_start}T12:00:00Z`);
    const end=new Date(`${item.report_end}T12:00:00Z`);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) ? Math.max(0,(end-start)/86400000) : -1;
  };
  candidates.sort((a,b)=>
    String(b.report_end || "").localeCompare(String(a.report_end || "")) ||
    spanDays(b)-spanDays(a) ||
    Number(b.id)-Number(a.id)
  );
  const chosen=candidates[0];
  const params=new URLSearchParams({
    select:"dimension_value,station_value,benchmark_value,benchmark_label,unit,period_start,period_end,grain,source_import_id",
    metric_key:`eq.${metricKey}`,
    dimension_type:`eq.${dimensionType}`,
    source_import_id:`eq.${chosen.id}`,
    filter_signature:`eq.${DEFAULT_FILTER_SIGNATURE}`,
    order:"station_value.desc"
  });
  const rows=await selectPagedRows("wnmufm_analytics_observations",params,{pageSize:1000,maxRows:10000});
  return rows.filter((row)=>breakdownRowIsUsable(row,context)).map((row)=>withBreakdownStatus(row,context));
}

export async function loadLatestValues(metricKeys, grain = "day", range = {}) {
  const keys=[...new Set((metricKeys || []).filter(Boolean))];
  if(!keys.length) return {};
  const cacheKey=`latest-values|${[...keys].sort().join(",")}|${grain}|${range?.startDate || ""}|${range?.endDate || ""}`;
  return cachedQuery(cacheKey,async ()=>{
    const params = applyDateRange(new URLSearchParams({
      select: "metric_key,metric_label,station_value,benchmark_value,benchmark_label,unit,period_start,period_end,source_import_id",
      metric_key: `in.(${keys.join(",")})`,
      grain: `eq.${grain}`,
      dimension_type: "eq.",
      filter_signature: `eq.${DEFAULT_FILTER_SIGNATURE}`,
      order: "metric_key.asc,period_start.desc",
      limit: String(Math.max(100,keys.length*100))
    }), range);
    const [rows,context]=await Promise.all([
      selectRows("wnmufm_analytics_observations",params.toString()),
      loadAnalysisContext()
    ]);
    const output={};
    rows.forEach((candidate)=>{
      const key=String(candidate.metric_key || "");
      if(!key || output[key] || !rowIsUsable(candidate,context)) return;
      output[key]=candidate;
    });
    return output;
  });
}


export async function loadDateObservations(date) {
  const params = new URLSearchParams({
    select: "report_type,metric_key,metric_label,station_value,benchmark_value,benchmark_label,unit,period_start,period_end,grain,dimension_type,dimension_value,filter_signature,source_import_id",
    grain: "eq.day",
    period_start: `eq.${date}`,
    period_end: `eq.${date}`,
    filter_signature: "eq.{}",
    order: "report_type.asc,metric_key.asc",
    limit: "2000"
  });
  const [rows, context] = await Promise.all([
    selectRows("wnmufm_analytics_observations", params.toString()),
    loadAnalysisContext()
  ]);
  return rows.filter((row) => rowIsUsable(row, context));
}


export function splitIsoRangeByMonth(startDate,endDate) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || "")) || startDate>endDate) return [];
  const chunks=[];
  let cursor=String(startDate);
  while(cursor<=endDate) {
    const date=new Date(`${cursor}T12:00:00Z`);
    if(Number.isNaN(date.getTime())) return [];
    const year=date.getUTCFullYear();
    const month=date.getUTCMonth();
    const monthEnd=new Date(Date.UTC(year,month+1,0,12)).toISOString().slice(0,10);
    const chunkEnd=monthEnd<endDate ? monthEnd : endDate;
    chunks.push({startDate:cursor,endDate:chunkEnd});
    const next=new Date(`${chunkEnd}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate()+1);
    cursor=next.toISOString().slice(0,10);
  }
  return chunks;
}

async function loadStreamGuysHourlyChunked(params,range,{concurrency=6}={}) {
  const chunks=splitIsoRangeByMonth(range?.startDate,range?.endDate);
  if(!chunks.length) return selectPagedRows("wnmufm_streamguys_hourly_aligned",params,{pageSize:1000,maxRows:30000});
  const rows=[];
  for(let index=0;index<chunks.length;index+=concurrency) {
    const batch=chunks.slice(index,index+concurrency);
    const results=await Promise.all(batch.map((chunk)=>{
      const chunkParams=new URLSearchParams(params);
      chunkParams.set("schedule_date",`gte.${chunk.startDate}`);
      chunkParams.append("schedule_date",`lte.${chunk.endDate}`);
      chunkParams.set("limit","1000");
      return selectRows("wnmufm_streamguys_hourly_aligned",chunkParams.toString());
    }));
    results.forEach((result)=>rows.push(...result));
  }
  return rows;
}

export async function loadStreamGuysHourly(range = {}) {
  const cacheKey=`streamguys-hourly|${range?.startDate || ""}|${range?.endDate || ""}`;
  return cachedQuery(cacheKey,async ()=>{
    const params = new URLSearchParams({
      select: "source_import_id,source_csv,source_row,source_date,source_hour,source_timezone_label,schedule_timezone,offset_hours,alignment_status,schedule_date,schedule_hour,tlh_hours,unit,quality_flags",
      order: "schedule_date.asc,schedule_hour.asc"
    });
    const [rows, context] = await Promise.all([
      loadStreamGuysHourlyChunked(params,range),
      loadAnalysisContext()
    ]);

    return rows.filter((row) => rowIsUsable({
      source_import_id: row.source_import_id,
      period_start: row.source_date,
      period_end: row.source_date
    }, context));
  });
}

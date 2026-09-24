import { selectRows } from "./api.js";
import { periodIsComplete } from "./analysis.js";

const DEFAULT_FILTER_SIGNATURE = "{}";
let contextPromise = null;
let importsPromise = null;

function applyDateRange(params, range = {}) {
  if (range?.startDate) params.set("period_start", `gte.${range.startDate}`);
  if (range?.endDate) params.set("period_end", `lte.${range.endDate}`);
  return params;
}

export function invalidateDataCache() {
  contextPromise = null;
  importsPromise = null;
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

export async function loadOpenAnomalies() {
  const query = new URLSearchParams({
    select: "id,import_id,anomaly_key,severity,status,title,detail,evidence,detected_at,reviewed_by_email,reviewed_at",
    status: "eq.open",
    order: "detected_at.desc",
    limit: "100"
  }).toString();
  return selectRows("wnmufm_analytics_anomalies", query);
}

export async function loadReviewedAnomalies() {
  const query = new URLSearchParams({
    select: "id,import_id,anomaly_key,status,evidence,reviewed_at",
    status: "in.(expected,resolved)",
    order: "reviewed_at.desc",
    limit: "500"
  }).toString();
  return selectRows("wnmufm_analytics_anomalies", query);
}

function importSourceKey(item) {
  const reportType=String(item?.report_type || "");
  if(!reportType) return "";
  if(reportType==="audio_program_drilldown") {
    return `${reportType}|${String(item?.selected_program || "").trim()}`;
  }
  return reportType;
}

export function buildObservationExclusionContext(imports = [], excluded = []) {
  const runDateByImport = new Map();
  const sourceKeyByImport = new Map();
  imports.forEach((item) => {
    const id=Number(item.id);
    runDateByImport.set(id, item.report_run_date || String(item.imported_at || "").slice(0, 10) || null);
    sourceKeyByImport.set(id,importSourceKey(item));
  });

  const excludedDatesBySource = new Map();
  excluded.forEach((item) => {
    const date=String(item?.evidence?.date || "");
    const sourceKey=sourceKeyByImport.get(Number(item.import_id)) || "";
    if(!date || !sourceKey) return;
    if(!excludedDatesBySource.has(sourceKey)) excludedDatesBySource.set(sourceKey,new Set());
    excludedDatesBySource.get(sourceKey).add(date);
  });

  return { imports, runDateByImport, sourceKeyByImport, excludedDatesBySource };
}

async function loadAnalysisContext() {
  if (contextPromise) return contextPromise;
  contextPromise = Promise.all([
    loadImports(),
    selectRows("wnmufm_analytics_anomalies", new URLSearchParams({
      select: "id,import_id,status,evidence",
      status: "eq.excluded",
      limit: "500"
    }).toString())
  ]).then(([imports, excluded]) => buildObservationExclusionContext(imports,excluded));
  return contextPromise;
}

function rowIsUsable(row, context) {
  const importId = Number(row.source_import_id);
  const runDate = context.runDateByImport.get(importId);
  if (!periodIsComplete(row.period_end, runDate)) return false;
  const sourceKey=context.sourceKeyByImport.get(importId);
  const excludedDates=sourceKey ? context.excludedDatesBySource.get(sourceKey) : null;
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
}

export async function loadTimeSeries(metricKey, grain = "day", filterSignature = DEFAULT_FILTER_SIGNATURE, range = {}) {
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
}

export async function loadLatestBreakdown(metricKey, dimensionType, filterSignature = DEFAULT_FILTER_SIGNATURE, range = {}) {
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

export async function loadLatestValues(metricKeys, grain = "day", range = {}) {
  const context = await loadAnalysisContext();
  const output = {};
  await Promise.all(metricKeys.map(async (metricKey) => {
    const params = applyDateRange(new URLSearchParams({
      select: "metric_key,metric_label,station_value,benchmark_value,benchmark_label,unit,period_start,period_end,source_import_id",
      metric_key: `eq.${metricKey}`,
      grain: `eq.${grain}`,
      dimension_type: "eq.",
      filter_signature: `eq.${DEFAULT_FILTER_SIGNATURE}`,
      order: "period_start.desc",
      limit: "100"
    }), range);
    const rows = await selectRows("wnmufm_analytics_observations", params.toString());
    const row = rows.find((candidate) => rowIsUsable(candidate, context));
    if (row) output[metricKey] = row;
  }));
  return output;
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

import { cleanNumber, normalizeLineEndings, parseCsv } from "./csv.js";

export const GA4_REPORT_TYPE = "ga4_website";
export const GA4_PARSER_VERSION = "ga4-export-parser-2";

const NORMALIZED_LIMITS = Object.freeze({
  page_path: 1000,
  landing_page: 1000,
  city: 1000,
  screen_resolution: 250,
  default: 2000
});

function compactDate(value) {
  const text=String(value || "").trim();
  if(!/^\d{8}$/.test(text)) return "";
  return `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}`;
}

function reportTitleFromComments(lines) {
  const comments=lines
    .filter((line)=>line.startsWith("#"))
    .map((line)=>line.replace(/^#\s?/,"").trim())
    .filter(Boolean);
  const freeForm=comments.find((line)=>/^Free form(?:-|$)/i.test(line));
  if(freeForm) return freeForm;
  return comments.find((line)=>
    !/^-+$/.test(line) &&
    !/^\d{8}-\d{8}$/.test(line) &&
    !/^(Account|Property|Start date|End date|All Users)\s*:/i.test(line) &&
    !/^All Users$/i.test(line)
  ) || "";
}

export function parseGa4Metadata(text) {
  const normalized=normalizeLineEndings(text);
  const lines=normalized.split("\n");
  const startLine=lines.find((line)=>/^#\s*Start date:/i.test(line)) || "";
  const endLine=lines.find((line)=>/^#\s*End date:/i.test(line)) || "";
  const compactRangeLine=lines.find((line)=>/^#\s*\d{8}-\d{8}\s*$/.test(line)) || "";
  const compactRange=compactRangeLine.replace(/^#\s*/,"").trim().split("-");
  const start=compactDate(startLine.split(":").slice(1).join(":").trim()) || compactDate(compactRange[0]);
  const end=compactDate(endLine.split(":").slice(1).join(":").trim()) || compactDate(compactRange[1]);
  return {
    title:reportTitleFromComments(lines),
    start,
    end
  };
}

export function parseGa4Sections(text) {
  const normalized=normalizeLineEndings(text);
  const body=normalized
    .split("\n")
    .filter((line)=>!line.startsWith("#"))
    .join("\n")
    .trim();
  if(!body) return [];
  return body
    .split(/\n\s*\n+/)
    .map((block,index)=>{
      const parsed=parseCsv(block);
      return {
        index,
        name:parsed.headers[0] || `section_${index+1}`,
        headers:parsed.headers,
        rows:parsed.rows
      };
    })
    .filter((section)=>section.headers.length);
}

function normalizedTitle(value) {
  return String(value || "").trim().toLowerCase();
}

export function detectGa4Report(title) {
  const clean=normalizedTitle(title);
  if(clean.startsWith("pages and screens:")) return "pages_and_screens";
  if(clean.startsWith("landing page:")) return "landing_page";
  if(clean.startsWith("events:")) return "events";
  if(clean.startsWith("demographic details: country")) return "country";
  if(clean.startsWith("traffic acquisition:")) return "traffic_acquisition";
  if(clean.startsWith("user acquisition:")) return "user_acquisition";
  if(clean.startsWith("tech details: browser")) return "tech_details_browser";
  if(clean === "tech overview") return "tech_overview";
  if(clean === "user attributes overview") return "user_attributes_overview";
  if(clean === "generate leads overview") return "generate_leads_overview";
  if(clean.startsWith("audiences:")) return "audiences";
  if(clean.startsWith("lead acquisition:")) return "lead_acquisition";
  if(clean.startsWith("lead disqualification and loss:")) return "lead_disqualification";
  if(clean.startsWith("user acquisition cohorts:")) return "user_acquisition_cohorts";
  if(clean === "understand web and/or app traffic overview") return "traffic_overview";
  if(clean === "view user engagement & retention overview") return "engagement_overview";
  return "unknown";
}

export function detectGa4FreeFormReport(sections) {
  const section=(sections || []).find((item)=>item.headers.includes("Date"));
  if(!section) return "unknown";
  if(section.headers.includes("Page path and screen class")) return "daily_pages";
  if(section.headers.includes("Landing page")) return "daily_landing";
  if(section.headers.includes("Session primary channel group (Default Channel Group)")) return "daily_session_channel";
  if(section.headers.includes("Event name")) return "daily_events";
  return "unknown";
}

function sourceSection(sections, firstHeader) {
  return sections.find((section)=>section.headers[0] === firstHeader) || null;
}

function numeric(value) {
  return cleanNumber(value);
}

function ratePercent(value) {
  const number=cleanNumber(value);
  if(number===null) return null;
  return Math.abs(number) <= 1 ? number * 100 : number;
}

function topRows(rows, column, limitKey="default") {
  const limit=NORMALIZED_LIMITS[limitKey] || NORMALIZED_LIMITS.default;
  return (rows || [])
    .map((row,index)=>({row,sourceRow:index+2}))
    .filter((item)=>numeric(item.row[column]) !== null)
    .sort((a,b)=>Number(numeric(b.row[column]) || 0)-Number(numeric(a.row[column]) || 0))
    .slice(0,limit);
}

function observationBase(context, metricKey, metricLabel, unit, dimensionType, dimensionValue, stationValue, sourceRow) {
  return {
    station_key:context.stationKey,
    report_type:GA4_REPORT_TYPE,
    grain:"unknown",
    period_start:context.start,
    period_end:context.end,
    metric_key:metricKey,
    metric_label:metricLabel,
    unit,
    dimension_type:dimensionType,
    dimension_value:String(dimensionValue ?? "").trim(),
    filter_signature:"{}",
    station_value:stationValue,
    benchmark_value:null,
    benchmark_label:null,
    text_value:null,
    source_import_id:null,
    source_csv:context.sourceName,
    source_row:sourceRow,
    quality_flags:["ga4_aggregate_source_period"]
  };
}


function dailyObservationBase(context, metricKey, metricLabel, unit, dimensionType, dimensionValue, stationValue, sourceRow, date) {
  return {
    station_key:context.stationKey,
    report_type:GA4_REPORT_TYPE,
    grain:"day",
    period_start:date,
    period_end:date,
    metric_key:metricKey,
    metric_label:metricLabel,
    unit,
    dimension_type:dimensionType,
    dimension_value:String(dimensionValue ?? "").trim(),
    filter_signature:"{}",
    station_value:stationValue,
    benchmark_value:null,
    benchmark_label:null,
    text_value:null,
    source_import_id:null,
    source_csv:context.sourceName,
    source_row:sourceRow,
    quality_flags:["ga4_daily_exploration"]
  };
}

const DAILY_FREE_FORM_SPECS=Object.freeze({
  daily_pages:{
    dimensionColumn:"Page path and screen class",
    dimensionType:"ga4_page_path",
    rankColumn:"Views",
    limit:100,
    metrics:[
      {key:"ga4.page_views",label:"Google Analytics 4 page views",column:"Views",unit:"views"},
      {key:"ga4.page_active_users",label:"Google Analytics 4 page active users",column:"Active users",unit:"users"},
      {key:"ga4.page_views_per_user",label:"Google Analytics 4 page views per active user",column:"Views per active user",unit:"views_per_user"},
      {key:"ga4.page_engagement_seconds_per_session",label:"Google Analytics 4 page engagement time per session",column:"Average engagement time per session",unit:"seconds"},
      {key:"ga4.page_event_count",label:"Google Analytics 4 page event count",column:"Event count",unit:"events"}
    ],
    totals:[{key:"ga4.site_page_views",label:"Google Analytics 4 site page views",column:"Views",unit:"views"}]
  },
  daily_landing:{
    dimensionColumn:"Landing page",
    dimensionType:"ga4_landing_page",
    rankColumn:"Sessions",
    limit:100,
    metrics:[
      {key:"ga4.landing_sessions",label:"Google Analytics 4 landing-page sessions",column:"Sessions",unit:"sessions"},
      {key:"ga4.landing_active_users",label:"Google Analytics 4 landing-page active users",column:"Active users",unit:"users"},
      {key:"ga4.landing_new_users",label:"Google Analytics 4 landing-page new users",column:"New users",unit:"users"},
      {key:"ga4.landing_engagement_seconds_per_session",label:"Google Analytics 4 landing-page engagement time per session",column:"Average engagement time per session",unit:"seconds"}
    ],
    totals:[{key:"ga4.site_sessions",label:"Google Analytics 4 site sessions",column:"Sessions",unit:"sessions"}]
  },
  daily_session_channel:{
    dimensionColumn:"Session primary channel group (Default Channel Group)",
    dimensionType:"ga4_session_channel",
    rankColumn:"Sessions",
    limit:2000,
    metrics:[
      {key:"ga4.sessions_by_channel",label:"Google Analytics 4 sessions by channel",column:"Sessions",unit:"sessions"},
      {key:"ga4.engaged_sessions_by_channel",label:"Google Analytics 4 engaged sessions by channel",column:"Engaged sessions",unit:"sessions"},
      {key:"ga4.engagement_rate_by_channel",label:"Google Analytics 4 engagement rate by channel",column:"Engagement rate",unit:"percent",transform:ratePercent},
      {key:"ga4.engagement_seconds_per_session_by_channel",label:"Google Analytics 4 engagement time per session by channel",column:"Average engagement time per session",unit:"seconds"},
      {key:"ga4.channel_event_count",label:"Google Analytics 4 event count by session channel",column:"Event count",unit:"events"},
      {key:"ga4.channel_active_users",label:"Google Analytics 4 active users by session channel",column:"Active users",unit:"users"},
      {key:"ga4.channel_event_count_per_user",label:"Google Analytics 4 events per active user by session channel",column:"Event count per active user",unit:"events_per_user"}
    ]
  },
  daily_events:{
    dimensionColumn:"Event name",
    dimensionType:"ga4_event",
    rankColumn:"Event count",
    limit:2000,
    metrics:[
      {key:"ga4.event_count",label:"Google Analytics 4 event count",column:"Event count",unit:"events"},
      {key:"ga4.event_users",label:"Google Analytics 4 event total users",column:"Total users",unit:"users"},
      {key:"ga4.event_active_users",label:"Google Analytics 4 event active users",column:"Active users",unit:"users"},
      {key:"ga4.event_count_per_user",label:"Google Analytics 4 events per active user",column:"Event count per active user",unit:"events_per_user"}
    ]
  }
});

function normalizeDailyFreeForm(output, sections, context, reportKey) {
  const spec=DAILY_FREE_FORM_SPECS[reportKey];
  const section=(sections || []).find((item)=>item.headers.includes("Date") && item.headers.includes(spec?.dimensionColumn));
  if(!spec || !section) return;

  const usable=(section.rows || []).map((row,index)=>({
    row,
    sourceRow:index+2,
    date:compactDate(row.Date),
    dimension:String(row[spec.dimensionColumn] ?? "").trim()
  })).filter((item)=>item.date && item.dimension);

  const rankColumn=section.headers.includes(spec.rankColumn)
    ? spec.rankColumn
    : spec.metrics.find((metric)=>section.headers.includes(metric.column))?.column;
  const totalsByDimension=new Map();
  usable.forEach((item)=>{
    const value=rankColumn ? numeric(item.row[rankColumn]) : 0;
    totalsByDimension.set(item.dimension,(totalsByDimension.get(item.dimension) || 0) + Number(value || 0));
  });
  const allowed=new Set([...totalsByDimension.entries()]
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
    .slice(0,spec.limit)
    .map(([dimension])=>dimension));

  usable.forEach((item)=>{
    if(!allowed.has(item.dimension)) return;
    spec.metrics.forEach((metric)=>{
      if(!section.headers.includes(metric.column)) return;
      const raw=item.row[metric.column];
      const value=metric.transform ? metric.transform(raw) : numeric(raw);
      if(value===null || value===undefined) return;
      output.push(dailyObservationBase(
        context,metric.key,metric.label,metric.unit || "count",
        spec.dimensionType,item.dimension,value,item.sourceRow,item.date
      ));
    });
  });

  (spec.totals || []).forEach((metric)=>{
    if(!section.headers.includes(metric.column)) return;
    const byDate=new Map();
    usable.forEach((item)=>{
      const value=numeric(item.row[metric.column]);
      if(value===null) return;
      byDate.set(item.date,(byDate.get(item.date) || 0)+Number(value));
    });
    [...byDate.entries()].sort(([a],[b])=>a.localeCompare(b)).forEach(([date,value])=>{
      output.push(dailyObservationBase(
        context,metric.key,metric.label,metric.unit || "count",
        "","",value,1,date
      ));
    });
  });
}

function pushDimensionMetrics(output, rows, context, spec) {
  const selected=topRows(rows,spec.rankColumn,spec.limitKey);
  selected.forEach(({row,sourceRow})=>{
    const dimension=String(row[spec.dimensionColumn] ?? "").trim();
    if(!dimension) return;
    spec.metrics.forEach((metric)=>{
      const raw=row[metric.column];
      const value=metric.transform ? metric.transform(raw) : numeric(raw);
      if(value===null || value===undefined) return;
      output.push(observationBase(
        context,
        metric.key,
        metric.label,
        metric.unit || "count",
        spec.dimensionType,
        dimension,
        value,
        sourceRow
      ));
    });
  });
}

function normalizePages(output, sections, context) {
  const section=sourceSection(sections,"Page path and screen class");
  if(!section) return;
  pushDimensionMetrics(output,section.rows,context,{
    dimensionColumn:"Page path and screen class",
    dimensionType:"ga4_page_path",
    rankColumn:"Views",
    limitKey:"page_path",
    metrics:[
      {key:"ga4.page_views",label:"Google Analytics 4 page views",column:"Views",unit:"views"},
      {key:"ga4.page_active_users",label:"Google Analytics 4 page active users",column:"Active users",unit:"users"},
      {key:"ga4.page_views_per_user",label:"Google Analytics 4 page views per active user",column:"Views per active user",unit:"views_per_user"},
      {key:"ga4.page_engagement_seconds_per_user",label:"Google Analytics 4 page engagement time per active user",column:"Average engagement time per active user",unit:"seconds"},
      {key:"ga4.page_event_count",label:"Google Analytics 4 page event count",column:"Event count",unit:"events"}
    ]
  });
}

function normalizeLanding(output, sections, context) {
  const section=sourceSection(sections,"Landing page");
  if(!section) return;
  pushDimensionMetrics(output,section.rows,context,{
    dimensionColumn:"Landing page",
    dimensionType:"ga4_landing_page",
    rankColumn:"Sessions",
    limitKey:"landing_page",
    metrics:[
      {key:"ga4.landing_sessions",label:"Google Analytics 4 landing-page sessions",column:"Sessions",unit:"sessions"},
      {key:"ga4.landing_active_users",label:"Google Analytics 4 landing-page active users",column:"Active users",unit:"users"},
      {key:"ga4.landing_new_users",label:"Google Analytics 4 landing-page new users",column:"New users",unit:"users"},
      {key:"ga4.landing_engagement_seconds_per_session",label:"Google Analytics 4 landing-page engagement time per session",column:"Average engagement time per session",unit:"seconds"}
    ]
  });
}

function normalizeEvents(output, sections, context) {
  const section=sourceSection(sections,"Event name");
  if(!section) return;
  pushDimensionMetrics(output,section.rows,context,{
    dimensionColumn:"Event name",
    dimensionType:"ga4_event",
    rankColumn:"Event count",
    metrics:[
      {key:"ga4.event_count",label:"Google Analytics 4 event count",column:"Event count",unit:"events"},
      {key:"ga4.event_users",label:"Google Analytics 4 event users",column:"Total users",unit:"users"},
      {key:"ga4.event_count_per_user",label:"Google Analytics 4 events per active user",column:"Event count per active user",unit:"events_per_user"}
    ]
  });
}

function normalizeCountry(output, sections, context) {
  const section=sourceSection(sections,"Country");
  if(!section) return;
  pushDimensionMetrics(output,section.rows,context,{
    dimensionColumn:"Country",
    dimensionType:"ga4_country",
    rankColumn:"Active users",
    metrics:[
      {key:"ga4.country_active_users",label:"Google Analytics 4 active users by country",column:"Active users",unit:"users"},
      {key:"ga4.country_new_users",label:"Google Analytics 4 new users by country",column:"New users",unit:"users"},
      {key:"ga4.country_engaged_sessions",label:"Google Analytics 4 engaged sessions by country",column:"Engaged sessions",unit:"sessions"},
      {key:"ga4.country_engagement_rate",label:"Google Analytics 4 engagement rate by country",column:"Engagement rate",unit:"percent",transform:ratePercent},
      {key:"ga4.country_engaged_sessions_per_user",label:"Google Analytics 4 engaged sessions per active user by country",column:"Engaged sessions per active user",unit:"sessions_per_user"},
      {key:"ga4.country_engagement_seconds_per_user",label:"Google Analytics 4 engagement time per active user by country",column:"Average engagement time per active user",unit:"seconds"}
    ]
  });
}

function normalizeTrafficAcquisition(output, sections, context) {
  const section=sourceSection(sections,"Session primary channel group (Default Channel Group)");
  if(!section) return;
  pushDimensionMetrics(output,section.rows,context,{
    dimensionColumn:"Session primary channel group (Default Channel Group)",
    dimensionType:"ga4_session_channel",
    rankColumn:"Sessions",
    metrics:[
      {key:"ga4.sessions_by_channel",label:"Google Analytics 4 sessions by channel",column:"Sessions",unit:"sessions"},
      {key:"ga4.engaged_sessions_by_channel",label:"Google Analytics 4 engaged sessions by channel",column:"Engaged sessions",unit:"sessions"},
      {key:"ga4.engagement_rate_by_channel",label:"Google Analytics 4 engagement rate by channel",column:"Engagement rate",unit:"percent",transform:ratePercent},
      {key:"ga4.engagement_seconds_per_session_by_channel",label:"Google Analytics 4 engagement time per session by channel",column:"Average engagement time per session",unit:"seconds"},
      {key:"ga4.events_per_session_by_channel",label:"Google Analytics 4 events per session by channel",column:"Events per session",unit:"events_per_session"}
    ]
  });
}

function normalizeUserAcquisition(output, sections, context) {
  const section=sourceSection(sections,"First user primary channel group (Default Channel Group)");
  if(!section) return;
  pushDimensionMetrics(output,section.rows,context,{
    dimensionColumn:"First user primary channel group (Default Channel Group)",
    dimensionType:"ga4_first_user_channel",
    rankColumn:"Total users",
    metrics:[
      {key:"ga4.users_by_first_channel",label:"Google Analytics 4 users by first acquisition channel",column:"Total users",unit:"users"},
      {key:"ga4.new_users_by_first_channel",label:"Google Analytics 4 new users by first acquisition channel",column:"New users",unit:"users"},
      {key:"ga4.returning_users_by_first_channel",label:"Google Analytics 4 returning users by first acquisition channel",column:"Returning users",unit:"users"},
      {key:"ga4.engagement_seconds_by_first_channel",label:"Google Analytics 4 engagement time by first acquisition channel",column:"Average engagement time per active user",unit:"seconds"},
      {key:"ga4.engaged_sessions_per_user_by_first_channel",label:"Google Analytics 4 engaged sessions per active user by first acquisition channel",column:"Engaged sessions per active user",unit:"sessions_per_user"}
    ]
  });
}

function normalizeBrowser(output, sections, context) {
  const section=sourceSection(sections,"Browser");
  if(!section) return;
  const metrics=section.headers.includes("Engagement rate")
    ? [
        {key:"ga4.browser_active_users",label:"Google Analytics 4 active users by browser",column:"Active users",unit:"users"},
        {key:"ga4.browser_engagement_rate",label:"Google Analytics 4 engagement rate by browser",column:"Engagement rate",unit:"percent",transform:ratePercent},
        {key:"ga4.browser_engagement_seconds_per_user",label:"Google Analytics 4 engagement time per active user by browser",column:"Average engagement time per active user",unit:"seconds"}
      ]
    : [{key:"ga4.browser_active_users",label:"Google Analytics 4 active users by browser",column:"Active users",unit:"users"}];
  pushDimensionMetrics(output,section.rows,context,{
    dimensionColumn:"Browser",
    dimensionType:"ga4_browser",
    rankColumn:"Active users",
    metrics
  });
}

function normalizeTechOverview(output, sections, context) {
  const specs=[
    ["Operating system","ga4_operating_system","ga4.os_active_users","Google Analytics 4 active users by operating system","default"],
    ["Device category","ga4_device_category","ga4.device_active_users","Google Analytics 4 active users by device category","default"],
    ["Screen resolution","ga4_screen_resolution","ga4.screen_active_users","Google Analytics 4 active users by screen resolution","screen_resolution"]
  ];
  specs.forEach(([header,dimensionType,key,label,limitKey])=>{
    const section=sourceSection(sections,header);
    if(!section) return;
    pushDimensionMetrics(output,section.rows,context,{
      dimensionColumn:header,
      dimensionType,
      rankColumn:"Active users",
      limitKey,
      metrics:[{key,label,column:"Active users",unit:"users"}]
    });
  });
  normalizeBrowser(output,sections,context);
}

function normalizeUserAttributesOverview(output, sections, context) {
  const city=sourceSection(sections,"City");
  if(city) {
    pushDimensionMetrics(output,city.rows,context,{
      dimensionColumn:"City",
      dimensionType:"ga4_city",
      rankColumn:"Active users",
      limitKey:"city",
      metrics:[{key:"ga4.city_active_users",label:"Google Analytics 4 active users by city",column:"Active users",unit:"users"}]
    });
  }
  const language=sourceSection(sections,"Language");
  if(language) {
    pushDimensionMetrics(output,language.rows,context,{
      dimensionColumn:"Language",
      dimensionType:"ga4_language",
      rankColumn:"Active users",
      metrics:[{key:"ga4.language_active_users",label:"Google Analytics 4 active users by language",column:"Active users",unit:"users"}]
    });
  }
}

function normalizeGenerateLeadsOverview(output, sections, context) {
  const source=sourceSection(sections,"Session manual source");
  if(!source) return;
  pushDimensionMetrics(output,source.rows,context,{
    dimensionColumn:"Session manual source",
    dimensionType:"ga4_manual_source",
    rankColumn:"Sessions",
    metrics:[{key:"ga4.sessions_by_manual_source",label:"Google Analytics 4 sessions by manual source",column:"Sessions",unit:"sessions"}]
  });
}

const REPORT_LABELS=Object.freeze({
  pages_and_screens:"Google Analytics 4 Pages and screens",
  landing_page:"Google Analytics 4 Landing pages",
  events:"Google Analytics 4 Events",
  country:"Google Analytics 4 Country",
  traffic_acquisition:"Google Analytics 4 Traffic acquisition",
  user_acquisition:"Google Analytics 4 User acquisition",
  tech_details_browser:"Google Analytics 4 Browser details",
  tech_overview:"Google Analytics 4 Tech overview",
  user_attributes_overview:"Google Analytics 4 User attributes overview",
  generate_leads_overview:"Google Analytics 4 Generate leads overview",
  audiences:"Google Analytics 4 Audiences",
  lead_acquisition:"Google Analytics 4 Lead acquisition",
  lead_disqualification:"Google Analytics 4 Lead disqualification",
  user_acquisition_cohorts:"Google Analytics 4 User acquisition cohorts",
  traffic_overview:"Google Analytics 4 Traffic overview",
  engagement_overview:"Google Analytics 4 Engagement & retention overview",
  daily_pages:"Google Analytics 4 Daily page paths",
  daily_landing:"Google Analytics 4 Daily landing pages",
  daily_session_channel:"Google Analytics 4 Daily session channels",
  daily_events:"Google Analytics 4 Daily events"
});

export function ga4ReportLabel(reportKey, fallbackTitle="") {
  return REPORT_LABELS[reportKey] || fallbackTitle || "Google Analytics";
}

export function inspectGa4CsvText(text, { fileName="", stationKey="wnmu_fm" } = {}) {
  const metadata=parseGa4Metadata(text);
  const sections=parseGa4Sections(text);
  const standardReportKey=detectGa4Report(metadata.title);
  const reportKey=standardReportKey === "unknown" ? detectGa4FreeFormReport(sections) : standardReportKey;
  if(reportKey === "unknown") throw new Error("This CSV does not match a supported Google Analytics 4 export.");
  if(!metadata.start || !metadata.end) throw new Error("This Google Analytics 4 CSV does not include a usable source start/end date.");
  const context={
    stationKey,
    sourceName:fileName || metadata.title || "ga4.csv",
    start:metadata.start,
    end:metadata.end
  };
  const observations=[];

  if(reportKey.startsWith("daily_")) normalizeDailyFreeForm(observations,sections,context,reportKey);
  else if(reportKey==="pages_and_screens") normalizePages(observations,sections,context);
  else if(reportKey==="landing_page") normalizeLanding(observations,sections,context);
  else if(reportKey==="events") normalizeEvents(observations,sections,context);
  else if(reportKey==="country") normalizeCountry(observations,sections,context);
  else if(reportKey==="traffic_acquisition") normalizeTrafficAcquisition(observations,sections,context);
  else if(reportKey==="user_acquisition") normalizeUserAcquisition(observations,sections,context);
  else if(reportKey==="tech_details_browser") normalizeBrowser(observations,sections,context);
  else if(reportKey==="tech_overview") normalizeTechOverview(observations,sections,context);
  else if(reportKey==="user_attributes_overview") normalizeUserAttributesOverview(observations,sections,context);
  else if(reportKey==="generate_leads_overview") normalizeGenerateLeadsOverview(observations,sections,context);

  return {
    reportKey,
    reportLabel:ga4ReportLabel(reportKey,metadata.title),
    metadata,
    sections,
    normalized:{
      range:{grain:reportKey.startsWith("daily_") ? "day" : "unknown",start:metadata.start,end:metadata.end},
      observations,
      status:observations.length ? "imported" : "partial"
    },
    dataRowCount:sections.reduce((sum,section)=>sum+section.rows.length,0),
    parserVersion:GA4_PARSER_VERSION,
    note:observations.length
      ? (reportKey.startsWith("daily_")
          ? "Google Analytics 4 dated Free Form exploration. The full source CSV is archived; large page and landing-page dimensions are normalized to the 100 highest-activity values across the source period, while additive site totals are retained day by day."
          : "Google Analytics 4 aggregate export. The full source CSV is archived; very large dimensions are normalized only to the highest-activity rows needed for interactive analysis.")
      : "Recognized Google Analytics 4 report retained as source evidence; it does not currently add a unique analytical metric."
  };
}

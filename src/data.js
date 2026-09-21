import { selectRows } from "./api.js";
import { periodIsComplete } from "./analysis.js";

const DEFAULT_FILTER_SIGNATURE = "{}";
let contextPromise = null;

export function invalidateDataCache() {
  contextPromise = null;
}

export async function loadImports() {
  const query = new URLSearchParams({
    select: "id,source_filename,report_type,grain,report_start,report_end,report_run_date,selected_program,status,row_count,parser_version,imported_by_email,imported_at,notes,filter_context",
    order: "imported_at.desc",
    limit: "500"
  }).toString();
  return selectRows("wnmufm_analytics_imports", query);
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

async function loadAnalysisContext() {
  if (contextPromise) return contextPromise;
  contextPromise = Promise.all([
    loadImports(),
    selectRows("wnmufm_analytics_anomalies", new URLSearchParams({
      select: "id,import_id,status,evidence",
      status: "eq.excluded",
      limit: "500"
    }).toString())
  ]).then(([imports, excluded]) => {
    const runDateByImport = new Map();
    imports.forEach((item) => {
      runDateByImport.set(Number(item.id), item.report_run_date || String(item.imported_at || "").slice(0, 10) || null);
    });
    const excludedDatesByImport = new Map();
    excluded.forEach((item) => {
      const date = item?.evidence?.date;
      if (!date) return;
      const id = Number(item.import_id);
      if (!excludedDatesByImport.has(id)) excludedDatesByImport.set(id, new Set());
      excludedDatesByImport.get(id).add(date);
    });
    return { imports, runDateByImport, excludedDatesByImport };
  });
  return contextPromise;
}

function rowIsUsable(row, context) {
  const importId = Number(row.source_import_id);
  const runDate = context.runDateByImport.get(importId);
  if (!periodIsComplete(row.period_end, runDate)) return false;
  const excludedDates = context.excludedDatesByImport.get(importId);
  if (excludedDates?.has(row.period_start)) return false;
  return true;
}

export async function loadTimeSeries(metricKey, grain = "day", filterSignature = DEFAULT_FILTER_SIGNATURE) {
  const params = new URLSearchParams({
    select: "period_start,period_end,station_value,benchmark_value,benchmark_label,unit,quality_flags,source_import_id",
    metric_key: `eq.${metricKey}`,
    grain: `eq.${grain}`,
    dimension_type: "eq.",
    filter_signature: `eq.${filterSignature}`,
    order: "period_start.asc",
    limit: "1000"
  });
  const [rows, context] = await Promise.all([
    selectRows("wnmufm_analytics_observations", params.toString()),
    loadAnalysisContext()
  ]);
  return rows.filter((row) => rowIsUsable(row, context));
}

export async function loadLatestBreakdown(metricKey, dimensionType, filterSignature = DEFAULT_FILTER_SIGNATURE) {
  const params = new URLSearchParams({
    select: "dimension_value,station_value,benchmark_value,benchmark_label,unit,period_start,period_end,grain,source_import_id",
    metric_key: `eq.${metricKey}`,
    dimension_type: `eq.${dimensionType}`,
    filter_signature: `eq.${filterSignature}`,
    order: "period_end.desc",
    limit: "1000"
  });
  const [rows, context] = await Promise.all([
    selectRows("wnmufm_analytics_observations", params.toString()),
    loadAnalysisContext()
  ]);
  const usable = rows.filter((row) => rowIsUsable(row, context));
  if (!usable.length) return [];

  const latestEnd = usable.reduce((latest, row) => !latest || row.period_end > latest ? row.period_end : latest, null);
  const latest = usable.filter((row) => row.period_end === latestEnd);
  const latestStart = latest.reduce((earliest, row) => !earliest || row.period_start < earliest ? row.period_start : earliest, null);
  return latest.filter((row) => row.period_start === latestStart);
}

export async function loadLatestValues(metricKeys, grain = "day") {
  const context = await loadAnalysisContext();
  const output = {};
  await Promise.all(metricKeys.map(async (metricKey) => {
    const params = new URLSearchParams({
      select: "metric_key,metric_label,station_value,benchmark_value,benchmark_label,unit,period_start,period_end,source_import_id",
      metric_key: `eq.${metricKey}`,
      grain: `eq.${grain}`,
      dimension_type: "eq.",
      filter_signature: `eq.${DEFAULT_FILTER_SIGNATURE}`,
      order: "period_start.desc",
      limit: "100"
    });
    const rows = await selectRows("wnmufm_analytics_observations", params.toString());
    const row = rows.find((candidate) => rowIsUsable(candidate, context));
    if (row) output[metricKey] = row;
  }));
  return output;
}

import { selectRows } from "./api.js";

const DEFAULT_FILTER_SIGNATURE = "{}";

export async function loadImports() {
  const query = new URLSearchParams({
    select: "id,source_filename,report_type,grain,report_start,report_end,selected_program,status,row_count,parser_version,imported_by_email,imported_at,notes,filter_context",
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

export async function loadTimeSeries(metricKey, grain = "day", filterSignature = DEFAULT_FILTER_SIGNATURE) {
  const params = new URLSearchParams({
    select: "period_start,period_end,station_value,benchmark_value,benchmark_label,unit,quality_flags",
    metric_key: `eq.${metricKey}`,
    grain: `eq.${grain}`,
    dimension_type: "eq.",
    filter_signature: `eq.${filterSignature}`,
    order: "period_start.asc",
    limit: "1000"
  });
  return selectRows("wnmufm_analytics_observations", params.toString());
}

export async function loadLatestBreakdown(metricKey, dimensionType, filterSignature = DEFAULT_FILTER_SIGNATURE) {
  const recentParams = new URLSearchParams({
    select: "period_start,period_end",
    metric_key: `eq.${metricKey}`,
    dimension_type: `eq.${dimensionType}`,
    filter_signature: `eq.${filterSignature}`,
    order: "period_end.desc",
    limit: "1"
  });
  const recent = await selectRows("wnmufm_analytics_observations", recentParams.toString());
  const latest = recent?.[0];
  if (!latest) return [];

  const params = new URLSearchParams({
    select: "dimension_value,station_value,benchmark_value,benchmark_label,unit,period_start,period_end",
    metric_key: `eq.${metricKey}`,
    dimension_type: `eq.${dimensionType}`,
    filter_signature: `eq.${filterSignature}`,
    period_start: `eq.${latest.period_start}`,
    period_end: `eq.${latest.period_end}`,
    order: "station_value.desc.nullslast",
    limit: "500"
  });
  return selectRows("wnmufm_analytics_observations", params.toString());
}

export async function loadLatestValues(metricKeys, grain = "day") {
  const output = {};
  await Promise.all(metricKeys.map(async (metricKey) => {
    const params = new URLSearchParams({
      select: "metric_key,metric_label,station_value,benchmark_value,benchmark_label,unit,period_start,period_end",
      metric_key: `eq.${metricKey}`,
      grain: `eq.${grain}`,
      dimension_type: "eq.",
      filter_signature: `eq.${DEFAULT_FILTER_SIGNATURE}`,
      order: "period_start.desc",
      limit: "1"
    });
    const rows = await selectRows("wnmufm_analytics_observations", params.toString());
    if (rows?.[0]) output[metricKey] = rows[0];
  }));
  return output;
}

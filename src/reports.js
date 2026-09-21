import { cleanNumber, durationToSeconds, parsePercent } from "./csv.js";

const REPORT_TYPES = Object.freeze({
  AUDIO: "audio_downloads",
  AUDIO_DRILLDOWN: "audio_program_drilldown",
  STREAMING: "station_streaming",
  WEBSITE: "station_website",
  NPR_ONE: "npr_one"
});

const PRIMARY_FILES = Object.freeze({
  [REPORT_TYPES.AUDIO]: "downloads.csv",
  [REPORT_TYPES.AUDIO_DRILLDOWN]: "downloads.csv",
  [REPORT_TYPES.STREAMING]: "listeners.csv",
  [REPORT_TYPES.WEBSITE]: "active_users.csv",
  [REPORT_TYPES.NPR_ONE]: "active_npr_one_listeners_(localized_on_mobile_apps).csv"
});

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isoDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  return null;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthEnd(dateText) {
  const date = new Date(`${dateText.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function periodEndFor(start, grain) {
  if (!start) return null;
  if (grain === "week") return addDays(start, 6);
  if (grain === "month") return monthEnd(start);
  return start;
}

export function inferGrain(dateValues) {
  const raw = (dateValues || []).map((value) => String(value || "").trim()).filter(Boolean);
  if (!raw.length) return "unknown";
  if (raw.every((value) => /^\d{4}-\d{2}$/.test(value))) return "month";

  const dates = raw.map(isoDate).filter(Boolean);
  if (!dates.length) return "unknown";
  if (dates.length === 1) return "day";

  const millis = dates.map((value) => Date.parse(`${value}T12:00:00Z`));
  const gaps = millis.slice(1).map((value, index) => Math.round((value - millis[index]) / 86400000)).filter((value) => value > 0);
  const gap = median(gaps);
  const allMonthStarts = dates.every((value) => value.endsWith("-01"));
  if (allMonthStarts && gap >= 25) return "month";
  if (gap >= 6 && gap <= 8) return "week";
  return "day";
}

function firstColumn(rows) {
  if (!rows?.length) return null;
  return Object.keys(rows[0])[0] || null;
}

function dateColumnFor(reportType, rows) {
  const preferred = {
    [REPORT_TYPES.STREAMING]: "Date Date",
    [REPORT_TYPES.WEBSITE]: "Time Unit",
    [REPORT_TYPES.AUDIO]: "Time Unit",
    [REPORT_TYPES.AUDIO_DRILLDOWN]: "Time Unit",
    [REPORT_TYPES.NPR_ONE]: "Dynamic Timeframe"
  }[reportType];
  if (rows?.length && preferred in rows[0]) return preferred;
  return firstColumn(rows);
}

export function detectReport(fileNames) {
  const lowered = (fileNames || []).map((name) => String(name).toLowerCase());
  const joined = lowered.join("\n");
  const basenames = new Set(lowered.map((name) => name.split("/").pop()));

  if (joined.includes("audio_downloads_program_drilldown")) return REPORT_TYPES.AUDIO_DRILLDOWN;
  if (basenames.has("active_npr_one_listeners_(localized_on_mobile_apps).csv")) return REPORT_TYPES.NPR_ONE;
  if (basenames.has("listeners.csv") && basenames.has("total_listener_hours.csv")) return REPORT_TYPES.STREAMING;
  if (basenames.has("active_users.csv") && basenames.has("channels_table.csv")) return REPORT_TYPES.WEBSITE;
  if (basenames.has("downloads.csv") && basenames.has("programs.csv")) return REPORT_TYPES.AUDIO;
  return "unknown";
}

export function inferReportRange(reportType, files) {
  const primaryName = PRIMARY_FILES[reportType];
  const rows = files.get(primaryName)?.rows || [];
  const dateColumn = dateColumnFor(reportType, rows);
  const rawDates = dateColumn ? rows.map((row) => row[dateColumn]).filter(Boolean) : [];
  const dates = rawDates.map(isoDate).filter(Boolean).sort();
  const grain = inferGrain(rawDates);
  if (!dates.length) return { grain: "unknown", start: null, end: null };
  return {
    grain,
    start: dates[0],
    end: periodEndFor(dates[dates.length - 1], grain)
  };
}

export function inferDrilldownProgram(files) {
  const programs = files.get("programs.csv")?.rows || [];
  const downloadsRows = files.get("downloads.csv")?.rows || [];
  const drilldownDownloads = downloadsRows.reduce((sum, row) => sum + (cleanNumber(row.Downloads) || 0), 0);
  if (!downloadsRows.length) return { program: null, confidence: "unresolved" };

  const matches = programs.filter((row) => cleanNumber(row.Downloads) === drilldownDownloads);
  if (matches.length !== 1) return { program: null, confidence: matches.length > 1 ? "ambiguous" : "unresolved" };
  return { program: String(matches[0].Program_link || "").trim() || null, confidence: "exact-download-total-match" };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function filterSignature(filterContext = {}, selectedProgram = null) {
  const clean = { ...filterContext };
  Object.keys(clean).forEach((key) => {
    if (clean[key] === "" || clean[key] === null || clean[key] === undefined || clean[key] === "all") delete clean[key];
  });
  if (selectedProgram) clean.selected_program = selectedProgram;
  return stableStringify(clean);
}

function observationBase(context, sourceCsv, sourceRow, metricKey, metricLabel, unit = "count") {
  return {
    station_key: context.stationKey,
    report_type: context.reportType,
    grain: context.grain,
    period_start: context.reportStart,
    period_end: context.reportEnd,
    metric_key: metricKey,
    metric_label: metricLabel,
    unit,
    dimension_type: "",
    dimension_value: "",
    filter_signature: context.filterSignature,
    station_value: null,
    benchmark_value: null,
    benchmark_label: null,
    text_value: null,
    source_import_id: null,
    source_csv: sourceCsv,
    source_row: sourceRow,
    quality_flags: []
  };
}

function pushTimeSeries(output, file, context, spec) {
  if (!file?.rows?.length) return;
  const dateColumn = spec.dateColumn || firstColumn(file.rows);
  file.rows.forEach((row, index) => {
    const start = isoDate(row[dateColumn]);
    if (!start) return;
    const stationValue = cleanNumber(row[spec.stationColumn]);
    if (stationValue === null) return;
    const item = observationBase(context, spec.fileName, index + 2, spec.metricKey, spec.metricLabel, spec.unit);
    item.period_start = start;
    item.period_end = periodEndFor(start, context.grain);
    item.station_value = stationValue;
    if (spec.benchmarkColumn) {
      item.benchmark_value = cleanNumber(row[spec.benchmarkColumn]);
      item.benchmark_label = spec.benchmarkLabel || spec.benchmarkColumn;
    }
    output.push(item);
  });
}

function pushBreakdown(output, rows, context, spec) {
  if (!context.reportStart || !context.reportEnd) return;
  rows.forEach((row, index) => {
    const dimension = String(row[spec.dimensionColumn] ?? "").trim();
    if (!dimension || spec.skip?.(row, dimension)) return;
    spec.metrics.forEach((metric) => {
      const raw = row[metric.column];
      const value = metric.transform ? metric.transform(raw) : cleanNumber(raw);
      if (value === null || value === undefined) return;
      const item = observationBase(context, spec.fileName, index + 2, metric.key, metric.label, metric.unit || "count");
      item.dimension_type = spec.dimensionType;
      item.dimension_value = spec.dimensionTransform ? spec.dimensionTransform(dimension, row) : dimension;
      item.station_value = value;
      if (metric.benchmarkColumn) {
        item.benchmark_value = cleanNumber(row[metric.benchmarkColumn]);
        item.benchmark_label = metric.benchmarkLabel || metric.benchmarkColumn;
      }
      output.push(item);
    });
  });
}

function normalizeStreaming(output, files, context) {
  [
    ["listeners.csv", "streaming.listeners", "Listeners", "listeners", "Typical Station"],
    ["sessions.csv", "streaming.sessions", "Sessions", "sessions", null],
    ["sessions_per_user.csv", "streaming.sessions_per_listener", "Sessions per listener", "sessions_per_listener", "Typical Station"],
    ["minutes_per_session.csv", "streaming.minutes_per_session", "Minutes per session", "minutes", "Typical Station"],
    ["total_listener_hours.csv", "streaming.listener_hours", "Listener hours", "hours", null]
  ].forEach(([fileName, metricKey, metricLabel, unit, benchmarkColumn]) => {
    pushTimeSeries(output, files.get(fileName), context, {
      fileName,
      dateColumn: "Date Date",
      stationColumn: "My Station",
      benchmarkColumn,
      benchmarkLabel: benchmarkColumn ? "Typical Station" : null,
      metricKey,
      metricLabel,
      unit
    });
  });

  pushBreakdown(output, files.get("device_type.csv")?.rows || [], context, {
    fileName: "device_type.csv",
    dimensionColumn: "Device Type",
    dimensionType: "device",
    metrics: [{ key: "streaming.device_share_pct", label: "Device share", column: "My Station", unit: "percent", transform: parsePercent, benchmarkColumn: "Typical Station", benchmarkLabel: "Typical Station" }]
  });

  pushBreakdown(output, files.get("stream_format.csv")?.rows || [], context, {
    fileName: "stream_format.csv",
    dimensionColumn: "Stream Level Metrics Format",
    dimensionType: "stream_format",
    metrics: [{ key: "streaming.sessions_by_format", label: "Sessions by stream format", column: "Stream Level Metrics Sessions", unit: "sessions" }]
  });
}

function normalizeWebsite(output, files, context) {
  [
    ["active_users.csv", "website.active_users", "Active users", "users"],
    ["pageviews.csv", "website.pageviews", "Pageviews", "views"],
    ["total_engaged_hours.csv", "website.engaged_hours", "Engaged hours", "hours"],
    ["engaged_seconds_per_user.csv", "website.engaged_seconds_per_user", "Engaged seconds per user", "seconds"],
    ["views_per_user.csv", "website.views_per_user", "Views per user", "views_per_user"]
  ].forEach(([fileName, metricKey, metricLabel, unit]) => {
    pushTimeSeries(output, files.get(fileName), context, {
      fileName,
      dateColumn: "Time Unit",
      stationColumn: "My Station",
      benchmarkColumn: "Typical Station Website",
      benchmarkLabel: "Typical Station Website",
      metricKey,
      metricLabel,
      unit
    });
  });

  pushBreakdown(output, files.get("channels_table.csv")?.rows || [], context, {
    fileName: "channels_table.csv",
    dimensionColumn: "Channel",
    dimensionType: "traffic_channel",
    metrics: [
      { key: "website.sessions_by_channel", label: "Sessions by channel", column: "Sessions", unit: "sessions" },
      { key: "website.channel_share_pct", label: "Channel share", column: "Share", unit: "percent", transform: parsePercent },
      { key: "website.views_per_session_by_channel", label: "Views per session by channel", column: "Views per Session", unit: "views_per_session" },
      { key: "website.engaged_seconds_per_session_by_channel", label: "Engaged seconds per session by channel", column: "Engaged Seconds per Session", unit: "seconds" }
    ]
  });

  const trend = files.get("channel_trends.csv")?.rows || [];
  trend.forEach((row, index) => {
    const date = isoDate(row.Channel);
    if (!date) return;
    ["Direct", "Email & Newsletters", "Other", "Referral", "Search", "Social"].forEach((channel) => {
      const value = cleanNumber(row[channel]);
      if (value === null) return;
      const item = observationBase(context, "channel_trends.csv", index + 2, "website.sessions_by_channel", "Sessions by channel", "sessions");
      item.period_start = date;
      item.period_end = periodEndFor(date, context.grain);
      item.dimension_type = "traffic_channel";
      item.dimension_value = channel;
      item.station_value = value;
      output.push(item);
    });
  });

  pushBreakdown(output, files.get("geo_-_map.csv")?.rows || [], context, {
    fileName: "geo_-_map.csv",
    dimensionColumn: "Designated Market Area (DMA)",
    dimensionType: "dma",
    metrics: [{ key: "website.sessions_by_dma", label: "Sessions by DMA", column: "Sessions", unit: "sessions" }]
  });

  pushBreakdown(output, files.get("geo_-_table.csv")?.rows || [], context, {
    fileName: "geo_-_table.csv",
    dimensionColumn: "Geo Metrics Country",
    dimensionType: "country",
    metrics: [
      { key: "website.sessions_by_country", label: "Sessions by country", column: "Geo Metrics Sessions", unit: "sessions" },
      { key: "website.views_per_session_by_country", label: "Views per session by country", column: "Geo Metrics Views per Session", unit: "views_per_session" },
      { key: "website.engaged_seconds_per_session_by_country", label: "Engaged seconds per session by country", column: "Geo Metrics Engaged Seconds per Session", unit: "seconds" }
    ]
  });
}

function normalizeAudio(output, files, context, drilldown) {
  const timeSeriesSpecs = drilldown
    ? [
        ["downloads.csv", "Downloads", "audio.downloads", "Downloads", "downloads"],
        ["users.csv", "Users", "audio.users", "Users", "users"],
        ["downloads_per_user.csv", "Downloads per user", "audio.downloads_per_user", "Downloads per user", "downloads_per_user"]
      ]
    : [
        ["downloads.csv", "My Station", "audio.downloads", "Downloads", "downloads"],
        ["users.csv", "My Station", "audio.users", "Users", "users"],
        ["downloads_per_user.csv", "My Station", "audio.downloads_per_user", "Downloads per user", "downloads_per_user"]
      ];

  timeSeriesSpecs.forEach(([fileName, stationColumn, metricKey, metricLabel, unit]) => {
    pushTimeSeries(output, files.get(fileName), context, {
      fileName,
      dateColumn: "Time Unit",
      stationColumn,
      benchmarkColumn: drilldown ? null : "Average Station",
      benchmarkLabel: drilldown ? null : "Average Station",
      metricKey,
      metricLabel,
      unit
    });
  });

  pushBreakdown(output, files.get("players.csv")?.rows || [], context, {
    fileName: "players.csv",
    dimensionColumn: drilldown ? "Overview Metrics Player" : "Player",
    dimensionType: "player",
    metrics: [{
      key: "audio.downloads_by_player",
      label: "Downloads by player",
      column: drilldown ? "Overview Metrics Downloads" : "Downloads",
      unit: "downloads"
    }]
  });

  const playerTrend = files.get("player_trend.csv")?.rows || [];
  playerTrend.forEach((row, index) => {
    const date = isoDate(row.Player);
    if (!date) return;
    Object.keys(row).filter((key) => key !== "Player").forEach((player) => {
      const value = cleanNumber(row[player]);
      if (value === null) return;
      const item = observationBase(context, "player_trend.csv", index + 2, "audio.downloads_by_player", "Downloads by player", "downloads");
      item.period_start = date;
      item.period_end = periodEndFor(date, context.grain);
      item.dimension_type = "player";
      item.dimension_value = player;
      item.station_value = value;
      output.push(item);
    });
  });

  if (!drilldown) {
    pushBreakdown(output, files.get("programs.csv")?.rows || [], context, {
      fileName: "programs.csv",
      dimensionColumn: "Program_link",
      dimensionType: "program",
      metrics: [
        { key: "audio.downloads_by_program", label: "Downloads by program", column: "Downloads", unit: "downloads" },
        { key: "audio.users_by_program", label: "Users by program", column: "Users", unit: "users" }
      ]
    });
  }

  pushBreakdown(output, files.get("segments_episodes.csv")?.rows || [], context, {
    fileName: "segments_episodes.csv",
    dimensionColumn: drilldown ? "Overview Metrics Episode Title" : "Episode Title",
    dimensionType: "episode",
    metrics: [{
      key: "audio.downloads_by_episode",
      label: "Downloads by episode",
      column: drilldown ? "Overview Metrics Downloads" : "Downloads",
      unit: "downloads"
    }]
  });
}

function normalizeNprOne(output, files, context) {
  pushTimeSeries(output, files.get("active_npr_one_listeners_(localized_on_mobile_apps).csv"), context, {
    fileName: "active_npr_one_listeners_(localized_on_mobile_apps).csv",
    dateColumn: "Dynamic Timeframe",
    stationColumn: "My Station",
    benchmarkColumn: null,
    metricKey: "npr_one.localized_listeners",
    metricLabel: "Localized NPR One listeners",
    unit: "listeners"
  });

  pushTimeSeries(output, files.get("average_minutes_(localized_on_mobile_apps).csv"), context, {
    fileName: "average_minutes_(localized_on_mobile_apps).csv",
    dateColumn: "Time Unit Date",
    stationColumn: "My Station",
    benchmarkColumn: "Average Station",
    benchmarkLabel: "Average Station",
    metricKey: "npr_one.average_minutes",
    metricLabel: "Average minutes per localized listener",
    unit: "minutes"
  });

  const hourRows = files.get("at_what_time_of_day_is_my_audience_listening__(localized_on_mobile_apps).csv")?.rows || [];
  hourRows.forEach((row, index) => {
    const hour = String(row["Day of Week"] ?? "").trim().padStart(2, "0");
    if (!/^\d{2}$/.test(hour)) return;
    [["WEEKDAYS", "weekday"], ["WEEKENDS", "weekend"]].forEach(([column, part]) => {
      const value = cleanNumber(row[column]);
      if (value === null || !context.reportStart || !context.reportEnd) return;
      const item = observationBase(context, "at_what_time_of_day_is_my_audience_listening__(localized_on_mobile_apps).csv", index + 2, "npr_one.average_hourly_listeners", "Average hourly listeners", "listeners");
      item.dimension_type = "hour_weekpart";
      item.dimension_value = `${part}|${hour}`;
      item.station_value = value;
      output.push(item);
    });
  });

  pushBreakdown(output, files.get("mobile_apps__station_audio_types.csv")?.rows || [], context, {
    fileName: "mobile_apps__station_audio_types.csv",
    dimensionColumn: "Content",
    dimensionType: "station_audio_type",
    metrics: [
      { key: "npr_one.station_users_by_audio_type", label: "Station users by audio type", column: "Station Users", unit: "users" },
      { key: "npr_one.all_users_by_audio_type", label: "All users by audio type", column: "All Users", unit: "users" },
      { key: "npr_one.listens_by_audio_type", label: "Listens by audio type", column: "Total Listens", unit: "listens" },
      { key: "npr_one.duration_seconds_by_audio_type", label: "Average duration by audio type", column: "Average Duration", unit: "seconds", transform: durationToSeconds },
      { key: "npr_one.completion_pct_by_audio_type", label: "Average completion by audio type", column: "Average Completion", unit: "percent", transform: parsePercent }
    ]
  });

  pushBreakdown(output, files.get("mobile_apps__station_podcasts.csv")?.rows || [], context, {
    fileName: "mobile_apps__station_podcasts.csv",
    dimensionColumn: "Podcast Title",
    dimensionType: "podcast",
    metrics: [
      { key: "npr_one.station_users_by_podcast", label: "Station users by podcast", column: "Station Users", unit: "users" },
      { key: "npr_one.all_users_by_podcast", label: "All users by podcast", column: "All Users", unit: "users" },
      { key: "npr_one.listens_by_podcast", label: "Listens by podcast", column: "Total Listens", unit: "listens" },
      { key: "npr_one.duration_seconds_by_podcast", label: "Average duration by podcast", column: "Average Duration", unit: "seconds", transform: durationToSeconds },
      { key: "npr_one.completion_pct_by_podcast", label: "Average completion by podcast", column: "Average Completion", unit: "percent", transform: parsePercent }
    ]
  });

  pushBreakdown(output, files.get("station_stories__apps_vs_alexa_other_-_product_platforms_listeners.csv")?.rows || [], context, {
    fileName: "station_stories__apps_vs_alexa_other_-_product_platforms_listeners.csv",
    dimensionColumn: "Client Type",
    dimensionType: "client",
    metrics: [{ key: "npr_one.station_story_listeners_by_client", label: "Station story listeners by client", column: "Total Distinct Listeners", unit: "listeners" }]
  });

  [
    ["alexa_(play_the_news,_npr_one).csv", "Alexa"],
    ["web_app_(onenprorg).csv", "one.npr.org"],
    ["sonos,_gm,_xbox,_lexus,_toyota,_apple_tv,_firetv,_windows.csv", "Other connected platforms"]
  ].forEach(([fileName, client]) => {
    pushBreakdown(output, files.get(fileName)?.rows || [], context, {
      fileName,
      dimensionColumn: "Content",
      dimensionType: "client_content",
      dimensionTransform: (content) => `${client}|${content}`,
      metrics: [
        { key: "npr_one.all_users_by_client_content", label: "All users by client and content", column: "All Users", unit: "users" },
        { key: "npr_one.listens_by_client_content", label: "Listens by client and content", column: "Total Listens", unit: "listens" },
        { key: "npr_one.duration_seconds_by_client_content", label: "Average duration by client and content", column: "Average Duration", unit: "seconds", transform: durationToSeconds },
        { key: "npr_one.completion_pct_by_client_content", label: "Average completion by client and content", column: "Average Completion", unit: "percent", transform: parsePercent }
      ]
    });
  });
}

export function normalizeReport({ reportType, files, stationKey, filterContext = {}, selectedProgram = null }) {
  const range = inferReportRange(reportType, files);
  if (!range.start || !range.end || range.grain === "unknown") {
    return { range, observations: [], status: "partial" };
  }

  const context = {
    stationKey,
    reportType,
    grain: range.grain,
    reportStart: range.start,
    reportEnd: range.end,
    filterSignature: filterSignature(filterContext, selectedProgram)
  };
  const observations = [];

  if (reportType === REPORT_TYPES.STREAMING) normalizeStreaming(observations, files, context);
  else if (reportType === REPORT_TYPES.WEBSITE) normalizeWebsite(observations, files, context);
  else if (reportType === REPORT_TYPES.AUDIO) normalizeAudio(observations, files, context, false);
  else if (reportType === REPORT_TYPES.AUDIO_DRILLDOWN) normalizeAudio(observations, files, context, true);
  else if (reportType === REPORT_TYPES.NPR_ONE) normalizeNprOne(observations, files, context);

  return { range, observations, status: observations.length ? "imported" : "partial" };
}

export function detectAnomalies(observations, reportType, selectedProgram = null) {
  const anomalies = [];
  if (reportType === REPORT_TYPES.AUDIO || reportType === REPORT_TYPES.AUDIO_DRILLDOWN) {
    const byDate = new Map();
    observations.filter((item) => item.dimension_type === "" && ["audio.downloads", "audio.users", "audio.downloads_per_user"].includes(item.metric_key)).forEach((item) => {
      const bucket = byDate.get(item.period_start) || {};
      bucket[item.metric_key] = item.station_value;
      byDate.set(item.period_start, bucket);
    });
    byDate.forEach((metrics, date) => {
      const downloads = metrics["audio.downloads"];
      const users = metrics["audio.users"];
      const ratio = metrics["audio.downloads_per_user"] ?? (downloads && users ? downloads / users : null);
      if ((ratio !== null && ratio >= 10) || (downloads >= 100 && users !== null && users <= 10)) {
        anomalies.push({
          anomaly_key: `bulk_audio_${date}_${selectedProgram || "overview"}`,
          severity: ratio >= 25 ? "high" : "warning",
          title: "Possible bulk audio retrieval",
          detail: `${date}: ${downloads ?? "?"} downloads from ${users ?? "?"} users${ratio !== null ? ` (${ratio.toFixed(1)} downloads per user)` : ""}.`,
          evidence: { date, downloads, users, downloads_per_user: ratio, selected_program: selectedProgram }
        });
      }
    });
  }

  if (reportType === REPORT_TYPES.WEBSITE) {
    const users = observations.filter((item) => item.metric_key === "website.active_users" && item.dimension_type === "");
    const engagement = new Map(observations.filter((item) => item.metric_key === "website.engaged_seconds_per_user" && item.dimension_type === "").map((item) => [item.period_start, item.station_value]));
    const typical = median(users.map((item) => item.station_value).filter((value) => Number.isFinite(value)));
    if (typical && users.length >= 7) {
      users.forEach((item) => {
        const engaged = engagement.get(item.period_start);
        if (item.station_value >= typical * 5 && engaged !== undefined && engaged < 10) {
          anomalies.push({
            anomaly_key: `website_spike_${item.period_start}`,
            severity: item.station_value >= typical * 20 ? "high" : "warning",
            title: "Website traffic spike with very low engagement",
            detail: `${item.period_start}: ${Math.round(item.station_value).toLocaleString()} active users with ${Number(engaged).toFixed(1)} engaged seconds per user.`,
            evidence: { date: item.period_start, active_users: item.station_value, engaged_seconds_per_user: engaged, median_active_users: typical }
          });
        }
      });
    }
  }

  return anomalies;
}

export function reportLabel(reportType) {
  return {
    [REPORT_TYPES.AUDIO]: "Audio Downloads",
    [REPORT_TYPES.AUDIO_DRILLDOWN]: "Audio Program Drilldown",
    [REPORT_TYPES.STREAMING]: "Station Streaming",
    [REPORT_TYPES.WEBSITE]: "Station Website",
    [REPORT_TYPES.NPR_ONE]: "NPR One"
  }[reportType] || "Unknown report";
}

export { REPORT_TYPES };

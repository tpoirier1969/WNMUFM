import { APP_VERSION } from "./version.js";
import { consumeOAuthCallback, currentUser, fetchRole, getSession, signIn, signInWithGitHub, signOut, updateRows } from "./api.js";
import { invalidateDataCache, loadAvailableDataRange, loadBreakdownDimensionMetrics, loadDateObservations, loadImports, loadLatestBreakdown, loadLatestValues, loadLongestBreakdown, loadOpenAnomalies, loadReviewedAnomalies, loadTimeSeries, loadTimeSeriesRange } from "./data.js";
import { importExport } from "./importer.js";
import { renderBarChart, renderIndexedMultiLineChart, renderLineChart, formatMetric } from "./charts.js";
import { formatDayDate, formatPeriod, indexToMedian, isWeekendDate, matchesWeekpart, median, percentFromMedian, shortDayLabel, shortMonthLabel } from "./analysis.js";
import { matchesNotableDateMode, notableContextLabel, notableDateContext } from "./notable-dates.js";
import { buildHourSchedule, buildTypicalHourContext, entryHourDayOffset, hourLabel } from "./schedule.js";
import { fetchComposerSchedule, fetchExactComposerScheduleRange } from "./schedule-client.js";
import { CONFIG } from "./config.js";
import { buildViewSearch, parseViewState, validIsoDate } from "./view-state.js";
import { buildRangePresets, defaultRecentRange } from "./range-presets.js";
import { analyzeTakeaways, sortTakeaways, TAKEAWAY_BENCHMARK_METRICS, TAKEAWAY_CATEGORIES, TAKEAWAY_METRICS } from "./takeaways.js";
import { analyzeScheduleTakeaways } from "./schedule-analysis.js";
import { buildCoverageRows, intersectRanges } from "./coverage-summary.js";

const els = Object.fromEntries([
  "startupPanel","authPanel","appPanel","loginForm","loginEmail","loginPassword","loginMessage","githubLoginButton","userBadge","logoutButton","printButton",
  "refreshButton","summaryCards","trendMetricButtons","trendQuickRangeButtons","trendGrain","trendWeekpartControls","trendWeekpartButtons","trendNotableControls","trendNotableButtons","trendProgramControl","trendProgramSelect","trendMedianSummary","trendBenchmarkNote","trendZoomButton","trendZoomReset","trendZoomStatus","trendTitle","trendDescription","trendChart","trendDataDetails","trendDataSummary","trendTable","trendPrintColumns","programBars",
  "deviceBars","channelBars","streamingWeekpartBars","streamingWeekpartNote","listeningHourPanel","scheduleProgramFilterControl","scheduleProgramFilter","nprHourChart","nprHourTable","nprHourDescription","detailDialog","detailDialogEyebrow","detailDialogTitle","detailDialogBody","detailDialogClose","anomalyCount","anomalyList","coverageTable","dropZone","fileInput",
  "filterName","filterValue","importQueue","importHistory","collectionChecklist","versionBadge","exploreViewButtons","exploreDescription","explorePeriod","exploreChart","takeawayCategoryButtons","takeawaySummary","takeawayList","globalStartDate","globalEndDate","clearDateRange","copyViewButton","copyViewStatus","availableRangeLabel","dataAvailability","dataAvailabilityHint","dataAvailabilityRows"
].map((id) => [id, document.getElementById(id)]));

const UI_STATE_KEY = "wnmufm.analytics.ui";
const restoredUi = (() => {
  try { return JSON.parse(sessionStorage.getItem(UI_STATE_KEY) || "{}"); } catch { return {}; }
})();
const sharedView = parseViewState(window.location.search);
const validDateKey = validIsoDate;
const validChoice = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const sharedOrRestored = (key, fallback = "") => sharedView[key] !== undefined ? sharedView[key] : (restoredUi[key] ?? fallback);
const initialStartDate = validDateKey(sharedOrRestored("startDate",""));
const initialEndDate = validDateKey(sharedOrRestored("endDate",""));
const initialTrendZoomStart = validDateKey(sharedOrRestored("trendZoomStart",""));
const initialTrendZoomEnd = validDateKey(sharedOrRestored("trendZoomEnd",""));
const initialRangeMode = validChoice(sharedOrRestored("rangeMode",""), ["all","custom","recent13"], (initialStartDate || initialEndDate) ? "custom" : "recent13");
const initialMetrics = Array.isArray(sharedView.trendMetrics) && sharedView.trendMetrics.length
  ? sharedView.trendMetrics
  : (Array.isArray(restoredUi.trendMetrics) && restoredUi.trendMetrics.length ? restoredUi.trendMetrics : ["streaming.listeners"]);

const state = {
  role:null,
  loading:false,
  trendMetrics:initialMetrics,
  trendGrain:validChoice(sharedOrRestored("trendGrain","day"), ["day","week","month"], "day"),
  trendWeekpart:validChoice(sharedOrRestored("trendWeekpart","all"), ["all","weekday","weekend","mon","tue","wed","thu","fri","sat","sun"], "all"),
  trendNotable:validChoice(sharedOrRestored("trendNotable","all"), ["all","exclude","only"], "all"),
  trendProgram:sharedOrRestored("trendProgram",""),
  trendZoomStart:initialTrendZoomStart,
  trendZoomEnd:initialTrendZoomEnd,
  trendZoomMode:false,
  scheduleProgram:"",
  startDate:initialStartDate,
  endDate:initialEndDate,
  rangeMode:initialRangeMode,
  availableRange:{ startDate:"", endDate:"" },
  activeTab:validChoice(sharedOrRestored("activeTab","overview"), ["overview","takeaways","explore","imports"], "overview"),
  exploreView:validChoice(sharedOrRestored("exploreView","audio-programs"), ["audio-programs","audio-players","ga4-pages","ga4-landing","ga4-traffic","ga4-sources","ga4-events","ga4-countries","ga4-cities","ga4-browser","ga4-devices","ga4-screens","website-channels","website-countries","streaming-devices","npr-one-podcasts","npr-one-audio","npr-one-clients"], "audio-programs"),
  takeawayCategory:validChoice(sharedOrRestored("takeawayCategory","all"), TAKEAWAY_CATEGORIES.map(([key])=>key), "all")
};
let busyDepth = 0;
let trendRequestId = 0;
let exploreRequestId = 0;
let breakdownRequestId = 0;
let listeningHourContext = null;
let listeningHourNoticeKey = "";
let takeawayFindings = [];
let takeawayRangeKey = "";
let takeawayScheduleNotice = "";
let rangeEditPending = false;
let rangeBlurCommitTimer = null;

function viewStateSnapshot() {
  return {
    activeTab:state.activeTab,
    startDate:state.startDate,
    endDate:state.endDate,
    rangeMode:state.rangeMode,
    exploreView:state.exploreView,
    trendMetrics:state.trendMetrics,
    trendGrain:state.trendGrain,
    trendWeekpart:state.trendWeekpart,
    trendNotable:state.trendNotable,
    trendProgram:state.trendProgram,
    trendZoomStart:state.trendZoomStart,
    trendZoomEnd:state.trendZoomEnd,
    takeawayCategory:state.takeawayCategory
  };
}

function syncViewUrl() {
  const search = buildViewSearch(viewStateSnapshot());
  const next = `${window.location.pathname}${search}`;
  window.history.replaceState(null, document.title, next);
}

function persistUiState() {
  try {
    sessionStorage.setItem(UI_STATE_KEY,JSON.stringify(viewStateSnapshot()));
  } catch {
    // Session persistence is convenience state, not analytics data.
  }
  syncViewUrl();
}

function selectedRange() {
  return { startDate:state.startDate, endDate:state.endDate };
}

function clearTrendZoom({ persist = false } = {}) {
  state.trendZoomStart="";
  state.trendZoomEnd="";
  state.trendZoomMode=false;
  updateTrendZoomControls();
  if(persist) persistUiState();
}

function updateTrendZoomControls() {
  const hasZoom=Boolean(state.trendZoomStart && state.trendZoomEnd);
  els.trendZoomButton?.setAttribute("aria-pressed",String(state.trendZoomMode));
  if(els.trendZoomButton) els.trendZoomButton.textContent=state.trendZoomMode ? "✕ Cancel zoom" : "🔍 Zoom";
  setHidden(els.trendZoomReset,!hasZoom);
  if(els.trendZoomStatus) {
    els.trendZoomStatus.textContent=hasZoom
      ? `Zoomed: ${formatDayDate(state.trendZoomStart)} – ${formatDayDate(state.trendZoomEnd)}`
      : (state.trendZoomMode ? "Drag horizontally across the graph to select a date window." : "");
  }
}

function zoomedTrendPoints(points) {
  if(!state.trendZoomStart || !state.trendZoomEnd) return points;
  const filtered=points.filter((point)=>point.date && point.date>=state.trendZoomStart && point.date<=state.trendZoomEnd);
  if(filtered.length>=2) return filtered;
  clearTrendZoom();
  return points;
}

function setTrendZoom(firstPoint,lastPoint) {
  if(!firstPoint?.date || !lastPoint?.date) return;
  state.trendZoomStart=firstPoint.date < lastPoint.date ? firstPoint.date : lastPoint.date;
  state.trendZoomEnd=firstPoint.date < lastPoint.date ? lastPoint.date : firstPoint.date;
  state.trendZoomMode=false;
  updateTrendZoomControls();
  persistUiState();
  void renderTrend();
}

function renderTrendQuickRanges() {
  if(!els.trendQuickRangeButtons) return;
  const presets=buildRangePresets(state.availableRange);
  els.trendQuickRangeButtons.innerHTML=presets.map((preset)=>{
    const active=state.startDate===preset.startDate && state.endDate===preset.endDate;
    return `<button type="button" class="filter-button" data-range-preset="${escapeHtml(preset.key)}" data-start="${escapeHtml(preset.startDate)}" data-end="${escapeHtml(preset.endDate)}" aria-pressed="${active}">${escapeHtml(preset.label)}</button>`;
  }).join("");
}

let copyViewStatusTimer = null;
async function copyCurrentViewLink() {
  persistUiState();
  const url = window.location.href.split("#")[0];
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch {
    copied = false;
  }
  if (!copied) {
    const field = document.createElement("textarea");
    field.value = url;
    field.setAttribute("readonly","");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    copied = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    field.remove();
  }
  els.copyViewStatus.textContent = copied ? "View link copied" : "Could not copy automatically";
  if (copyViewStatusTimer) window.clearTimeout(copyViewStatusTimer);
  copyViewStatusTimer = window.setTimeout(() => { els.copyViewStatus.textContent = ""; }, 2600);
}

function setBusy(isBusy) {
  busyDepth = Math.max(0, busyDepth + (isBusy ? 1 : -1));
  const busy = busyDepth > 0;
  document.body.classList.toggle("app-busy", busy);
  document.body.setAttribute("aria-busy", String(busy));
}

async function withBusy(work) {
  setBusy(true);
  try {
    return await work();
  } finally {
    setBusy(false);
  }
}


const TREND_METRICS = [
  { key:"streaming.listeners", label:"Streaming listeners", priority:"primary" },
  { key:"streaming.listener_hours", label:"Listener hours", priority:"primary" },
  { key:"website.active_users", label:"Website users", priority:"primary" },
  { key:"website.pageviews", label:"Pageviews", priority:"primary" },
  { key:"ga4.site_page_views", label:"Google Analytics 4 page views", priority:"diagnostic" },
  { key:"ga4.site_sessions", label:"Google Analytics 4 sessions", priority:"diagnostic" },
  { key:"audio.downloads", label:"Audio downloads", priority:"primary" },
  { key:"audio.users", label:"Audio users", priority:"primary" },
  { key:"npr_one.localized_listeners", label:"NPR One listeners", priority:"primary" },
  { key:"npr_one.average_minutes", label:"NPR One minutes", priority:"primary" },
  { key:"streaming.sessions", label:"Streaming sessions", priority:"diagnostic" },
  { key:"website.engaged_seconds_per_user", label:"Website engagement", priority:"diagnostic" }
];

const WEEKPARTS = [
  ["all","All days"],["weekday","Mon–Fri"],["weekend","Weekend"],
  ["mon","Mon"],["tue","Tue"],["wed","Wed"],["thu","Thu"],["fri","Fri"],["sat","Sat"],["sun","Sun"]
];
const NOTABLE_MODES = [["all","All dates"],["exclude","Exclude notable dates"],["only","Notable dates only"]];

function trendMetricLabel(key) {
  return TREND_METRICS.find((item) => item.key === key)?.label || key;
}

function benchmarkDisplayLabel(label) {
  const clean = String(label || "").trim();
  if (!clean) return "";
  return /^NPR\b/i.test(clean) ? clean : `NPR ${clean}`;
}

function benchmarkDefinition(label) {
  const display = benchmarkDisplayLabel(label);
  if (!display) return "";
  return `${display} is supplied by NPR. The imported report does not identify its peer stations or say that the benchmark is matched to WNMU-FM by demographics, household income, market size, rurality, university affiliation, or other local characteristics.`;
}

function renderTrendControlButtons() {
  els.trendMetricButtons.innerHTML = TREND_METRICS.map((item) =>
    `<button type="button" class="filter-button ${item.priority === "diagnostic" ? "diagnostic" : ""}" data-trend-metric="${escapeHtml(item.key)}" aria-pressed="${state.trendMetrics.includes(item.key)}">${escapeHtml(item.label)}</button>`
  ).join("");
  els.trendWeekpartButtons.innerHTML = WEEKPARTS.map(([key,label]) =>
    `<button type="button" class="filter-button" data-weekpart="${key}" aria-pressed="${key === state.trendWeekpart}">${label}</button>`
  ).join("");
  els.trendNotableButtons.innerHTML = NOTABLE_MODES.map(([key,label]) =>
    `<button type="button" class="filter-button" data-notable-mode="${key}" aria-pressed="${key === state.trendNotable}">${label}</button>`
  ).join("");
}

function refreshTrendControlState() {
  els.trendMetricButtons.querySelectorAll("[data-trend-metric]").forEach((button) => {
    button.setAttribute("aria-pressed", String(state.trendMetrics.includes(button.dataset.trendMetric)));
  });
  els.trendWeekpartButtons.querySelectorAll("[data-weekpart]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.weekpart === state.trendWeekpart));
  });
  els.trendNotableButtons.querySelectorAll("[data-notable-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.notableMode === state.trendNotable));
  });
}


function signedPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function scheduleTime(value) {
  if (!value) return "";
  const [hourText,minuteText="00"] = String(value).split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return String(value);
  const suffix = hour < 12 ? "a.m." : "p.m.";
  return `${hour % 12 || 12}:${minuteText} ${suffix}`;
}

function buildDailySchedule(entries) {
  const byDate = new Map();
  entries.forEach((entry) => {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    const key = `${entry.start}|${entry.end}|${entry.program}`;
    if (!byDate.get(entry.date).some((item) => item.key === key)) {
      byDate.get(entry.date).push({ ...entry, key });
    }
  });
  byDate.forEach((items) => items.sort((a,b) => String(a.start).localeCompare(String(b.start)) || a.program.localeCompare(b.program)));
  return byDate;
}

async function renderProgramFilterOptions() {
  const imports = await loadImports();
  const names = [...new Set(imports.filter((item) => item.report_type === "audio_program_drilldown" && item.selected_program).map((item) => item.selected_program))].sort((a,b) => a.localeCompare(b));
  els.trendProgramSelect.innerHTML = '<option value="">All on-demand audio</option>' +
    names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if (state.trendProgram && names.includes(state.trendProgram)) {
    els.trendProgramSelect.value = state.trendProgram;
  } else if (state.trendProgram) {
    state.trendProgram = "";
    persistUiState();
  }
}

function openDetailDialog(title, html, eyebrow = "Deeper dive") {
  els.detailDialogEyebrow.textContent = eyebrow;
  els.detailDialogTitle.textContent = title;
  els.detailDialogBody.innerHTML = html;
  if (typeof els.detailDialog.showModal === "function") els.detailDialog.showModal();
  else els.detailDialog.setAttribute("open","");
}

const DAILY_METRIC_ORDER = [
  "streaming.listeners","streaming.listener_hours","streaming.sessions","streaming.minutes_per_session",
  "website.active_users","website.pageviews","website.engaged_seconds_per_user",
  "ga4.site_page_views","ga4.site_sessions",
  "audio.downloads","audio.users","audio.downloads_per_user",
  "npr_one.localized_listeners","npr_one.average_minutes"
];

async function openDateDrilldown(point, metricKey, medianValue) {
  const date = point.date;
  const notable = notableDateContext(date);
  setBusy(true);
  openDetailDialog(formatDayDate(date), '<p class="empty-state">Loading the day’s context…</p>');
  els.detailDialog.setAttribute("aria-busy","true");
  try {
    const observations = await loadDateObservations(date);
    const primary = observations.filter((row) => !row.dimension_type);
    const byMetric = new Map(primary.map((row) => [row.metric_key,row]));
    const ordered = DAILY_METRIC_ORDER.map((key) => byMetric.get(key)).filter(Boolean);
    const other = primary.filter((row) => !DAILY_METRIC_ORDER.includes(row.metric_key));
    const selected = byMetric.get(metricKey);
    const delta = selected && medianValue !== null ? percentFromMedian(selected.station_value, medianValue) : null;

    let scheduleHtml = '<p class="panel-note">Schedule lookup unavailable for this date.</p>';
    try {
      const scheduleResult = await fetchComposerSchedule(date,date);
      if (scheduleResult.sourceType === "episodes") {
        const dayEntries = buildDailySchedule(scheduleResult.entries).get(date) || [];
        scheduleHtml = dayEntries.length
          ? `<div class="schedule-list">${dayEntries.map((entry) => `<div class="schedule-item"><span>${escapeHtml(scheduleTime(entry.start))}–${escapeHtml(scheduleTime(entry.end))}</span><strong>${escapeHtml(entry.program)}</strong></div>`).join("")}</div>`
          : '<p class="panel-note">No dated Composer schedule entries were returned for this date.</p>';
      } else {
        scheduleHtml = '<p class="source-limit"><strong>Exact dated schedule unavailable.</strong> Composer returned its recurring-program catalog rather than a historical episode schedule. That catalog can contain overlapping or stale recurrences, so the app intentionally does not present those entries as programs that aired on this date.</p>';
      }
    } catch (error) {
      scheduleHtml = `<p class="panel-note">Schedule lookup unavailable: ${escapeHtml(error.message)}</p>`;
    }

    const channelRows = observations.filter((row) => row.metric_key === "website.sessions_by_channel" && row.dimension_type === "traffic_channel");
    const playerRows = observations.filter((row) => row.metric_key === "audio.downloads_by_player" && row.dimension_type === "player");
    const ga4PageRows = observations.filter((row) => row.metric_key === "ga4.page_views" && row.dimension_type === "ga4_page_path");
    const ga4LandingRows = observations.filter((row) => row.metric_key === "ga4.landing_sessions" && row.dimension_type === "ga4_landing_page");
    const ga4ChannelRows = observations.filter((row) => (row.metric_key === "ga4.sessions_by_channel" || row.metric_key === "ga4.channel_event_count") && row.dimension_type === "ga4_session_channel");

    els.detailDialogBody.innerHTML = `
      <div class="detail-summary">
        <div><span>Selected metric</span><strong>${selected ? escapeHtml(formatMetric(selected.station_value,selected.unit)) : escapeHtml(point.value)}</strong></div>
        <div><span>Vs selected-range median</span><strong>${escapeHtml(signedPercent(delta))}</strong></div>
        <div><span>Notable-date context</span><strong>${notable ? escapeHtml(notableContextLabel(notable)) : "No tagged holiday, election or major civic address context"}</strong></div>
      </div>
      <section class="detail-section">
        <h3>What the reports say that day</h3>
        <div class="detail-metric-grid">
          ${[...ordered,...other].map((row) => `<div class="detail-metric"><span>${escapeHtml(row.metric_label || row.metric_key)}</span><strong>${escapeHtml(formatMetric(row.station_value,row.unit))}</strong></div>`).join("") || '<p>No other complete daily metrics are available.</p>'}
        </div>
      </section>
      <section class="detail-section">
        <h3>What was scheduled</h3>
        ${scheduleHtml}
        ${metricKey.startsWith("streaming.") ? '<p class="source-limit">We have daily live-stream totals here, not listener counts by hour or by program. Hourly/sub-hourly streaming data is still required before this app can attribute that audience to individual programs.</p>' : ""}
      </section>
      ${channelRows.length ? '<section class="detail-section"><h3>Website traffic sources that day</h3><div id="detailChannelBars"></div></section>' : ""}
      ${playerRows.length ? '<section class="detail-section"><h3>Audio players that day</h3><div id="detailPlayerBars"></div></section>' : ""}
      ${ga4PageRows.length ? '<section class="detail-section"><h3>Google Analytics 4 pages that day</h3><div id="detailGa4PageBars"></div></section>' : ""}
      ${ga4LandingRows.length ? '<section class="detail-section"><h3>Google Analytics 4 landing pages that day</h3><div id="detailGa4LandingBars"></div></section>' : ""}
      ${ga4ChannelRows.length ? '<section class="detail-section"><h3>Google Analytics 4 session channels that day</h3><div id="detailGa4ChannelBars"></div></section>' : ""}
    `;
    if (channelRows.length) renderBarChart(document.getElementById("detailChannelBars"), channelRows.sort((a,b)=>Number(b.station_value)-Number(a.station_value)).slice(0,8).map((row)=>({label:row.dimension_value,value:row.station_value})));
    if (playerRows.length) renderBarChart(document.getElementById("detailPlayerBars"), playerRows.sort((a,b)=>Number(b.station_value)-Number(a.station_value)).slice(0,8).map((row)=>({label:row.dimension_value,value:row.station_value})));
    if (ga4PageRows.length) renderBarChart(document.getElementById("detailGa4PageBars"), ga4PageRows.sort((a,b)=>Number(b.station_value)-Number(a.station_value)).slice(0,10).map((row)=>({label:row.dimension_value,value:row.station_value})));
    if (ga4LandingRows.length) renderBarChart(document.getElementById("detailGa4LandingBars"), ga4LandingRows.sort((a,b)=>Number(b.station_value)-Number(a.station_value)).slice(0,10).map((row)=>({label:row.dimension_value,value:row.station_value})));
    if (ga4ChannelRows.length) renderBarChart(document.getElementById("detailGa4ChannelBars"), ga4ChannelRows.sort((a,b)=>Number(b.station_value)-Number(a.station_value)).slice(0,10).map((row)=>({label:row.dimension_value,value:row.station_value})));
  } catch (error) {
    els.detailDialogBody.innerHTML = `<p class="empty-state">Could not load this drilldown: ${escapeHtml(error.message)}</p>`;
  } finally {
    els.detailDialog.removeAttribute("aria-busy");
    setBusy(false);
  }
}

function openBreakdownDrilldown(title, row, periodText = "") {
  openDetailDialog(row.label, `
    <div class="detail-summary">
      <div><span>${escapeHtml(title)}</span><strong>${escapeHtml(String(row.formattedValue ?? row.value ?? "—"))}</strong></div>
      <div><span>Period</span><strong>${escapeHtml(periodText || "Latest complete source period")}</strong></div>
    </div>
    <p class="source-limit">This is the first drilldown layer for this category. As the matching source becomes more detailed, this panel can add its date trend, related content, schedule context and comparison baselines.</p>
  `);
}

const METRIC_DESCRIPTIONS = {
  "streaming.listeners": "Unique listeners to WNMU-FM's live digital stream for each period. Use this to track reach. It does not measure how long they listened.",
  "streaming.listener_hours": "Total hours spent listening to the live stream. Use this with listener counts to distinguish broader reach from deeper listening.",
  "streaming.sessions": "Individual live-stream sessions. A listener can create more than one session, so this measures usage occasions rather than unique people.",
  "website.active_users": "People NPR/Google Analytics counted as active visitors to wnmufm.org. Sudden spikes should be checked against engagement, geography and traffic source before being treated as audience growth.",
  "website.pageviews": "Pages viewed on wnmufm.org. Useful for overall site activity, but strongest when paired with users, engagement and acquisition source.",
  "website.engaged_seconds_per_user": "Average engaged time per website user. Low values during a traffic spike can reveal automated, accidental or low-quality visits.",
  "ga4.site_page_views": "Daily page views from the dated Google Analytics 4 Free Form export. This is an additive website-activity measure and is kept separate from NPR Website Analytics pageviews.",
  "ga4.site_sessions": "Daily sessions from the dated Google Analytics 4 landing-page export. Each session has one landing page, so these rows can be summed safely into a sitewide daily session total.",
  "audio.downloads": "On-demand audio file downloads. Use program, episode and player drilldowns to determine whether movement comes from real audience interest or bulk/archive retrieval.",
  "audio.users": "Unique users downloading on-demand audio in the NPR reporting period. Do not add daily unique users to manufacture weekly or monthly uniques.",
  "npr_one.localized_listeners": "Listeners localized to WNMU-FM in NPR One. This is an NPR One audience measure, not the same population as the live stream.",
  "npr_one.average_minutes": "Average listening minutes among localized NPR One listeners. Use it as an engagement measure within NPR One, not as live-stream session duration."
};

const EXPLORE_VIEWS = {
  "audio-programs": {
    title: "On-demand downloads by program",
    metric: "audio.downloads_by_program",
    dimension: "program",
    description: "Compare which WNMU-FM program/content buckets generated on-demand downloads in the latest complete export. Station Stories is a broad archive bucket and should not be treated as directly comparable with a discrete program."
  },
  "audio-players": {
    title: "On-demand downloads by player",
    metric: "audio.downloads_by_player",
    dimension: "player",
    description: "Shows which player/client requested WNMU-FM audio. This is especially useful for separating broad audience changes from browser-driven or automated-looking download bursts."
  },
  "ga4-pages": {
    title: "Website content",
    metric: "ga4.page_views",
    dimension: "ga4_page_path",
    sourceRange:true,
    detailMetrics:["ga4.page_views","ga4.page_active_users","ga4.page_views_per_user","ga4.page_engagement_seconds_per_user","ga4.page_event_count"],
    description: "Google Analytics page-level performance. Views show consumption; click a page to compare reach, repeat viewing, engagement time and events. Whole-period exports remain the primary ranked view; dated Free Form exports also feed daily Google Analytics 4 trends and date drilldowns."
  },
  "ga4-landing": {
    title: "Entry content",
    metric: "ga4.landing_sessions",
    dimension: "ga4_landing_page",
    sourceRange:true,
    detailMetrics:["ga4.landing_sessions","ga4.landing_active_users","ga4.landing_new_users","ga4.landing_engagement_seconds_per_session"],
    description: "Shows which page began a session. This separates pages that are merely viewed from pages that actually bring people into WNMU-FM."
  },
  "ga4-traffic": {
    title: "Google Analytics 4 traffic acquisition",
    metric: "ga4.sessions_by_channel",
    dimension: "ga4_session_channel",
    sourceRange:true,
    detailMetrics:["ga4.sessions_by_channel","ga4.engaged_sessions_by_channel","ga4.engagement_rate_by_channel","ga4.engagement_seconds_per_session_by_channel","ga4.events_per_session_by_channel"],
    description: "Session acquisition from Google Analytics. Use engagement alongside volume so a large source is not automatically treated as high-quality audience traffic."
  },
  "ga4-sources": {
    title: "Referral and source detail",
    metric: "ga4.sessions_by_manual_source",
    dimension: "ga4_manual_source",
    sourceRange:true,
    description: "More specific source labels from Google Analytics 4, such as search engines, social sites, NPR properties, newsletters or other referring systems when Google provides them."
  },
  "ga4-events": {
    title: "Website actions",
    metric: "ga4.event_count",
    dimension: "ga4_event",
    sourceRange:true,
    detailMetrics:["ga4.event_count","ga4.event_users","ga4.event_count_per_user"],
    description: "Google Analytics 4 events include page views plus station-relevant actions such as audio_action, player_interactions, outbound links, forms, downloads and search."
  },
  "ga4-countries": {
    title: "Google Analytics 4 countries",
    metric: "ga4.country_active_users",
    dimension: "ga4_country",
    sourceRange:true,
    detailMetrics:["ga4.country_active_users","ga4.country_new_users","ga4.country_engaged_sessions","ga4.country_engagement_rate","ga4.country_engagement_seconds_per_user"],
    description: "Country-level audience volume and engagement from Google Analytics 4. Geography and low engagement can reveal traffic that should not be treated as equivalent to WNMU's service-area audience."
  },
  "ga4-cities": {
    title: "Google Analytics 4 cities",
    metric: "ga4.city_active_users",
    dimension: "ga4_city",
    sourceRange:true,
    description: "City-level Google Analytics 4 traffic used mainly as a traffic-quality diagnostic. Geography is evidence to investigate, not proof that a visitor is invalid."
  },
  "ga4-browser": {
    title: "Browser diagnostics",
    metric: "ga4.browser_active_users",
    dimension: "ga4_browser",
    sourceRange:true,
    detailMetrics:["ga4.browser_active_users","ga4.browser_engagement_rate","ga4.browser_engagement_seconds_per_user"],
    description: "Browser mix is diagnostic context. Large concentrations paired with near-zero engagement can help explain unusual website traffic."
  },
  "ga4-devices": {
    title: "Device diagnostics",
    metric: "ga4.device_active_users",
    dimension: "ga4_device_category",
    sourceRange:true,
    description: "Google Analytics 4 device category is supporting evidence for traffic-quality review, not a primary programming metric."
  },
  "ga4-screens": {
    title: "Screen diagnostics",
    metric: "ga4.screen_active_users",
    dimension: "ga4_screen_resolution",
    sourceRange:true,
    description: "Screen-resolution concentrations can help identify nonrepresentative traffic patterns. This is diagnostic rather than a headline audience measure."
  },
  "website-channels": {
    title: "NPR website traffic sources",
    metric: "website.sessions_by_channel",
    dimension: "traffic_channel",
    description: "Shows how visitors reached wnmufm.org in NPR's website export. Direct / unknown referrer means NPR received no usable referring source; it can include typed or bookmarked visits, apps, privacy-stripped referrals, and untagged links. Search engines combines search traffic. The NPR export does not identify Google, Bing, or other engines separately; Google Analytics 4 acquisition views provide more detailed website analysis when available."
  },
  "website-countries": {
    title: "NPR website countries",
    metric: "website.sessions_by_country",
    dimension: "country",
    description: "Country traffic from the NPR website export. Google Analytics 4 country analysis adds engagement detail and should be preferred for traffic-quality investigation when available."
  },
  "streaming-devices": {
    title: "Live-stream device share",
    metric: "streaming.device_share_pct",
    dimension: "device",
    description: "Share of live-stream usage by device class. Percentage bars use a true 0–100% scale, so a 62.8% share occupies 62.8% of the bar."
  },
  "npr-one-podcasts": {
    title: "NPR One station podcast users",
    metric: "npr_one.station_users_by_podcast",
    dimension: "podcast",
    description: "Shows localized NPR One users consuming individual WNMU-FM podcasts. Treat small counts carefully and watch longer-term direction."
  },
  "npr-one-audio": {
    title: "NPR One listens by station audio type",
    metric: "npr_one.listens_by_audio_type",
    dimension: "station_audio_type",
    description: "Separates WNMU-FM station stories, podcast episodes and other station audio inside NPR One."
  },
  "npr-one-clients": {
    title: "NPR One users by client/content",
    metric: "npr_one.all_users_by_client_content",
    dimension: "client_content",
    description: "Shows where NPR One station content was consumed, such as mobile apps, Alexa or web, paired with the content category."
  }
};

const EXPLORE_ORDER = [
  ["ga4-pages","Website content"],
  ["ga4-landing","Entry pages"],
  ["ga4-traffic","Google Analytics 4 traffic"],
  ["ga4-sources","Referral sources"],
  ["ga4-events","Website actions"],
  ["ga4-countries","Google Analytics 4 countries"],
  ["ga4-cities","Google Analytics 4 cities"],
  ["ga4-browser","Browser diagnostics"],
  ["ga4-devices","Device diagnostics"],
  ["ga4-screens","Screen diagnostics"],
  ["audio-programs","Downloads by program"],
  ["audio-players","Downloads by player"],
  ["website-channels","NPR web sources"],
  ["website-countries","NPR web countries"],
  ["streaming-devices","Stream devices"],
  ["npr-one-podcasts","NPR One podcasts"],
  ["npr-one-audio","NPR One audio"],
  ["npr-one-clients","NPR One clients"]
];

function renderExploreControlButtons() {
  els.exploreViewButtons.innerHTML = EXPLORE_ORDER.map(([key,label]) =>
    `<button type="button" class="filter-button" data-explore-view="${key}" aria-pressed="${key === state.exploreView}">${escapeHtml(label)}</button>`
  ).join("");
}

function renderTakeawayControlButtons() {
  if(!els.takeawayCategoryButtons) return;
  els.takeawayCategoryButtons.innerHTML = TAKEAWAY_CATEGORIES.map(([key,label]) =>
    `<button type="button" class="filter-button" data-takeaway-category="${escapeHtml(key)}" aria-pressed="${String(key===state.takeawayCategory)}">${escapeHtml(label)}</button>`
  ).join("");
}

function takeawayCategoryLabel(key) {
  return TAKEAWAY_CATEGORIES.find(([value])=>value===key)?.[1] || key;
}

function takeawayAnalysisKey() {
  return `${state.startDate || ""}|${state.endDate || ""}`;
}

function shiftIsoDate(value,days) {
  const date=new Date(`${value}T12:00:00Z`);
  if(Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function takeawayScheduleRange() {
  const start=state.startDate || state.availableRange.startDate || "";
  const end=state.endDate || state.availableRange.endDate || "";
  if(!start || !end) return {start:"",end:"",capped:false};
  const earliest=shiftIsoDate(end,-399);
  if(earliest && start<earliest) return {start:earliest,end,capped:true};
  return {start,end,capped:false};
}

function renderTakeawayCards() {
  if(!els.takeawayList || !els.takeawaySummary) return;
  renderTakeawayControlButtons();
  const filtered=state.takeawayCategory==="all"
    ? takeawayFindings
    : takeawayFindings.filter((finding)=>finding.category===state.takeawayCategory);
  const rangeText=state.startDate && state.endDate ? `${formatDayDate(state.startDate)} – ${formatDayDate(state.endDate)}` : "the available imported range";
  const scheduleSuffix=takeawayScheduleNotice ? ` ${takeawayScheduleNotice}` : "";
  els.takeawaySummary.textContent = filtered.length
    ? `${filtered.length} evidence-backed ${filtered.length===1 ? "finding" : "findings"} for ${rangeText}. Findings are sorted with the most actionable items first and use source-valid coverage even when it is shorter than the Analysis Range.${scheduleSuffix}`
    : `No findings in ${takeawayCategoryLabel(state.takeawayCategory)} meet the current evidence thresholds for ${rangeText}.${scheduleSuffix}`;
  if(!filtered.length) {
    els.takeawayList.innerHTML='<p class="empty-state takeaway-empty">Nothing strong enough to call out here yet. The app leaves weak or unsupported patterns unstated.</p>';
    return;
  }

  els.takeawayList.innerHTML=filtered.map((finding)=>{
    const category=takeawayCategoryLabel(finding.category);
    const grainLabel=finding.grain==="month" ? "Monthly" : finding.grain==="week" ? "Weekly" : "Daily";
    const source=finding.sourceStart && finding.sourceEnd
      ? `${formatDayDate(finding.sourceStart)} – ${formatDayDate(finding.sourceEnd)}`
      : "Source span unavailable";
    const sampleLabel=finding.kind==="cross-source-weekpart" || finding.kind==="outlier-group"
      ? `${Number(finding.sampleSize || 0).toLocaleString()} metric-observations`
      : finding.kind==="schedule-change-days"
        ? `${Number(finding.sampleSize || 0).toLocaleString()} dated schedule days`
        : finding.kind==="schedule-correlation"
          ? `${Number(finding.sampleSize || 0).toLocaleString()} matched schedule-change dates`
          : `${Number(finding.sampleSize || 0).toLocaleString()} source observations`;
    const evidenceMeta=`${grainLabel} evidence · ${source} · ${sampleLabel}`;
    const evidenceMetricKeys=Array.isArray(finding.metricKeys) && finding.metricKeys.length
      ? finding.metricKeys
      : (finding.metricKey ? [finding.metricKey] : []);
    const action=evidenceMetricKeys.length
      ? `<div class="takeaway-actions"><button type="button" class="small-button" data-takeaway-evidence data-metrics="${escapeHtml(evidenceMetricKeys.join(","))}" data-grain="${escapeHtml(finding.grain || "day")}" data-start="${escapeHtml(finding.sourceStart || "")}" data-end="${escapeHtml(finding.sourceEnd || "")}">View in Trend Explorer</button></div>`
      : "";
    const cardClass=finding.category==="cross-source" ? " cross-source" : finding.category==="data-quality" ? " data-quality" : finding.category==="scheduling" ? " scheduling" : finding.category==="npr-comparison" ? " npr-comparison" : "";
    return `<article class="takeaway-card${cardClass}" title="${escapeHtml(evidenceMeta)}" data-evidence-meta="${escapeHtml(evidenceMeta)}">`
      <div class="takeaway-card-head">
        <h3>${escapeHtml(finding.title)}</h3>
        <span class="takeaway-category">${escapeHtml(category)}</span>
      </div>
      <p>${escapeHtml(finding.summary)}</p>
      ${action}
    </article>`;
  }).join("");
}

async function renderTakeaways({ force=false }={}) {
  if(!els.takeawayList) return;
  const key=takeawayAnalysisKey();
  if(force || key!==takeawayRangeKey) {
    els.takeawaySummary.textContent="Reviewing imported observations…";
    els.takeawayList.innerHTML='<p class="empty-state takeaway-empty">Looking for repeatable patterns, comparisons, and data-quality signals.</p>';
    const dailyKeys=TAKEAWAY_METRICS.map((metric)=>metric.key);
    const monthlyKeys=TAKEAWAY_METRICS.filter((metric)=>metric.monthly).map((metric)=>metric.key);
    const benchmarkKeys=[...new Set(TAKEAWAY_BENCHMARK_METRICS.map((metric)=>metric.key))];
    const [dailySets,monthlySets,benchmarkSets,reviewedAnomalies]=await Promise.all([
      Promise.all(dailyKeys.map((metricKey)=>loadTimeSeries(metricKey,"day","{}",selectedRange()))),
      Promise.all(monthlyKeys.map((metricKey)=>loadTimeSeries(metricKey,"month","{}",selectedRange()))),
      Promise.all(benchmarkKeys.map((metricKey)=>loadTimeSeries(metricKey,"day","{}",selectedRange()))),
      loadReviewedAnomalies()
    ]);
    const dailyByMetric=Object.fromEntries(dailyKeys.map((metricKey,index)=>[metricKey,dailySets[index]]));
    const monthlyByMetric=Object.fromEntries(monthlyKeys.map((metricKey,index)=>[metricKey,monthlySets[index]]));
    const benchmarkByMetric=Object.fromEntries(benchmarkKeys.map((metricKey,index)=>[metricKey,benchmarkSets[index]]));
    takeawayFindings=analyzeTakeaways({dailyByMetric,monthlyByMetric,benchmarkByMetric,reviewedAnomalies});
    takeawayScheduleNotice="";
    const scheduleRange=takeawayScheduleRange();
    if(scheduleRange.start && scheduleRange.end) {
      const schedule=await fetchExactComposerScheduleRange(scheduleRange.start,scheduleRange.end);
      if(schedule.complete && schedule.entries.length) {
        const scheduleAnalysis=analyzeScheduleTakeaways({entries:schedule.entries,dailyByMetric});
        takeawayFindings=sortTakeaways([...takeawayFindings,...scheduleAnalysis.findings]);
        takeawayScheduleNotice=scheduleRange.capped
          ? `Scheduling findings use the latest 400 days (${shortCoverageDate(scheduleRange.start)} – ${shortCoverageDate(scheduleRange.end)}) so historical Composer lookups stay bounded.`
          : `Scheduling findings use exact dated Composer schedules for ${shortCoverageDate(scheduleRange.start)} – ${shortCoverageDate(scheduleRange.end)}.`;
      } else {
        takeawayScheduleNotice=`Scheduling findings are unavailable for this range because Composer did not provide a complete exact dated schedule: ${schedule.reason || "historical schedule unavailable"}`;
      }
    }
    takeawayRangeKey=key;
  }
  renderTakeawayCards();
}

function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = Boolean(hidden);
  element.style.display = hidden ? "none" : "";
}

function activateTab(tab, persist = true) {
  const target = ["overview","takeaways","explore","imports"].includes(tab) ? tab : "overview";
  state.activeTab = target;
  document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item.dataset.tab === target));
  document.querySelectorAll(".tab-panel").forEach((panel) => setHidden(panel, panel.dataset.panel !== target));
  if (persist) persistUiState();
  if(target==="takeaways" && state.role) void withBusy(()=>renderTakeaways());
}

function formattedRange(range) {
  if (!range?.startDate || !range?.endDate) return "No dated imported data";
  return `${formatDayDate(range.startDate)} – ${formatDayDate(range.endDate)}`;
}

function shortCoverageDate(value) {
  if(!value) return "";
  const date=new Date(`${value}T12:00:00Z`);
  if(Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
}

function shortCoverageSpan(range) {
  if(!range?.startDate || !range?.endDate) return "No coverage";
  return `${shortCoverageDate(range.startDate)} – ${shortCoverageDate(range.endDate)}`;
}

function coverageGrainLabel(grain) {
  if(grain==="day") return "Day";
  if(grain==="week") return "Week";
  if(grain==="month") return "Month";
  return "Aggregate";
}

async function renderDataAvailability() {
  if(!els.dataAvailabilityRows || !els.dataAvailabilityHint) return;
  const [imports,streaming,website,audio,nprOne,google] = await Promise.all([
    loadImports(),
    loadTimeSeriesRange("streaming.listeners","day","{}"),
    loadTimeSeriesRange("website.active_users","day","{}"),
    loadTimeSeriesRange("audio.downloads","day","{}"),
    loadTimeSeriesRange("npr_one.localized_listeners","day","{}"),
    loadTimeSeriesRange("ga4.site_sessions","day","{}")
  ]);
  const rows=buildCoverageRows(imports);
  const commonDaily=intersectRanges([streaming,website,audio,nprOne]);
  const commonText=commonDaily.startDate
    ? `Best cross-source daily comparison: ${shortCoverageSpan(commonDaily)}.`
    : "No shared daily comparison window is available across the four core NPR sources.";
  const googleText=google.startDate
    ? ` Google Analytics 4 dated detail: ${shortCoverageSpan(google)}.`
    : "";
  els.dataAvailabilityHint.innerHTML = `${escapeHtml(commonText+googleText)}${commonDaily.startDate ? ` <button type="button" class="coverage-use-range" data-coverage-start="${escapeHtml(commonDaily.startDate)}" data-coverage-end="${escapeHtml(commonDaily.endDate)}">Use common daily window</button>` : ""}`;

  els.dataAvailabilityRows.innerHTML=rows.map((row)=>`
    <div class="data-availability-row">
      <strong>${escapeHtml(row.label)}</strong>
      <div class="data-availability-grains">
        ${row.grains.map((grain)=>`<span class="coverage-grain"><b>${escapeHtml(coverageGrainLabel(grain.grain))}</b> ${escapeHtml(shortCoverageSpan(grain))}</span>`).join("")}
      </div>
    </div>
  `).join("");
}

function applyRangeControls() {
  els.globalStartDate.value = state.startDate;
  els.globalEndDate.value = state.endDate;

  const available=state.availableRange;
  const hasAvailable=Boolean(available.startDate && available.endDate);
  for(const input of [els.globalStartDate,els.globalEndDate]) {
    input.min=hasAvailable ? available.startDate : "";
    input.max=hasAvailable ? available.endDate : "";
  }
  els.availableRangeLabel.textContent=hasAvailable
    ? `Available imported data: ${formattedRange(available)}`
    : "No dated imported data is available yet.";
  renderTrendQuickRanges();
}

function rangeChanged(a,b) {
  return String(a?.startDate || "") !== String(b?.startDate || "") ||
    String(a?.endDate || "") !== String(b?.endDate || "");
}

async function syncAvailableDataRange() {
  const previous={ ...state.availableRange };
  const next=await loadAvailableDataRange();
  const availableChanged=Boolean(previous.startDate || previous.endDate) && rangeChanged(previous,next);
  state.availableRange={ ...next };

  let selectionChanged=false;
  if(state.rangeMode === "recent13" || (!state.startDate && !state.endDate && state.rangeMode !== "all")) {
    const recent=defaultRecentRange(next,13);
    if(state.startDate !== recent.startDate || state.endDate !== recent.endDate) selectionChanged=true;
    state.startDate=recent.startDate;
    state.endDate=recent.endDate;
    state.rangeMode="recent13";
  } else if(state.rangeMode === "all" || (!state.startDate && !state.endDate)) {
    if(state.startDate !== next.startDate || state.endDate !== next.endDate) selectionChanged=true;
    state.startDate=next.startDate;
    state.endDate=next.endDate;
    state.rangeMode="all";
  } else if(next.startDate && next.endDate) {
    const clampedStart=state.startDate && state.startDate < next.startDate ? next.startDate : state.startDate;
    const clampedEnd=state.endDate && state.endDate > next.endDate ? next.endDate : state.endDate;
    if(clampedStart !== state.startDate || clampedEnd !== state.endDate) selectionChanged=true;
    state.startDate=clampedStart;
    state.endDate=clampedEnd;
  }

  applyRangeControls();
  persistUiState();
  return { previous, next:{ ...next }, availableChanged, selectionChanged };
}

async function refreshAnalysisViews() {
  await Promise.all([
    renderSummary(),
    renderTrend(),
    renderBreakdowns(),
    renderExplore(),
    state.activeTab==="takeaways" ? renderTakeaways() : Promise.resolve()
  ]);
}

function validateAndStoreRange() {
  const startDate=els.globalStartDate.value;
  const endDate=els.globalEndDate.value;
  if(startDate && endDate && startDate>endDate) {
    els.globalEndDate.setCustomValidity("End date must be on or after the start date.");
    els.globalEndDate.reportValidity();
    return false;
  }
  els.globalEndDate.setCustomValidity("");
  state.startDate=startDate;
  state.endDate=endDate;
  state.rangeMode="custom";
  clearTrendZoom();
  renderTrendQuickRanges();
  persistUiState();
  return true;
}

function renderTrendDataTable(html, rowCount) {
  els.trendTable.innerHTML = html || "";
  const hasRows = Number(rowCount || 0) > 0;
  setHidden(els.trendDataDetails, !hasRows);
  if (!hasRows) {
    els.trendDataDetails.open = false;
    return;
  }
  els.trendDataSummary.textContent = `Show period-by-period data (${Number(rowCount).toLocaleString()} rows)`;
}

function renderTrendPrintDetail(rows, grain, medianValue) {
  const MAX_PRINT_DETAIL_ROWS=120;
  if(!rows.length) { els.trendPrintColumns.innerHTML=""; return; }
  if(rows.length>MAX_PRINT_DETAIL_ROWS) {
    els.trendPrintColumns.classList.add("single");
    els.trendPrintColumns.innerHTML=`<p class="print-trend-note"><strong>Detailed rows omitted from this long-range report.</strong> ${rows.length} source periods are selected. The chart and summary statistics remain in the report; use a shorter analysis range when row-by-row detail is needed.</p>`;
    return;
  }
  els.trendPrintColumns.classList.remove("single");
  const midpoint=Math.ceil(rows.length/2);
  const tableFor=(subset)=>`<table><thead><tr><th>Period</th><th class="numeric">WNMU</th><th class="numeric">Vs med.</th></tr></thead><tbody>${subset.map((row)=>{
    const delta=medianValue===null ? null : percentFromMedian(row.station_value,medianValue);
    return `<tr${rowClass(row,grain)}><td>${escapeHtml(formatPeriod(row,grain))}</td><td class="numeric">${escapeHtml(formatMetric(row.station_value,row.unit))}</td><td class="numeric">${escapeHtml(signedPercent(delta))}</td></tr>`;
  }).join("")}</tbody></table>`;
  els.trendPrintColumns.innerHTML=tableFor(rows.slice(0,midpoint))+tableFor(rows.slice(midpoint));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
}

function setAuthenticated(isAuthenticated) {
  setHidden(els.startupPanel, true);
  setHidden(els.authPanel, isAuthenticated);
  setHidden(els.appPanel, !isAuthenticated);
  setHidden(els.logoutButton, !isAuthenticated);
  setHidden(els.printButton, !isAuthenticated);
  setHidden(els.userBadge, !isAuthenticated);
}

function showLoginMessage(message, success = false) {
  els.loginMessage.textContent = message || "";
  els.loginMessage.style.color = success ? "var(--success)" : "var(--danger)";
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function establishAccess({ timeoutMs = 10000 } = {}) {
  try {
    const session = await withTimeout(
      getSession().catch(() => null),
      timeoutMs,
      "Session restoration timed out."
    );
    if (!session?.access_token) {
      setAuthenticated(false);
      return false;
    }

    const role = await withTimeout(
      fetchRole(),
      timeoutMs,
      "Account access lookup timed out."
    );
    if (!role) {
      showLoginMessage("This account is valid, but it has not been assigned WNMU-FM Analytics access.");
      setAuthenticated(false);
      void withTimeout(signOut().catch(() => null), 3000, "Sign out timed out.").catch(() => null);
      return false;
    }

    state.role = role;
    const user = currentUser();
    els.userBadge.textContent = role.display_name || user?.email || "Signed in";
    setAuthenticated(true);
    return true;
  } catch (error) {
    console.error("Could not restore WNMU-FM session", error);
    showLoginMessage("Could not restore the saved session. Please sign in again.");
    setAuthenticated(false);
    return false;
  }
}

function metricCard(title, row) {
  return `<article class="metric-card">
    <h3>${escapeHtml(title)}</h3>
    <div class="metric-value">${row ? escapeHtml(formatMetric(row.station_value, row.unit)) : "—"}</div>
    <div class="metric-sub">${row ? `Latest complete day · ${escapeHtml(formatDayDate(row.period_start))}` : "No complete imported day in this range"}</div>
  </article>`;
}

async function renderSummary() {
  const values = await loadLatestValues([
    "streaming.listeners",
    "streaming.listener_hours",
    "website.active_users",
    "audio.downloads",
    "npr_one.localized_listeners"
  ], "day", selectedRange());
  els.summaryCards.innerHTML = [
    ["Streaming listeners", values["streaming.listeners"]],
    ["Listener hours", values["streaming.listener_hours"]],
    ["Website active users", values["website.active_users"]],
    ["Audio downloads", values["audio.downloads"]],
    ["NPR One listeners", values["npr_one.localized_listeners"]]
  ].map(([title,row]) => metricCard(title,row)).join("");
}

function rowClass(row, grain) {
  return grain === "day" && isWeekendDate(row.period_start) ? ' class="weekend-row"' : "";
}

async function renderTrend() {
  const requestId = ++trendRequestId;
  const validMetricKeys = new Set(TREND_METRICS.map((item)=>item.key));
  state.trendMetrics = state.trendMetrics.filter((key)=>validMetricKeys.has(key));
  if (!state.trendMetrics.length) state.trendMetrics = ["streaming.listeners"];

  const metricKeys = [...state.trendMetrics];
  const multiple = metricKeys.length > 1;
  const grain = state.trendGrain;
  if (els.trendGrain.value !== grain) els.trendGrain.value = grain;
  const programCapable = metricKeys.every((key)=>key === "audio.downloads" || key === "audio.users");
  setHidden(els.trendWeekpartControls, grain !== "day");
  setHidden(els.trendNotableControls, grain !== "day");
  setHidden(els.trendProgramControl, !programCapable);
  refreshTrendControlState();
  updateTrendZoomControls();

  const selectedProgram = programCapable ? state.trendProgram : "";
  const filterSignature = selectedProgram ? JSON.stringify({ selected_program:selectedProgram }) : "{}";
  const metricLabels = metricKeys.map(trendMetricLabel);
  els.trendTitle.textContent = multiple
    ? `Compare: ${metricLabels.join(" + ")}`
    : selectedProgram ? `${metricLabels[0]}: ${selectedProgram}` : metricLabels[0];

  const filterNotes = [];
  if (grain === "day" && state.trendWeekpart !== "all") filterNotes.push(WEEKPARTS.find(([key]) => key === state.trendWeekpart)?.[1]);
  if (grain === "day" && state.trendNotable !== "all") filterNotes.push(NOTABLE_MODES.find(([key]) => key === state.trendNotable)?.[1]);
  if (selectedProgram) filterNotes.push(`Program: ${selectedProgram}`);
  if (state.startDate || state.endDate) filterNotes.push(`Range: ${state.startDate ? formatDayDate(state.startDate) : "earliest"} – ${state.endDate ? formatDayDate(state.endDate) : "latest"}`);

  setHidden(els.trendBenchmarkNote, true);
  els.trendBenchmarkNote.textContent = "";
  if (multiple) {
    els.trendDescription.textContent =
      `Multiple metrics are indexed so each series' selected-range median = 100. Metric color identifies the metric; solid lines are WNMU-FM and dashed lines are the NPR benchmark where NPR supplied one. Hover a node for actual values and percent above/below each series' median.` +
      (filterNotes.length ? ` Showing ${filterNotes.join(" · ")}.` : "");
  } else {
    els.trendDescription.textContent = `${METRIC_DESCRIPTIONS[metricKeys[0]] || ""}${filterNotes.length ? ` Showing ${filterNotes.join(" · ")}.` : ""}`;
  }

  const loaded = await Promise.all(metricKeys.map(async (metricKey)=>{
    const [rows,coverage] = await Promise.all([
      loadTimeSeries(metricKey,grain,filterSignature,selectedRange()),
      loadTimeSeriesRange(metricKey,grain,filterSignature)
    ]);
    const filteredRows = grain === "day"
      ? rows.filter((row)=>matchesWeekpart(row.period_start,state.trendWeekpart) && matchesNotableDateMode(row.period_start,state.trendNotable))
      : rows;
    const numericValues = filteredRows.map((row)=>row.station_value).filter((value)=>value!==null && Number.isFinite(Number(value)));
    const benchmarkValues = filteredRows.map((row)=>row.benchmark_value).filter((value)=>value!==null && Number.isFinite(Number(value)));
    const medianValue = median(numericValues);
    const benchmarkMedian = median(benchmarkValues);
    const latest = [...filteredRows].reverse().find((row)=>row.station_value!==null);
    const benchmarkSourceLabel = filteredRows.find((row)=>row.benchmark_value !== null)?.benchmark_label || "";
    return {
      key:metricKey,
      label:trendMetricLabel(metricKey),
      rows:filteredRows,
      numericValues,
      benchmarkValues,
      median:medianValue,
      benchmarkMedian,
      benchmarkLabel:benchmarkDisplayLabel(benchmarkSourceLabel),
      benchmarkSourceLabel,
      latest,
      unit:filteredRows.find((row)=>row.station_value!==null)?.unit || "",
      coverage
    };
  }));
  if(requestId !== trendRequestId) return;

  const grainLabel=grain === "day" ? "Day" : grain === "week" ? "Week" : "Month";
  const coverageItems=loaded.filter((item)=>item.coverage?.startDate && item.coverage?.endDate);
  if(coverageItems.length) {
    const coverageText=multiple
      ? coverageItems.map((item)=>`${item.label}: ${formatDayDate(item.coverage.startDate)} – ${formatDayDate(item.coverage.endDate)}`).join("; ")
      : `${formatDayDate(coverageItems[0].coverage.startDate)} – ${formatDayDate(coverageItems[0].coverage.endDate)}`;
    els.trendDescription.textContent += multiple
      ? ` Source coverage at ${grainLabel} grain: ${coverageText}.`
      : ` Source coverage for ${coverageItems[0].label} at ${grainLabel} grain: ${coverageText}.`;
  } else {
    els.trendDescription.textContent += ` No imported source coverage is available at ${grainLabel} grain for this selection.`;
  }

  if (!multiple) {
    const result=loaded[0];
    const filteredRows=result.rows;
    const numericValues=result.numericValues;
    const medianValue=result.median;
    const latest=result.latest;
    const metricKey=result.key;
    const label=result.label;

    if (numericValues.length > 0 && numericValues.length < 3) {
      const unitName = grain === "day" ? "days" : grain === "week" ? "weeks" : "months";
      els.trendDescription.textContent += ` Only ${numericValues.length} complete source ${unitName} are available for this selection.`;
    }
    els.trendMedianSummary.innerHTML = medianValue === null ? "" :
      `<span><strong>Median:</strong> ${escapeHtml(formatMetric(medianValue,filteredRows[0]?.unit))}</span>` +
      (latest ? `<span><strong>Latest vs median:</strong> ${escapeHtml(signedPercent(percentFromMedian(latest.station_value,medianValue)))}</span>` : "") +
      `<span><strong>Observations:</strong> ${numericValues.length}</span>`;

    const benchmarkSourceLabel = filteredRows.find((row)=>row.benchmark_value !== null)?.benchmark_label || "";
    const benchmarkLabel = benchmarkDisplayLabel(benchmarkSourceLabel);
    const benchmarkMedian = median(filteredRows.map((row)=>row.benchmark_value).filter((value)=>value!==null && Number.isFinite(Number(value))));
    const hasBenchmark = Boolean(benchmarkLabel && result.benchmarkValues.length);
    if (benchmarkLabel) {
      els.trendBenchmarkNote.textContent = benchmarkDefinition(benchmarkSourceLabel);
      setHidden(els.trendBenchmarkNote, false);
    }
    const points = filteredRows.filter((row)=>row.station_value !== null).map((row)=>{
      const context=grain === "day" ? notableDateContext(row.period_start) : null;
      return {
        date:row.period_start,
        label:formatPeriod(row,grain),
        shortLabel:grain === "day" ? shortDayLabel(row.period_start) : grain === "week" ? `Wk ${shortDayLabel(row.period_start)}` : shortMonthLabel(row.period_start),
        value:Number(row.station_value),
        secondaryValue:row.benchmark_value === null ? null : Number(row.benchmark_value),
        weekend:grain === "day" && isWeekendDate(row.period_start),
        contextLabel:context ? notableContextLabel(context) : "",
        notableExact:context?.delta === 0,
        tooltipModel:{
          title:`${formatPeriod(row,grain)}${context ? ` · ${notableContextLabel(context)}` : ""}`,
          rows:[
            { tone:"station", label:"WNMU-FM", value:formatMetric(row.station_value,row.unit), delta:`${signedPercent(percentFromMedian(row.station_value,medianValue))} vs median` },
            ...(hasBenchmark ? [{ tone:"benchmark", label:benchmarkLabel, value:row.benchmark_value === null ? "Not supplied" : formatMetric(row.benchmark_value,row.unit), delta:row.benchmark_value === null || benchmarkMedian === null ? "" : `${signedPercent(percentFromMedian(row.benchmark_value,benchmarkMedian))} vs median` }] : [])
          ]
        }
      };
    });
    const chartPoints=zoomedTrendPoints(points);
    updateTrendZoomControls();
    renderLineChart(els.trendChart,chartPoints,{
      title:label,
      ariaLabel:`${label} by ${grain}`,
      grain,
      primaryLabel:"WNMU-FM",
      secondaryLabel:benchmarkLabel,
      zoomMode:state.trendZoomMode,
      onZoomSelect:setTrendZoom,
      onPointClick:grain === "day" ? (point)=>openDateDrilldown(point,metricKey,medianValue) : null
    });

    if (!filteredRows.length) {
      renderTrendDataTable("",0);
      els.trendPrintColumns.innerHTML = "";
      return;
    }
    renderTrendDataTable(`<table class="trend-data-table">
      <thead><tr><th>Period</th><th class="numeric">WNMU-FM</th><th class="numeric">Vs median</th><th class="numeric">${escapeHtml(benchmarkLabel || "NPR benchmark")}</th></tr></thead>
      <tbody>${filteredRows.map((row)=>{
        const delta = medianValue === null ? null : percentFromMedian(row.station_value,medianValue);
        const notable = grain === "day" ? notableDateContext(row.period_start) : null;
        return `<tr${rowClass(row,grain)}><td>${escapeHtml(formatPeriod(row,grain))}${notable?.delta === 0 ? ` <span class="notable-tag">${escapeHtml(notableContextLabel(notable))}</span>` : ""}</td><td class="numeric">${escapeHtml(formatMetric(row.station_value,row.unit))}</td><td class="numeric">${escapeHtml(signedPercent(delta))}</td><td class="numeric">${row.benchmark_value === null ? "—" : escapeHtml(formatMetric(row.benchmark_value,row.unit))}</td></tr>`;
      }).join("")}</tbody>
    </table>`, filteredRows.length);
    renderTrendPrintDetail(filteredRows,grain,medianValue);
    return;
  }

  const comparable = loaded.filter((item)=>item.median !== null && Number(item.median) !== 0 && item.numericValues.length);
  els.trendMedianSummary.innerHTML = loaded.map((item)=>{
    if(item.median === null) return `<span><strong>${escapeHtml(item.label)}:</strong> no observations</span>`;
    const delta=item.latest ? percentFromMedian(item.latest.station_value,item.median) : null;
    return `<span><strong>${escapeHtml(item.label)} median:</strong> ${escapeHtml(formatMetric(item.median,item.unit))}${item.latest ? ` · latest ${escapeHtml(signedPercent(delta))}` : ""}</span>`;
  }).join("");

  if(!comparable.length) {
    els.trendChart.innerHTML='<p class="empty-state">The selected metrics do not have comparable observations in this range.</p>';
    renderTrendDataTable("",0);
    els.trendPrintColumns.innerHTML="";
    return;
  }

  const rowMaps=new Map(comparable.map((item)=>[item.key,new Map(item.rows.map((row)=>[row.period_start,row]))]));
  const dates=[...new Set(comparable.flatMap((item)=>item.rows.map((row)=>row.period_start)))].sort();
  const seriesDefs=comparable.map((item)=>({
    key:item.key,
    label:item.label,
    unit:item.unit,
    median:item.median,
    benchmarkMedian:item.benchmarkMedian,
    benchmarkLabel:item.benchmarkLabel,
    hasBenchmark:Boolean(item.benchmarkLabel && item.benchmarkValues.length)
  }));
  const firstBenchmarkSource=comparable.find((item)=>item.benchmarkSourceLabel)?.benchmarkSourceLabel || "";
  if(firstBenchmarkSource) {
    els.trendBenchmarkNote.textContent=benchmarkDefinition(firstBenchmarkSource);
    setHidden(els.trendBenchmarkNote,false);
  }
  const points=dates.map((date)=>{
    const exemplar=comparable.map((item)=>rowMaps.get(item.key).get(date)).find(Boolean);
    const context=grain === "day" ? notableDateContext(date) : null;
    const values={};
    const benchmarkValues={};
    const actualValues={};
    const actualBenchmarkValues={};
    comparable.forEach((item)=>{
      const row=rowMaps.get(item.key).get(date);
      if(!row || row.station_value===null) return;
      const indexed=indexToMedian(row.station_value,item.median);
      if(indexed!==null) {
        values[item.key]=indexed;
        actualValues[item.key]=Number(row.station_value);
      }
      if(row.benchmark_value!==null && item.benchmarkMedian!==null && Number(item.benchmarkMedian)!==0) {
        const benchmarkIndexed=indexToMedian(row.benchmark_value,item.benchmarkMedian);
        if(benchmarkIndexed!==null) {
          benchmarkValues[item.key]=benchmarkIndexed;
          actualBenchmarkValues[item.key]=Number(row.benchmark_value);
        }
      }
    });
    const label=exemplar ? formatPeriod(exemplar,grain) : formatDayDate(date);
    return {
      date,
      label,
      shortLabel:grain === "day" ? shortDayLabel(date) : grain === "week" ? `Wk ${shortDayLabel(date)}` : shortMonthLabel(date),
      weekend:grain === "day" && isWeekendDate(date),
      contextLabel:context ? notableContextLabel(context) : "",
      notableExact:context?.delta === 0,
      values,
      benchmarkValues,
      actualValues,
      actualBenchmarkValues,
      tooltipModel:{
        title:`${label}${context ? ` · ${notableContextLabel(context)}` : ""}`,
        benchmarkLabel:seriesDefs.find((item)=>item.hasBenchmark)?.benchmarkLabel || "NPR benchmark",
        metrics:comparable.map((item)=>{
          const row=rowMaps.get(item.key).get(date);
          const stationValue=row?.station_value;
          const benchmarkValue=row?.benchmark_value;
          return {
            label:item.label,
            station:{
              value:stationValue===null || stationValue===undefined ? "—" : formatMetric(stationValue,item.unit),
              delta:stationValue===null || stationValue===undefined ? "—" : `${signedPercent(percentFromMedian(stationValue,item.median))} vs median`
            },
            benchmark:item.benchmarkLabel && item.benchmarkValues.length ? {
              label:item.benchmarkLabel,
              value:benchmarkValue===null || benchmarkValue===undefined ? "Not supplied" : formatMetric(benchmarkValue,item.unit),
              delta:benchmarkValue===null || benchmarkValue===undefined || item.benchmarkMedian===null ? "" : `${signedPercent(percentFromMedian(benchmarkValue,item.benchmarkMedian))} vs median`
            } : null
          };
        })
      }
    };
  }).filter((point)=>Object.keys(point.values).length);

  const chartPoints=zoomedTrendPoints(points);
  updateTrendZoomControls();
  renderIndexedMultiLineChart(els.trendChart,chartPoints,{
    title:"Metric comparison",
    ariaLabel:`Indexed comparison of ${seriesDefs.map((item)=>item.label).join(", ")} by ${grain}`,
    grain,
    benchmarkLabel:seriesDefs.find((item)=>item.benchmarkLabel)?.benchmarkLabel || "NPR benchmark",
    series:seriesDefs,
    zoomMode:state.trendZoomMode,
    onZoomSelect:setTrendZoom,
    onPointClick:grain === "day" ? (point,item)=>openDateDrilldown({date:point.date,value:point.actualValues[item.key]},item.key,item.median) : null
  });

  if(!points.length) {
    renderTrendDataTable("",0);
    els.trendPrintColumns.innerHTML="";
    return;
  }
  renderTrendDataTable(`<table class="trend-data-table multi-metric-table">
    <thead><tr><th>Period</th>${seriesDefs.map((item)=>`<th class="numeric">${escapeHtml(item.label)}</th>`).join("")}</tr></thead>
    <tbody>${points.map((point)=>`<tr${point.weekend ? ' class="weekend-row"' : ""}><td>${escapeHtml(point.label)}${point.notableExact ? ` <span class="notable-tag">${escapeHtml(point.contextLabel)}</span>` : ""}</td>${seriesDefs.map((item)=>`<td class="numeric">${point.actualValues[item.key] === undefined ? "—" : escapeHtml(formatMetric(point.actualValues[item.key],item.unit))}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`, points.length);
  els.trendPrintColumns.classList.add("single");
  els.trendPrintColumns.innerHTML='<p class="print-trend-note"><strong>Multi-metric comparison:</strong> the printed chart uses each selected metric\'s median as index 100. Actual values remain available in the on-screen table and hover details.</p>';
}

function sortBreakdown(rows) {
  return [...rows].sort((a, b) => Number(b.station_value || 0) - Number(a.station_value || 0));
}

function exploreDimensionLabel(viewKey, value) {
  if (viewKey !== "website-channels") return value;
  return ({
    "Direct":"Direct / unknown referrer",
    "Search":"Search engines",
    "Social":"Social media",
    "Referral":"Links from other websites",
    "Email & Newsletters":"Email / newsletters",
    "Other":"Other / unclassified"
  })[value] || value;
}
function titlesForHour(entries,day,hour) {
  const seen = new Set();
  return entries.filter((entry) => {
    const dayOffset=entryHourDayOffset(entry,hour);
    if(dayOffset===null) return false;
    const date = new Date(`${entry.date}T12:00:00Z`);
    if(Number.isNaN(date.getTime())) return false;
    date.setUTCDate(date.getUTCDate()+dayOffset);
    return date.getUTCDay() === day;
  }).map((entry)=>entry.program).filter((name)=>name && !seen.has(name) && seen.add(name)).sort((a,b)=>a.localeCompare(b));
}

function programLines(names) {
  const filtered = state.scheduleProgram ? names.filter((name)=>name === state.scheduleProgram) : names;
  return filtered.length ? filtered.map((name)=>`<span class="program-line">${escapeHtml(name)}</span>`).join("") : '<span class="program-line muted">—</span>';
}

function typicalContextLine(context) {
  if(!context?.label) return "";
  return context.type === "program"
    ? `Typical program: ${context.label}`
    : context.type === "genre"
      ? `Typical genre: ${context.label}`
      : "";
}

function renderListeningHourContext(context) {
  const { hours, entries, typicalEntries = entries, scheduleNote, periodStart, periodEnd, rangeMismatch = false } = context;
  const byKey=new Map(hours.map((row)=>[row.dimension_value,row]));
  const typicalByHour=buildTypicalHourContext(typicalEntries);
  const names=[...new Set(entries.map((entry)=>entry.program).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const previous=state.scheduleProgram;
  els.scheduleProgramFilter.innerHTML='<option value="">All programs</option>'+names.map((name)=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if(previous && names.includes(previous)) els.scheduleProgramFilter.value=previous; else state.scheduleProgram="";
  setHidden(els.scheduleProgramFilterControl, names.length === 0);
  els.listeningHourPanel.classList.remove("compact-empty");

  const rangeWarning = rangeMismatch
    ? `<span class="source-range-warning" role="status"><strong>Source range notice</strong><span>Listening by Hour uses <b>${escapeHtml(formatDayDate(periodStart))} – ${escapeHtml(formatDayDate(periodEnd))}</b>; your Analysis Range is <b>${escapeHtml(formatDayDate(state.startDate))} – ${escapeHtml(formatDayDate(state.endDate))}</b>. NPR provides this profile only as a whole-report aggregate, so this graph remains on the NPR source period.</span></span> `
    : "";
  els.nprHourDescription.innerHTML=`${rangeWarning}NPR One gives a <strong>weekday average</strong> and a <strong>weekend average</strong> for each clock hour across the source period <strong>${escapeHtml(formatDayDate(periodStart))} – ${escapeHtml(formatDayDate(periodEnd))}</strong>, not seven separate daily audience counts. Schedule columns are context, not program-level audience measurements. ${escapeHtml(scheduleNote)}`;

  const hourPoints=[];
  const weekdayRows=[];
  const weekendRows=[];
  for(let hour=0;hour<24;hour+=1){
    const key=String(hour).padStart(2,"0");
    const weekday=byKey.get(`weekday|${key}`);
    const weekend=byKey.get(`weekend|${key}`);
    const dayTitles=[0,1,2,3,4,5,6].map((day)=>titlesForHour(entries,day,hour));
    const matchesWeekday=!state.scheduleProgram || [1,2,3,4,5].some((day)=>dayTitles[day].includes(state.scheduleProgram));
    const matchesWeekend=!state.scheduleProgram || [6,0].some((day)=>dayTitles[day].includes(state.scheduleProgram));
    const weekdayTypical=typicalByHour.get(`weekday|${key}`);
    const weekendTypical=typicalByHour.get(`weekend|${key}`);
    hourPoints.push({
      label:hourLabel(hour),
      shortLabel:hourLabel(hour).replace(":00",""),
      value:weekday ? Number(weekday.station_value) : null,
      secondaryValue:weekend ? Number(weekend.station_value) : null,
      primaryTooltipModel:{
        title:hourLabel(hour),
        rows:[
          { tone:"station", label:"Weekday", value:weekday ? formatMetric(weekday.station_value,weekday.unit) : "—", delta:typicalContextLine(weekdayTypical) }
        ]
      },
      secondaryTooltipModel:{
        title:hourLabel(hour),
        rows:[
          { tone:"benchmark", label:"Weekend", value:weekend ? formatMetric(weekend.station_value,weekend.unit) : "—", delta:typicalContextLine(weekendTypical) }
        ]
      }
    });
    if(matchesWeekday) weekdayRows.push(`<tr><td>${escapeHtml(hourLabel(hour))}</td><td class="hour-average">${weekday ? escapeHtml(formatMetric(weekday.station_value,weekday.unit)) : "—"}</td><td>${programLines(dayTitles[1])}</td><td>${programLines(dayTitles[2])}</td><td>${programLines(dayTitles[3])}</td><td>${programLines(dayTitles[4])}</td><td>${programLines(dayTitles[5])}</td></tr>`);
    if(matchesWeekend) weekendRows.push(`<tr><td>${escapeHtml(hourLabel(hour))}</td><td class="hour-average">${weekend ? escapeHtml(formatMetric(weekend.station_value,weekend.unit)) : "—"}</td><td>${programLines(dayTitles[6])}</td><td>${programLines(dayTitles[0])}</td></tr>`);
  }
  renderLineChart(els.nprHourChart,hourPoints,{
    title:"NPR One listening by hour",
    ariaLabel:"Average NPR One hourly listeners, weekdays compared with weekends",
    primaryLabel:"Weekday",
    secondaryLabel:"Weekend",
    showBars:false,
    labelAngle:0,
    labelEvery:2,
    minLabelGap:12
  });
  els.nprHourTable.innerHTML=entries.length ? `
    <section class="hour-section"><h4>Monday–Friday schedule against weekday hourly average</h4><div class="table-wrap"><table class="hour-table weekday-hour-table"><thead><tr><th>Hour</th><th>Weekday<br>avg.</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th></tr></thead><tbody>${weekdayRows.join("") || '<tr><td colspan="7">No hours match this program filter.</td></tr>'}</tbody></table></div></section>
    <section class="hour-section"><h4>Weekend schedule against weekend hourly average</h4><div class="table-wrap"><table class="hour-table weekend-hour-table"><thead><tr><th>Hour</th><th>Weekend<br>avg.</th><th>Saturday</th><th>Sunday</th></tr></thead><tbody>${weekendRows.join("") || '<tr><td colspan="4">No hours match this program filter.</td></tr>'}</tbody></table></div></section>` : "";
}

async function renderListeningByHour(hours, requestId = breakdownRequestId, { rangeMismatch = false } = {}) {
  if (!hours.length) {
    listeningHourContext=null;
    state.scheduleProgram="";
    els.listeningHourPanel.classList.add("compact-empty");
    setHidden(els.scheduleProgramFilterControl,true);
    setHidden(els.nprHourChart,true);
    els.nprHourTable.innerHTML="";
    els.nprHourDescription.innerHTML='<span class="source-range-warning"><strong>Listening by Hour unavailable.</strong> No imported NPR One hour-of-day profile is available.</span>';
    const noticeKey="missing-hour-profile";
    if(listeningHourNoticeKey !== noticeKey && state.activeTab === "overview") {
      listeningHourNoticeKey=noticeKey;
      openDetailDialog("Listening by Hour unavailable", "<p>No imported NPR One hour-of-day profile is available, so this panel has been collapsed rather than leaving a large empty area.</p>", "Data availability");
    }
    return;
  }
  setHidden(els.nprHourChart,false);
  const periodStart=hours[0].period_start;
  const periodEnd=hours[0].period_end;

  let entries=[];
  let typicalEntries=[];
  let scheduleNote="";
  try {
    const result=await fetchComposerSchedule(periodStart,periodEnd);
    if(requestId !== breakdownRequestId) return;
    typicalEntries=result.entries;
    entries=result.sourceType==="recurrences" ? [] : result.entries;
    scheduleNote=result.sourceType==="recurrences"
      ? "Exact dated schedule entries were unavailable. Tooltip program context may use Composer recurring definitions only when one program or genre clearly dominates that hour; the dated schedule table and program filter remain hidden."
      : "Schedule context comes from dated Composer episodes for this report period. Typical-program hints are shown only when one program or genre clearly dominates an hour.";
  } catch(error) {
    if(requestId !== breakdownRequestId) return;
    scheduleNote=`Schedule lookup unavailable: ${error.message}`;
  }
  listeningHourContext={hours,entries,typicalEntries,scheduleNote,periodStart,periodEnd,rangeMismatch};
  renderListeningHourContext(listeningHourContext);
}

async function renderStreamingWeekpart() {
  const rows=await loadTimeSeries("streaming.listeners","day","{}",selectedRange());
  const groups={weekday:[],weekend:[]};
  rows.forEach((row)=>{ if(row.station_value!==null) groups[isWeekendDate(row.period_start) ? "weekend" : "weekday"].push(Number(row.station_value)); });
  const average=(values)=>values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
  const weekday=average(groups.weekday), weekend=average(groups.weekend);
  const chartRows=[{label:"Mon–Fri",value:weekday},{label:"Weekend",value:weekend}].filter((row)=>row.value!==null);
  renderBarChart(els.streamingWeekpartBars,chartRows,{onBarClick:(row)=>openBreakdownDrilldown("Average daily streaming listeners",row,"Loaded complete daily history")});
  if(weekday && weekend!==null){
    const gap=((weekend-weekday)/weekday)*100;
    els.streamingWeekpartNote.textContent=`Weekends average ${Math.abs(gap).toFixed(1)}% ${gap<0 ? "fewer" : "more"} streaming listeners than Mon–Fri across the loaded daily history.`;
  }
}

async function renderBreakdowns() {
  const requestId = ++breakdownRequestId;
  const [programs, devices, channels, rangedHours] = await Promise.all([
    loadLatestBreakdown("audio.downloads_by_program", "program", "{}", selectedRange()),
    loadLatestBreakdown("streaming.device_share_pct", "device", "{}", selectedRange()),
    loadLatestBreakdown("website.sessions_by_channel", "traffic_channel", "{}", selectedRange()),
    loadLongestBreakdown("npr_one.average_hourly_listeners", "hour_weekpart", "{}", selectedRange())
  ]);
  if (requestId !== breakdownRequestId) return;

  let hours=rangedHours;
  let hourRangeMismatch=false;
  if(!hours.length) {
    hours=await loadLongestBreakdown("npr_one.average_hourly_listeners", "hour_weekpart");
    if (requestId !== breakdownRequestId) return;
    hourRangeMismatch=hours.length>0;
  }
  renderBarChart(els.programBars, sortBreakdown(programs).map((row) => ({ label: row.dimension_value, value: row.station_value, formattedValue:formatMetric(row.station_value,row.unit) })), { limit: 12, onBarClick:(row)=>openBreakdownDrilldown("On-demand downloads",row,programs[0] ? formatPeriod(programs[0],programs[0].grain) : "") });
  renderBarChart(els.deviceBars, sortBreakdown(devices).map((row) => ({ label: row.dimension_value, value: row.station_value, formattedValue:`${Number(row.station_value).toFixed(1)}%` })), {
    maxValue: 100,
    formatValue: (value) => `${Number(value).toFixed(1)}%`,
    onBarClick:(row)=>openBreakdownDrilldown("Live-stream device share",row,devices[0] ? formatPeriod(devices[0],devices[0].grain) : "")
  });
  renderBarChart(els.channelBars, sortBreakdown(channels).map((row) => ({ label: exploreDimensionLabel("website-channels",row.dimension_value), value: row.station_value, formattedValue:formatMetric(row.station_value,row.unit) })), { limit: 8, onBarClick:(row)=>openBreakdownDrilldown("Website sessions",row,channels[0] ? formatPeriod(channels[0],channels[0].grain) : "") });
  await Promise.all([renderListeningByHour(hours,requestId,{rangeMismatch:hourRangeMismatch}),renderStreamingWeekpart()]);
}

async function renderAnomalies() {
  const anomalies = await loadOpenAnomalies();
  els.anomalyCount.textContent = String(anomalies.length);
  if (!anomalies.length) {
    els.anomalyList.innerHTML = '<p class="empty-state">No open anomaly flags.</p>';
    return;
  }
  els.anomalyList.innerHTML = anomalies.map((item) => `<div class="anomaly-item" data-anomaly-id="${item.id}">
    <div class="anomaly-head"><span class="anomaly-title">${escapeHtml(item.title)}</span><span class="severity ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></div>
    <p class="anomaly-detail">${escapeHtml(item.detail || "")}</p>
    <div class="anomaly-actions">
      <button class="small-button" type="button" data-anomaly-action="expected">Expected</button>
      <button class="small-button" type="button" data-anomaly-action="excluded">Exclude</button>
      <button class="small-button" type="button" data-anomaly-action="resolved">Resolve</button>
    </div>
  </div>`).join("");
}

async function renderCoverage() {
  const imports = await loadImports();
  if (!imports.length) {
    els.coverageTable.innerHTML = '<p class="empty-state">No reports imported yet.</p>';
    return;
  }
  const labels = {
    station_streaming:"Streaming",
    station_website:"NPR Website",
    ga4_website:"Google Analytics 4",
    audio_downloads:"Audio Downloads",
    audio_program_drilldown:"Audio Drilldown",
    npr_one:"NPR One"
  };
  const grouped = new Map();
  imports.forEach((item) => {
    const key = item.report_type;
    if (!grouped.has(key)) grouped.set(key, { type:key, grains:new Set(), start:null, end:null, run:null, count:0 });
    const group = grouped.get(key);
    group.grains.add(item.grain);
    group.count += 1;
    if (item.report_start && (!group.start || item.report_start < group.start)) group.start = item.report_start;
    if (item.report_end && (!group.end || item.report_end > group.end)) group.end = item.report_end;
    if (item.report_run_date && (!group.run || item.report_run_date > group.run)) group.run = item.report_run_date;
  });
  els.coverageTable.innerHTML = `<table><thead><tr><th>Report</th><th>Grains</th><th>Source coverage</th><th>Analysis cutoff</th><th class="numeric">Imports</th></tr></thead><tbody>
    ${[...grouped.values()].map((group) => {
      const grains=[...group.grains].sort().map((grain)=>grain==="unknown" ? "source-period aggregate" : grain).join(", ");
      const cutoff=group.type==="ga4_website"
        ? (group.run ? `Through ${formatDayDate(group.run)}` : "Unknown")
        : (group.run ? `Before ${formatDayDate(group.run)}` : "Unknown");
      return `<tr><td>${escapeHtml(labels[group.type] || group.type)}</td><td>${escapeHtml(grains)}</td><td>${escapeHtml(group.start ? `${formatDayDate(group.start)} – ${formatDayDate(group.end)}` : "Raw only")}</td><td>${escapeHtml(cutoff)}</td><td class="numeric">${group.count}</td></tr>`;
    }).join("")}
  </tbody></table>`;
}


function collectionSpan(imports, reportType, grain) {
  const rows = imports.filter((item) => item.report_type === reportType && item.grain === grain && item.report_start);
  if (!rows.length) return null;
  return {
    start: rows.reduce((value, item) => !value || item.report_start < value ? item.report_start : value, null),
    end: rows.reduce((value, item) => !value || item.report_end > value ? item.report_end : value, null)
  };
}

function collectionCell(span, targetStart = "2025-09-22") {
  if (!span) return '<span class="collection-status need">Missing</span>';
  const fullYear = span.start <= targetStart;
  return `<span class="collection-status ${fullYear ? "good" : "partial"}">${fullYear ? "Year+" : "Short"} · ${escapeHtml(formatDayDate(span.start))} – ${escapeHtml(formatDayDate(span.end))}</span>`;
}

async function renderCollectionChecklist() {
  const imports = await loadImports();
  const rows = [
    { type:"station_streaming", label:"Live streaming", next:"Full-year Day is loaded. Next get full-year Week and Month exports; hourly/daypart data remains the key program-analysis gap." },
    { type:"station_website", label:"NPR Website", next:"Daily year is loaded. Next get full-year Week and Month exports so unique-user comparisons are source-valid." },
    { type:"audio_downloads", label:"On-demand audio", next:"Daily year is loaded. Next get full-year Week and Month exports, then longer drilldowns for every available program." },
    { type:"npr_one", label:"NPR One", next:"Daily year is loaded. Next get full-year Week and Month exports." }
  ];

  const programs = [...new Set(imports.filter((item) => item.report_type === "audio_program_drilldown" && item.selected_program).map((item) => item.selected_program))].sort();
  const ga4Imports=imports.filter((item)=>item.report_type==="ga4_website");
  const ga4Start=ga4Imports.reduce((value,item)=>!value || (item.report_start && item.report_start<value) ? item.report_start : value,null);
  const ga4End=ga4Imports.reduce((value,item)=>!value || (item.report_end && item.report_end>value) ? item.report_end : value,null);
  const ga4Daily=collectionSpan(imports,"ga4_website","day");
  const ga4Status=ga4Imports.length
    ? `<span class="collection-status good">Loaded</span> · ${escapeHtml(formatDayDate(ga4Start))} – ${escapeHtml(formatDayDate(ga4End))} · ${ga4Imports.length} exports${ga4Daily ? ` · daily detail ${escapeHtml(formatDayDate(ga4Daily.start))} – ${escapeHtml(formatDayDate(ga4Daily.end))}` : ""}`
    : '<span class="collection-status need">Not imported</span> · Google Analytics 4 CSV import is ready';

  els.collectionChecklist.innerHTML = `
    <div class="table-wrap collection-table-wrap">
      <table class="collection-table">
        <thead><tr><th>Source</th><th>Day</th><th>Week</th><th>Month</th><th>Next collection target</th></tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>
            <td><strong>${escapeHtml(row.label)}</strong></td>
            <td>${collectionCell(collectionSpan(imports,row.type,"day"))}</td>
            <td>${collectionCell(collectionSpan(imports,row.type,"week"))}</td>
            <td>${collectionCell(collectionSpan(imports,row.type,"month"))}</td>
            <td>${escapeHtml(row.next)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="collection-gaps">
      <p><strong>Google Analytics 4:</strong> ${ga4Status}</p>
      <p><strong>Content-first gaps:</strong></p>
      <ul>
        <li><strong>Live-stream hour/daypart data:</strong> needed before we can honestly connect live listening to scheduled programs.</li>
        <li><strong>Program drilldowns:</strong> currently only ${programs.length} program buckets are represented (${escapeHtml(programs.join(", ") || "none")}). Get the longest available drilldown for every selectable discrete program.</li>
        <li><strong>Dated Google Analytics 4 content:</strong> ${ga4Daily ? "Date + Page Path / Landing Page daily detail is now supported. Next collect Date + Event name so station-relevant actions can be trended by day." : "Date + Page Path is the most valuable next website export because it allows content to enter Trend Explorer and daily drilldowns."}</li>
        <li><strong>Google Analytics 4 audio-event detail:</strong> event totals can show audio_action and player_interactions, but event parameters are still needed to identify what was played or how the player was used.</li>
        <li><strong>Program/topic taxonomy:</strong> we need categories such as news, classical, jazz, local arts, public affairs and specialty music so performance can be compared by content type.</li>
        <li><strong>Historical schedule:</strong> the recurring Composer schedule is usable for the normal lineup; exact dated schedule snapshots are still needed for preemptions, substitutions and long-term program attribution.</li>
      </ul>
    </div>`;
}


async function renderImportHistory() {
  const imports = await loadImports();
  if (!imports.length) {
    els.importHistory.innerHTML = '<p class="empty-state">Nothing imported yet.</p>';
    return;
  }
  els.importHistory.innerHTML = `<table><thead><tr><th>Imported</th><th>Report</th><th>View</th><th>Coverage</th><th>Run date</th><th>Program/filter</th><th class="numeric">Rows</th><th>Status</th></tr></thead><tbody>
    ${imports.map((item) => {
      const filter = item.selected_program || Object.entries(item.filter_context || {}).map(([key,value]) => `${key}=${value}`).join(", ") || "Unfiltered";
      const reportLabel=item.report_type==="ga4_website" ? "Google Analytics 4" : item.report_type;
      const viewLabel=item.grain==="unknown" ? "source-period aggregate" : item.grain;
      return `<tr><td>${escapeHtml(new Date(item.imported_at).toLocaleString())}</td><td>${escapeHtml(reportLabel)}</td><td>${escapeHtml(viewLabel)}</td><td>${escapeHtml(item.report_start ? `${formatDayDate(item.report_start)} – ${formatDayDate(item.report_end)}` : "Raw only")}</td><td>${escapeHtml(item.report_run_date ? formatDayDate(item.report_run_date) : "Unknown")}</td><td>${escapeHtml(filter)}</td><td class="numeric">${item.row_count}</td><td>${escapeHtml(item.status)}</td></tr>`;
    }).join("")}
  </tbody></table>`;
}

async function openExploreDimensionDetail(view,row,periodText) {
  if(!view.detailMetrics?.length || !row.sourceImportId) {
    openBreakdownDrilldown(view.title,row,periodText);
    return;
  }
  setBusy(true);
  openDetailDialog(row.label,'<p class="empty-state">Loading related metrics…</p>',"Website detail");
  try {
    const metrics=await loadBreakdownDimensionMetrics(view.detailMetrics,view.dimension,row.dimensionValue,row.sourceImportId);
    const byKey=new Map(metrics.map((item)=>[item.metric_key,item]));
    els.detailDialogBody.innerHTML=`
      <div class="detail-summary">
        <div><span>Source period</span><strong>${escapeHtml(periodText)}</strong></div>
        <div><span>Primary measure</span><strong>${escapeHtml(String(row.formattedValue ?? row.value ?? "—"))}</strong></div>
      </div>
      <section class="detail-section">
        <h3>What Google Analytics 4 reports</h3>
        <div class="detail-metric-grid">
          ${view.detailMetrics.map((key)=>{
            const item=byKey.get(key);
            if(!item) return "";
            return `<div class="detail-metric"><span>${escapeHtml(item.metric_label || item.metric_key)}</span><strong>${escapeHtml(formatMetric(item.station_value,item.unit))}</strong></div>`;
          }).join("")}
        </div>
      </section>
      ${view.sourceRange ? '<p class="source-limit">This Google Analytics 4 export is an aggregate for its complete source period. A Date + Page Path or similarly dated export is still needed before this category can be trended day by day.</p>' : ""}
    `;
  } catch(error) {
    els.detailDialogBody.innerHTML=`<p class="empty-state">Could not load this drilldown: ${escapeHtml(error.message)}</p>`;
  } finally {
    setBusy(false);
  }
}

async function renderExplore() {
  const requestId = ++exploreRequestId;
  const viewKey = state.exploreView;
  const view = EXPLORE_VIEWS[viewKey] || EXPLORE_VIEWS["audio-programs"];
  els.exploreViewButtons.querySelectorAll("[data-explore-view]").forEach((button) => {
    button.setAttribute("aria-pressed",String(button.dataset.exploreView===viewKey));
  });
  els.exploreDescription.textContent = view.description;
  const rows = await loadLatestBreakdown(view.metric, view.dimension, "{}", view.sourceRange ? {} : selectedRange());
  if (requestId !== exploreRequestId) return;
  if (!rows.length) {
    els.explorePeriod.textContent = "";
    els.exploreChart.innerHTML = `<p class="empty-state compact">${view.sourceRange ? "No imported Google Analytics 4 source currently supplies this view." : "No complete source breakdown fits inside the selected analysis range."}</p>`;
    return;
  }
  const periodText=formatPeriod(rows[0], rows[0].grain);
  els.explorePeriod.textContent = `${periodText}${rows[0].analysis_tail_incomplete ? " · source includes its report-end day" : ""}`;
  const sorted = sortBreakdown(rows);
  const isPercent = rows[0].unit === "percent";
  renderBarChart(els.exploreChart, sorted.map((row) => ({
    label: exploreDimensionLabel(viewKey,row.dimension_value),
    dimensionValue:row.dimension_value,
    sourceImportId:row.source_import_id,
    value: row.station_value,
    formattedValue: formatMetric(row.station_value,row.unit)
  })), {
    maxValue: isPercent ? 100 : undefined,
    formatValue: (value) => formatMetric(value, rows[0].unit),
    limit: 25,
    onBarClick:(row)=>openExploreDimensionDetail(view,row,periodText)
  });
}

async function refreshDashboard() {
  if (state.loading) return;
  state.loading = true;
  setBusy(true);
  els.refreshButton.disabled = true;
  try {
    await Promise.all([
      renderSummary(),
      renderTrend(),
      renderBreakdowns(),
      renderAnomalies(),
      renderCoverage(),
      renderImportHistory(),
      renderCollectionChecklist(),
      renderExplore(),
      renderDataAvailability(),
      state.activeTab==="takeaways" ? renderTakeaways() : Promise.resolve()
    ]);
  } catch (error) {
    console.error(error);
    els.summaryCards.innerHTML = `<p class="empty-state">Could not load analytics: ${escapeHtml(error.message)}</p>`;
  } finally {
    state.loading = false;
    els.refreshButton.disabled = false;
    setBusy(false);
  }
}

function filterContext() {
  const name = els.filterName.value.trim();
  const value = els.filterValue.value.trim();
  return name && value ? { [name]: value } : {};
}

function queueRow(file, status, kind = "") {
  const id = `import-${crypto.randomUUID()}`;
  const row = document.createElement("div");
  row.className = `import-row ${kind}`;
  row.id = id;
  row.innerHTML = `<div><strong>${escapeHtml(file.name)}</strong></div><div class="status">${escapeHtml(status)}</div>`;
  els.importQueue.prepend(row);
  return row;
}

async function processFiles(fileList) {
  const files = [...fileList].filter((file) => /\.(zip|csv)$/i.test(file.name));
  if (!files.length) return;
  const userEmail = currentUser()?.email || null;
  const filters = filterContext();
  let importedCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;
  let observationCount = 0;
  let anomalyCount = 0;
  const availableRangeBeforeImport={ ...state.availableRange };
  let importRangeChange=null;

  await withBusy(async () => {
    for (const file of files) {
      const row = queueRow(file, "Inspecting…");
      try {
        const result = await importExport(file, filters, userEmail);
        if (result.duplicate) {
          duplicateCount += 1;
          row.classList.add("success");
          row.querySelector(".status").textContent = "Already imported";
        } else {
          importedCount += 1;
          observationCount += Number(result.normalizedCount || 0);
          anomalyCount += Number(result.anomalyCount || 0);
          row.classList.add("success");
          const program = result.inspected.selectedProgram ? ` · ${result.inspected.selectedProgram}` : "";
          const viewLabel=result.inspected.normalized.range.grain === "unknown" ? "source-period aggregate" : result.inspected.normalized.range.grain;
          row.querySelector(".status").textContent = `${result.inspected.reportLabel} · ${viewLabel}${program} · ${result.normalizedCount} observations · ${result.anomalyCount} flags`;
        }
      } catch (error) {
        errorCount += 1;
        console.error(error);
        row.classList.add("error");
        row.querySelector(".status").textContent = error.message;
      }
    }
    invalidateDataCache();
    takeawayRangeKey="";
    importRangeChange=await syncAvailableDataRange();
    await renderProgramFilterOptions();
    await refreshDashboard();
  });

  els.fileInput.value = "";
  if (importedCount > 0) {
    const reportWord = importedCount === 1 ? "report" : "reports";
    const observationWord = observationCount === 1 ? "observation" : "observations";
    const rangeWasChanged=rangeChanged(availableRangeBeforeImport,importRangeChange?.next || {}) &&
      Boolean(importRangeChange?.next?.startDate || importRangeChange?.next?.endDate);
    const rangeNotice=rangeWasChanged && importRangeChange?.next?.startDate
      ? `<p class="range-change-notice"><strong>Imported data changed the available analytics range to:</strong><br>${escapeHtml(formattedRange(importRangeChange.next))}</p>` +
        (state.rangeMode === "all"
          ? `<p>Your Analysis Range was updated to match the full imported range.</p>`
          : `<p>Your custom Analysis Range remains ${escapeHtml(formattedRange({startDate:state.startDate,endDate:state.endDate}))}.</p>`)
      : "";
    const messages = [
      `<p><strong>Data added to the app.</strong></p>`,
      `<p>${importedCount} ${reportWord} imported with ${observationCount.toLocaleString()} ${observationWord}. The dashboard has been refreshed.</p>`,
      rangeNotice,
      anomalyCount ? `<p>${anomalyCount} data-quality ${anomalyCount === 1 ? "flag was" : "flags were"} created for review.</p>` : "",
      duplicateCount ? `<p>${duplicateCount} ${duplicateCount === 1 ? "file was" : "files were"} already imported.</p>` : "",
      errorCount ? `<p>${errorCount} ${errorCount === 1 ? "file could not" : "files could not"} be imported. See the import queue for details.</p>` : ""
    ].join("");
    openDetailDialog("Import complete", messages, "Analytics import");
  } else if (duplicateCount > 0 && errorCount === 0) {
    openDetailDialog(
      "Already imported",
      `<p>No new data was added because ${duplicateCount === 1 ? "this report is" : "these reports are"} already in the app.</p>`,
      "Analytics import"
    );
  } else if (errorCount > 0) {
    openDetailDialog(
      "Import not completed",
      `<p>No new data was added. See the import queue for the ${errorCount === 1 ? "error" : "errors"}.</p>`,
      "Analytics import"
    );
  }
}

function bindTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });
}

function bindEvents() {
  const rangeInputs=[els.globalStartDate,els.globalEndDate];
  const cancelRangeCommitTimer=()=>{
    if(rangeBlurCommitTimer) {
      window.clearTimeout(rangeBlurCommitTimer);
      rangeBlurCommitTimer=null;
    }
  };
  const storePendingRangeEdit=()=>{
    cancelRangeCommitTimer();
    if(!rangeEditPending) return false;
    if(!validateAndStoreRange()) return null;
    rangeEditPending=false;
    return true;
  };
  const commitRangeEdit=()=>{
    const stored=storePendingRangeEdit();
    if(stored) void withBusy(()=>refreshAnalysisViews());
    return stored;
  };
  const markRangeEdit=()=>{
    rangeEditPending=true;
  };
  const commitRangeAfterLeavingControls=()=>{
    cancelRangeCommitTimer();
    rangeBlurCommitTimer=window.setTimeout(()=>{
      rangeBlurCommitTimer=null;
      if(rangeInputs.includes(document.activeElement)) return;
      commitRangeEdit();
    },0);
  };

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showLoginMessage("Signing in…", true);
    try {
      await signIn(els.loginEmail.value.trim(), els.loginPassword.value);
      const allowed = await establishAccess();
      if (allowed) {
        els.loginPassword.value = "";
        showLoginMessage("");
        await syncAvailableDataRange();
        await renderProgramFilterOptions();
        await refreshDashboard();
      }
    } catch (error) {
      showLoginMessage(error.message);
    }
  });

  els.githubLoginButton.addEventListener("click", () => {
    persistUiState();
    showLoginMessage("Opening GitHub sign in…", true);
    signInWithGitHub();
  });

  els.logoutButton.addEventListener("click", async () => {
    state.role = null;
    setAuthenticated(false);
    await withTimeout(signOut().catch(() => null), 3000, "Sign out timed out.").catch(() => null);
  });

  els.printButton.addEventListener("click", async () => {
    const stored=storePendingRangeEdit();
    if(stored===null) return;
    if(stored) await withBusy(()=>refreshAnalysisViews());
    window.print();
  });
  els.refreshButton.addEventListener("click", async () => {
    const stored=storePendingRangeEdit();
    if(stored===null) return;
    takeawayRangeKey="";
    await refreshDashboard();
  });
  els.trendMetricButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-trend-metric]");
    if (!button) return;
    const key=button.dataset.trendMetric;
    if(state.trendMetrics.includes(key)) {
      if(state.trendMetrics.length===1) return;
      state.trendMetrics=state.trendMetrics.filter((item)=>item!==key);
    } else {
      state.trendMetrics=[...state.trendMetrics,key];
    }
    persistUiState();
    void withBusy(() => renderTrend());
  });
  els.trendQuickRangeButtons.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-range-preset]");
    if(!button) return;
    cancelRangeCommitTimer();
    rangeEditPending=false;
    state.startDate=button.dataset.start || state.availableRange.startDate;
    state.endDate=button.dataset.end || state.availableRange.endDate;
    state.rangeMode=button.dataset.rangePreset === "full" ? "all" : button.dataset.rangePreset === "last-13m" ? "recent13" : "custom";
    clearTrendZoom();
    applyRangeControls();
    persistUiState();
    void withBusy(()=>refreshAnalysisViews());
  });
  els.trendWeekpartButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-weekpart]");
    if (!button) return;
    state.trendWeekpart = button.dataset.weekpart;
    persistUiState();
    void withBusy(() => renderTrend());
  });
  els.trendNotableButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-notable-mode]");
    if (!button) return;
    state.trendNotable = button.dataset.notableMode;
    persistUiState();
    void withBusy(() => renderTrend());
  });
  els.trendProgramSelect.addEventListener("change", () => {
    state.trendProgram = els.trendProgramSelect.value;
    persistUiState();
    void withBusy(() => renderTrend());
  });
  els.scheduleProgramFilter.addEventListener("change", () => {
    state.scheduleProgram = els.scheduleProgramFilter.value;
    if (listeningHourContext) renderListeningHourContext(listeningHourContext);
  });
  els.detailDialogClose.addEventListener("click", () => els.detailDialog.close());
  els.trendZoomButton.addEventListener("click",()=>{
    state.trendZoomMode=!state.trendZoomMode;
    updateTrendZoomControls();
    void renderTrend();
  });
  els.trendZoomReset.addEventListener("click",()=>{
    clearTrendZoom({persist:true});
    void renderTrend();
  });
  els.trendGrain.addEventListener("change", () => {
    state.trendGrain = els.trendGrain.value;
    persistUiState();
    void withBusy(() => renderTrend());
  });
  els.exploreViewButtons.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-explore-view]");
    if(!button) return;
    state.exploreView=button.dataset.exploreView;
    persistUiState();
    void withBusy(()=>renderExplore());
  });
  els.takeawayCategoryButtons.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-takeaway-category]");
    if(!button) return;
    state.takeawayCategory=button.dataset.takeawayCategory;
    persistUiState();
    renderTakeawayCards();
  });
  els.takeawayList.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-takeaway-evidence]");
    if(!button) return;
    const metrics=String(button.dataset.metrics || "").split(",").map((item)=>item.trim()).filter(Boolean);
    if(!metrics.length) return;
    const validMetrics=new Set(TREND_METRICS.map((item)=>item.key));
    state.trendMetrics=metrics.filter((metric)=>validMetrics.has(metric));
    if(!state.trendMetrics.length) return;
    state.trendGrain=button.dataset.grain || "day";
    state.trendWeekpart="all";
    state.trendNotable="all";
    state.trendProgram="";
    if(button.dataset.start && button.dataset.end) {
      state.startDate=button.dataset.start;
      state.endDate=button.dataset.end;
      state.rangeMode="custom";
    }
    clearTrendZoom();
    applyRangeControls();
    activateTab("overview");
    persistUiState();
    void withBusy(()=>refreshAnalysisViews());
  });
  rangeInputs.forEach((input)=>{
    input.addEventListener("input",markRangeEdit);
    input.addEventListener("blur",commitRangeAfterLeavingControls);
    input.addEventListener("keydown",(event)=>{
      if(event.key !== "Enter") return;
      event.preventDefault();
      if(rangeEditPending) commitRangeEdit();
      input.blur();
    });
  });
  els.clearDateRange.addEventListener("click",()=>{
    cancelRangeCommitTimer();
    rangeEditPending=false;
    state.rangeMode="all";
    clearTrendZoom();
    state.startDate=state.availableRange.startDate;
    state.endDate=state.availableRange.endDate;
    applyRangeControls();
    persistUiState();
    void withBusy(()=>refreshAnalysisViews());
  });
  els.copyViewButton.addEventListener("click", () => {
    const stored=storePendingRangeEdit();
    if(stored===null) return;
    void copyCurrentViewLink();
  });

  els.dataAvailability.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-coverage-start][data-coverage-end]");
    if(!button) return;
    cancelRangeCommitTimer();
    rangeEditPending=false;
    state.startDate=button.dataset.coverageStart;
    state.endDate=button.dataset.coverageEnd;
    state.rangeMode="custom";
    clearTrendZoom();
    applyRangeControls();
    persistUiState();
    void withBusy(()=>refreshAnalysisViews());
  });

  els.dropZone.addEventListener("click", () => els.fileInput.click());
  els.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); els.fileInput.click(); }
  });
  ["dragenter","dragover"].forEach((name) => els.dropZone.addEventListener(name, (event) => {
    event.preventDefault(); els.dropZone.classList.add("dragging");
  }));
  ["dragleave","drop"].forEach((name) => els.dropZone.addEventListener(name, (event) => {
    event.preventDefault(); els.dropZone.classList.remove("dragging");
  }));
  els.dropZone.addEventListener("drop", (event) => processFiles(event.dataTransfer.files));
  els.fileInput.addEventListener("change", () => processFiles(els.fileInput.files));

  els.anomalyList.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-anomaly-action]");
    const wrapper = event.target.closest("[data-anomaly-id]");
    if (!actionButton || !wrapper) return;
    actionButton.disabled = true;
    try {
      await updateRows("wnmufm_analytics_anomalies", `id=eq.${wrapper.dataset.anomalyId}`, {
        status: actionButton.dataset.anomalyAction,
        reviewed_by_email: currentUser()?.email || null,
        reviewed_at: new Date().toISOString()
      });
      invalidateDataCache();
      takeawayRangeKey="";
      await Promise.all([renderAnomalies(), refreshAnalysisViews()]);
    } catch (error) {
      console.error(error);
      actionButton.disabled = false;
    }
  });
}

async function checkVersion() {
  try {
    const response = await fetch(`src/version.js?t=${Date.now()}`, { cache:"no-store" });
    const text = await response.text();
    const match = text.match(/APP_VERSION\s*=\s*["']([^"']+)["']/);
    if (match && match[1] !== APP_VERSION) location.reload();
  } catch {
    // Version checking is advisory; network errors must not break the app.
  }
}

async function boot() {
  setBusy(true);
  try {
    els.versionBadge.textContent = `v${APP_VERSION}`;
    renderTrendControlButtons();
    renderExploreControlButtons();
    renderTakeawayControlButtons();
    els.trendGrain.value = state.trendGrain;
    applyRangeControls();
    activateTab(state.activeTab,false);
    bindTabs();
    bindEvents();
    try {
      await withTimeout(
        consumeOAuthCallback(),
        10000,
        "GitHub sign-in completion timed out."
      );
    } catch (error) {
      showLoginMessage(error.message);
    }
    const authenticated = await establishAccess();
    if (authenticated) {
      await syncAvailableDataRange();
      await renderProgramFilterOptions();
      await refreshDashboard();
    }
    setInterval(checkVersion, 5 * 60 * 1000);
  } catch (error) {
    console.error("WNMU-FM boot failed", error);
    showLoginMessage("The app could not finish loading. Please sign in again or reload the page.");
    setAuthenticated(false);
  } finally {
    if (!els.startupPanel.hidden && els.authPanel.hidden && els.appPanel.hidden) setAuthenticated(false);
    setBusy(false);
  }
}

boot();

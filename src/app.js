import { APP_VERSION } from "./version.js";
import { consumeOAuthCallback, currentUser, fetchRole, getSession, signIn, signInWithGitHub, signOut, updateRows } from "./api.js";
import { invalidateDataCache, loadAvailableDataRange, loadBreakdownDimensionMetrics, loadDateObservations, loadImports, loadLatestBreakdown, loadLatestValues, loadLongestBreakdown, loadNewsletterScheduleEvidence, loadOpenAnomalies, loadReviewedAnomalies, loadStreamGuysHourly, loadTimeSeries, loadTimeSeriesRange } from "./data.js";
import { importExport } from "./importer.js";
import { renderBarChart, renderIndexedMultiLineChart, renderLineChart, renderMultiLineChart, formatMetric } from "./charts.js";
import { formatDayDate, formatPeriod, indexToMedian, isWeekendDate, matchesWeekpart, median, percentFromMedian, shortDayLabel, shortMonthLabel } from "./analysis.js";
import { matchesNotableDateMode, notableContextLabel, notableDateContext } from "./notable-dates.js";
import { buildHourSchedule, buildTypicalHourContext, entryHourDayOffset, hourLabel } from "./schedule.js";
import { fetchComposerSchedule, fetchExactComposerScheduleRange } from "./schedule-client.js";
import { CONFIG } from "./config.js";
import { buildViewSearch, parseViewState, validIsoDate } from "./view-state.js";
import { buildRangePresets, defaultRecentRange } from "./range-presets.js";
import { analyzeTakeaways, sortTakeaways, TAKEAWAY_BENCHMARK_METRICS, TAKEAWAY_CATEGORIES, TAKEAWAY_METRICS } from "./takeaways.js";
import { analyzeScheduleTakeaways, addScheduleContextToTrendFindings } from "./schedule-analysis.js";
import { analyzeNewsletterScheduleTakeaways, newsletterDuplicatesScheduleChange } from "./newsletter-schedule-analysis.js";
import { buildCoverageRows, intersectRanges } from "./coverage-summary.js";
import { addScheduleDays, buildScheduleDays, renderScheduleDay, renderScheduleMonth, renderScheduleWeek, scheduleSourceSummary, scheduleViewRange, shiftScheduleDate } from "./schedule-explorer.js";

const els = Object.fromEntries([
  "startupPanel","authPanel","appPanel","loginForm","loginEmail","loginPassword","loginMessage","githubLoginButton","headerNav","dataInfoButton","dataInfoDialog","dataInfoDialogClose","userBadge","logoutButton","printButton",
  "refreshButton","summaryCards","trendViewButtons","trendMetricControl","trendMetricButtons","trendQuickRangeButtons","trendHourControl","trendHourSelect","trendProfileCompareControl","trendProfileCompareSelect","trendWeekpartControls","trendWeekpartButtons","trendNotableControls","trendNotableButtons","trendProgramControl","trendProgramSelect","trendMedianSummary","trendBenchmarkNote","trendChartToolbar","trendZoomButton","trendZoomReset","trendZoomStatus","trendTitle","trendDescription","trendChart","trendDataDetails","trendDataSummary","trendTable","trendPrintColumns","programBars",
  "deviceBars","channelBars","streamingWeekpartBars","streamingWeekpartNote","listeningHourPanel","listeningHourEyebrow","scheduleProgramFilterControl","scheduleProgramFilter","nprHourChart","nprHourTable","nprHourDescription","detailDialog","detailDialogEyebrow","detailDialogTitle","detailDialogBody","detailDialogClose","anomalyCount","anomalyList","coverageTable","dropZone","fileInput",
  "filterName","filterValue","importQueue","importHistory","collectionChecklist","versionBadge","exploreViewButtons","exploreDescription","explorePeriod","exploreChart","takeawayCategoryButtons","takeawaySummary","takeawayList","scheduleViewButtons","scheduleAnchorDate","schedulePrevButton","scheduleTodayButton","scheduleNextButton","scheduleTimeControl","scheduleTime","scheduleWindowControl","scheduleWindowStart","scheduleSourceNote","scheduleExplorerBody","globalStartDate","globalEndDate","clearDateRange","copyViewButton","copyViewStatus","availableRangeLabel","dataAvailability","dataAvailabilityHint","dataAvailabilityRows"
].map((id) => [id, document.getElementById(id)]));

const UI_STATE_KEY = "wnmufm.analytics.ui";
const restoredUi = (() => {
  try { return JSON.parse(sessionStorage.getItem(UI_STATE_KEY) || "{}"); } catch { return {}; }
})();
const sharedView = parseViewState(window.location.search);
const validDateKey = validIsoDate;
const validChoice = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const validScheduleTime = (value, fallback="12:00") => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : fallback;
const sharedOrRestored = (key, fallback = "") => sharedView[key] !== undefined ? sharedView[key] : (restoredUi[key] ?? fallback);
const initialStartDate = validDateKey(sharedOrRestored("startDate",""));
const initialEndDate = validDateKey(sharedOrRestored("endDate",""));
const initialTrendZoomStart = validDateKey(sharedOrRestored("trendZoomStart",""));
const initialTrendZoomEnd = validDateKey(sharedOrRestored("trendZoomEnd",""));
const initialRangeMode = validChoice(sharedOrRestored("rangeMode",""), ["all","custom","recent13"], (initialStartDate || initialEndDate) ? "custom" : "recent13");
const initialMetrics = Array.isArray(sharedView.trendMetrics) && sharedView.trendMetrics.length
  ? sharedView.trendMetrics
  : (Array.isArray(restoredUi.trendMetrics) && restoredUi.trendMetrics.length ? restoredUi.trendMetrics : ["streaming.listeners"]);
const DAY_SERIES_KEYS=["all","weekday","weekend","mon","tue","wed","thu","fri","sat","sun"];
const initialWeekpart=validChoice(sharedOrRestored("trendWeekpart","all"),DAY_SERIES_KEYS,"all");
const restoredDaySeries=Array.isArray(sharedView.trendDaySeries) ? sharedView.trendDaySeries : (Array.isArray(restoredUi.trendDaySeries) ? restoredUi.trendDaySeries : []);
const initialDaySeries=[...new Set(restoredDaySeries.filter((key)=>DAY_SERIES_KEYS.includes(key)))];
if(!initialDaySeries.length) initialDaySeries.push(initialWeekpart);

const state = {
  role:null,
  loading:false,
  trendMetrics:initialMetrics,
  trendMode:validChoice(sharedOrRestored("trendMode","overtime"), ["overtime","timeofday"], "overtime"),
  trendHour:validChoice(sharedOrRestored("trendHour","profile"), ["profile",...Array.from({length:24},(_,hour)=>String(hour).padStart(2,"0"))], "profile"),
  trendProfileCompare:validChoice(sharedOrRestored("trendProfileCompare","overall"), ["overall","day","week","month","quarter"], "overall"),
  trendGrain:validChoice(sharedOrRestored("trendGrain","day"), ["day","week","month"], "day"),
  trendWeekpart:initialWeekpart,
  trendDaySeries:initialDaySeries,
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
  activeTab:validChoice(sharedOrRestored("activeTab","overview"), ["overview","takeaways","explore","schedule","imports"], "overview"),
  exploreView:validChoice(sharedOrRestored("exploreView","audio-programs"), ["audio-programs","audio-players","ga4-pages","ga4-landing","ga4-traffic","ga4-sources","ga4-events","ga4-countries","ga4-cities","ga4-browser","ga4-devices","ga4-screens","website-channels","website-countries","streaming-devices","npr-one-podcasts","npr-one-audio","npr-one-clients"], "audio-programs"),
  takeawayCategory:validChoice(sharedOrRestored("takeawayCategory","all"), TAKEAWAY_CATEGORIES.map(([key])=>key), "all"),
  scheduleView:validChoice(sharedOrRestored("scheduleView","month"), ["month","week","day"], "month"),
  scheduleDate:validDateKey(sharedOrRestored("scheduleDate","")),
  scheduleTime:validScheduleTime(sharedOrRestored("scheduleTime","12:00")),
  scheduleWindowStart:validChoice(sharedOrRestored("scheduleWindowStart","6"), ["0","6","12","18"], "6")
};
let busyDepth = 0;
let trendRequestId = 0;
let exploreRequestId = 0;
let breakdownRequestId = 0;
let scheduleRequestId = 0;
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
    trendMode:state.trendMode,
    trendHour:state.trendHour,
    trendProfileCompare:state.trendProfileCompare,
    trendGrain:state.trendGrain,
    trendWeekpart:state.trendWeekpart,
    trendDaySeries:state.trendDaySeries,
    trendNotable:state.trendNotable,
    trendProgram:state.trendProgram,
    trendZoomStart:state.trendZoomStart,
    trendZoomEnd:state.trendZoomEnd,
    takeawayCategory:state.takeawayCategory,
    scheduleView:state.scheduleView,
    scheduleDate:state.scheduleDate,
    scheduleTime:state.scheduleTime,
    scheduleWindowStart:state.scheduleWindowStart
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
  ["all","All days",0],["weekday","Mon–Fri",1],["weekend","Weekend",2],
  ["mon","Mon",3],["tue","Tue",4],["wed","Wed",5],["thu","Thu",6],["fri","Fri",7],["sat","Sat",8],["sun","Sun",9]
];
function daySeriesMeta(key) {
  const row=WEEKPARTS.find(([value])=>value===key);
  return row ? {key:row[0],label:row[1],colorIndex:row[2]} : {key,label:key,colorIndex:0};
}
function matchesSelectedDaySeries(date, keys=state.trendDaySeries) {
  return (keys?.length ? keys : ["all"]).some((key)=>matchesWeekpart(date,key));
}
function selectedDaySeriesLabel(keys=state.trendDaySeries) {
  return (keys?.length ? keys : ["all"]).map((key)=>daySeriesMeta(key).label).join(" + ");
}
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
  els.trendHourSelect.innerHTML = '<option value="profile">24-hour profile</option>' + Array.from({length:24},(_,hour)=>`<option value="${String(hour).padStart(2,"0")}">${escapeHtml(hourLabel(hour))}</option>`).join("");
  els.trendHourSelect.value=state.trendHour;
  els.trendMetricButtons.innerHTML = TREND_METRICS.map((item) =>
    `<button type="button" class="filter-button ${item.priority === "diagnostic" ? "diagnostic" : ""}" data-trend-metric="${escapeHtml(item.key)}" aria-pressed="${state.trendMetrics.includes(item.key)}">${escapeHtml(item.label)}</button>`
  ).join("");
  els.trendWeekpartButtons.innerHTML = WEEKPARTS.map(([key,label,colorIndex]) =>
    `<label class="day-series-option day-color-${colorIndex}" data-day-series="${key}"><input type="checkbox" data-weekpart="${key}" ${state.trendDaySeries.includes(key) ? "checked" : ""}><span>${label}</span></label>`
  ).join("");
  els.trendNotableButtons.innerHTML = NOTABLE_MODES.map(([key,label]) =>
    `<button type="button" class="filter-button" data-notable-mode="${key}" aria-pressed="${key === state.trendNotable}">${label}</button>`
  ).join("");
}

function refreshTrendControlState() {
  const activeView=state.trendMode==="timeofday" ? "timeofday" : state.trendGrain;
  els.trendViewButtons.querySelectorAll("[data-trend-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.trendView === activeView));
  });
  if(els.trendHourSelect.value!==state.trendHour) els.trendHourSelect.value=state.trendHour;
  els.trendMetricButtons.querySelectorAll("[data-trend-metric]").forEach((button) => {
    button.setAttribute("aria-pressed", String(state.trendMetrics.includes(button.dataset.trendMetric)));
  });
  els.trendWeekpartButtons.querySelectorAll("input[data-weekpart]").forEach((input) => {
    input.checked=state.trendDaySeries.includes(input.dataset.weekpart);
  });
  els.trendNotableButtons.querySelectorAll("[data-notable-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.notableMode === state.trendNotable));
  });
}

function setTrendControlDisabled(container, disabled, reason = "") {
  if(!container) return;
  container.classList.toggle("is-disabled",disabled);
  container.toggleAttribute("aria-disabled",disabled);
  if(disabled && reason) container.setAttribute("title",reason);
  else container.removeAttribute("title");
  container.querySelectorAll("button,select,input").forEach((control)=>{
    control.disabled=disabled;
  });
}

function setTrendControlAvailability({ programCapable = false } = {}) {
  const timeOfDay=state.trendMode==="timeofday";
  const dayLevel=timeOfDay || state.trendGrain==="day";

  setTrendControlDisabled(
    els.trendWeekpartControls,
    !dayLevel,
    "Days included is available for Day and Time of day views."
  );
  setTrendControlDisabled(
    els.trendNotableControls,
    !dayLevel,
    "Special-date filtering is available for Day and Time of day views."
  );
  setTrendControlDisabled(
    els.trendMetricControl,
    timeOfDay,
    "Time of day currently uses StreamGuys TLH because that is the hourly history we have."
  );
  setTrendControlDisabled(
    els.trendHourControl,
    !timeOfDay,
    "Hour focus is available only in Time of day view."
  );
  updateProfileComparisonControl();
  setTrendControlDisabled(
    els.trendProfileCompareControl,
    !timeOfDay || state.trendHour!=="profile",
    !timeOfDay ? "Profile comparison is available only in Time of day view." : "Profile comparison applies to the 24-hour profile, not an individual hour focus."
  );
  setTrendControlDisabled(
    els.trendProgramControl,
    timeOfDay || !programCapable,
    timeOfDay
      ? "Program filtering is not available for hourly TLH because an hour can contain more than one program."
      : "Program filtering is available only for on-demand audio metrics."
  );
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

function clockMinutes(value) {
  const match=String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if(!match) return null;
  return Number(match[1])*60+Number(match[2]);
}

function programsForExactHour(entries,hour) {
  const hourStart=Number(hour)*60;
  const hourEnd=hourStart+60;
  const seen=new Set();
  return (entries || []).filter((entry)=>{
    const start=clockMinutes(entry.start);
    let end=clockMinutes(entry.end);
    if(start===null || end===null) return false;
    if(end<=start) end+=1440;
    return start<hourEnd && end>hourStart;
  }).map((entry)=>entry.program).filter((name)=>name && !seen.has(name) && seen.add(name));
}

function buildStreamGuysHourProfile(rows) {
  if(!rows?.length) return [];
  const buckets=new Map();
  rows.forEach((row)=>{
    const date=new Date(`${row.schedule_date}T12:00:00Z`);
    if(Number.isNaN(date.getTime())) return;
    const hour=String(row.schedule_hour || "").slice(0,2);
    if(!/^\d{2}$/.test(hour)) return;
    const weekpart=[1,2,3,4,5].includes(date.getUTCDay()) ? "weekday" : "weekend";
    const key=`${weekpart}|${hour}`;
    if(!buckets.has(key)) buckets.set(key,[]);
    if(row.tlh_hours!==null && row.tlh_hours!==undefined) buckets.get(key).push(Number(row.tlh_hours));
  });
  const start=rows.reduce((value,row)=>!value || row.schedule_date<value ? row.schedule_date : value,"");
  const end=rows.reduce((value,row)=>!value || row.schedule_date>value ? row.schedule_date : value,"");
  return [...buckets.entries()].map(([dimension_value,values])=>({
    dimension_value,
    station_value:values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null,
    unit:"hours",
    period_start:start,
    period_end:end,
    sample_count:values.length
  })).sort((a,b)=>a.dimension_value.localeCompare(b.dimension_value));
}

function streamGuysDailyTable(rows, dayEntries) {
  if(!rows?.length) return "";
  return `<div class="table-wrap"><table class="hour-table"><thead><tr><th>Eastern hour</th><th class="numeric">TLH</th><th>Scheduled program</th></tr></thead><tbody>${rows.map((row)=>{
    const hour=Number(String(row.schedule_hour || "00").slice(0,2));
    const programs=programsForExactHour(dayEntries,hour);
    return `<tr><td>${escapeHtml(hourLabel(hour))}</td><td class="numeric">${escapeHtml(formatMetric(row.tlh_hours,"hours"))}</td><td>${programs.length ? programs.map((name)=>`<span class="program-line">${escapeHtml(name)}</span>`).join("") : "—"}</td></tr>`;
  }).join("")}</tbody></table></div>`;
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
    const [observations, streamGuysHours] = await Promise.all([loadDateObservations(date), loadStreamGuysHourly({ startDate:date, endDate:date })]);
    const primary = observations.filter((row) => !row.dimension_type);
    const byMetric = new Map(primary.map((row) => [row.metric_key,row]));
    const ordered = DAILY_METRIC_ORDER.map((key) => byMetric.get(key)).filter(Boolean);
    const other = primary.filter((row) => !DAILY_METRIC_ORDER.includes(row.metric_key));
    const selected = byMetric.get(metricKey);
    const delta = selected && medianValue !== null ? percentFromMedian(selected.station_value, medianValue) : null;

    let scheduleHtml = '<p class="panel-note">Schedule lookup unavailable for this date.</p>';
    let dayEntries = [];
    try {
      const scheduleResult = await fetchComposerSchedule(date,date);
      if (scheduleResult.sourceType === "episodes") {
        dayEntries = buildDailySchedule(scheduleResult.entries).get(date) || [];
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
        ${metricKey.startsWith("streaming.") ? (streamGuysHours.length ? '<p class="source-limit">StreamGuys hourly TLH is available below and is provisionally aligned from the source Central-time clock to WNMU Eastern schedule time. The imported source hour remains unchanged.</p>' : '<p class="source-limit">We have daily live-stream totals here, not listener counts by hour or by program. Hourly/sub-hourly streaming data is still required before this app can attribute that audience to individual programs.</p>') : ""}
      </section>
      ${streamGuysHours.length ? `<section class="detail-section"><h3>StreamGuys hourly listening</h3><p class="panel-note">TLH is shown by WNMU Eastern clock hour using the current provisional +${Number(streamGuysHours[0]?.offset_hours || 0)} hour alignment from ${escapeHtml(streamGuysHours[0]?.source_timezone_label || "the StreamGuys source clock")}. Raw source hours are preserved separately.</p><div id="detailStreamGuysHourly"></div>${streamGuysDailyTable(streamGuysHours,dayEntries)}</section>` : ""}
      ${channelRows.length ? '<section class="detail-section"><h3>Website traffic sources that day</h3><div id="detailChannelBars"></div></section>' : ""}
      ${playerRows.length ? '<section class="detail-section"><h3>Audio players that day</h3><div id="detailPlayerBars"></div></section>' : ""}
      ${ga4PageRows.length ? '<section class="detail-section"><h3>Google Analytics 4 pages that day</h3><div id="detailGa4PageBars"></div></section>' : ""}
      ${ga4LandingRows.length ? '<section class="detail-section"><h3>Google Analytics 4 landing pages that day</h3><div id="detailGa4LandingBars"></div></section>' : ""}
      ${ga4ChannelRows.length ? '<section class="detail-section"><h3>Google Analytics 4 session channels that day</h3><div id="detailGa4ChannelBars"></div></section>' : ""}
    `;
    if (streamGuysHours.length) renderLineChart(document.getElementById("detailStreamGuysHourly"), streamGuysHours.map((row)=>({ label:hourLabel(Number(String(row.schedule_hour || "00").slice(0,2))), shortLabel:hourLabel(Number(String(row.schedule_hour || "00").slice(0,2))).replace(":00",""), value:Number(row.tlh_hours), formattedValue:formatMetric(row.tlh_hours,"hours") })), { title:"StreamGuys TLH by Eastern hour", ariaLabel:"StreamGuys total listening hours by WNMU Eastern clock hour", showBars:false, labelAngle:0, labelEvery:2, minLabelGap:12 });
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

const SCHEDULE_VIEWS=Object.freeze([
  ["month","Month"],
  ["week","Week"],
  ["day","Day"]
]);

function detroitTodayIso() {
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Detroit",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(new Date());
  const values=Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderScheduleViewButtons() {
  if(!els.scheduleViewButtons) return;
  els.scheduleViewButtons.innerHTML=SCHEDULE_VIEWS.map(([key,label])=>
    `<button type="button" class="filter-button" data-schedule-view="${escapeHtml(key)}" aria-pressed="${String(key===state.scheduleView)}">${escapeHtml(label)}</button>`
  ).join("");
}

function applyScheduleControls() {
  const displayDate=state.scheduleDate || detroitTodayIso();
  if(els.scheduleAnchorDate) els.scheduleAnchorDate.value=displayDate;
  if(els.scheduleTime) els.scheduleTime.value=state.scheduleTime;
  if(els.scheduleWindowStart) els.scheduleWindowStart.value=state.scheduleWindowStart;
  setHidden(els.scheduleTimeControl,state.scheduleView!=="month");
  setHidden(els.scheduleWindowControl,state.scheduleView!=="week");
  renderScheduleViewButtons();
}

async function renderScheduleExplorer() {
  if(!els.scheduleExplorerBody || !els.scheduleSourceNote) return;
  if(!state.scheduleDate) state.scheduleDate=detroitTodayIso();
  applyScheduleControls();

  const range=scheduleViewRange(state.scheduleView,state.scheduleDate);
  if(!range.startDate || !range.endDate) {
    els.scheduleSourceNote.textContent="Choose a valid schedule date.";
    els.scheduleExplorerBody.innerHTML='<p class="empty-state">No schedule date selected.</p>';
    return;
  }

  const requestId=++scheduleRequestId;
  els.scheduleSourceNote.textContent="Checking WNMU-FM schedule evidence…";
  els.scheduleExplorerBody.innerHTML='<p class="empty-state">Loading schedule…</p>';

  try {
    const carryInDate=addScheduleDays(range.startDate,-1);
    const fetchRange={startDate:carryInDate,endDate:range.endDate};
    const [newsletter,composer]=await Promise.all([
      loadNewsletterScheduleEvidence(fetchRange),
      fetchExactComposerScheduleRange(fetchRange.startDate,fetchRange.endDate,{maxDays:50})
    ]);
    if(requestId!==scheduleRequestId) return;

    const fetchedDays=buildScheduleDays({
      startDate:fetchRange.startDate,
      endDate:fetchRange.endDate,
      newsletter,
      composer
    });
    const carryInDay=fetchedDays[0] || null;
    const days=fetchedDays.slice(1);
    const knownDays=days.filter((day)=>day.entries.length).length;
    const sourceSummary=scheduleSourceSummary(days);
    const unavailable=knownDays===0 && composer?.reason ? ` ${composer.reason}` : "";
    els.scheduleSourceNote.textContent=
      `Best source is chosen independently for each date: exact Composer episodes, then WNMU-FM Preview evidence for its named month/date, then archived Composer recurrence. ${sourceSummary || "No schedule evidence is available for this view."}${unavailable}`;

    if(state.scheduleView==="day") {
      const day=days.find((item)=>item.date===state.scheduleDate) || days[0] || null;
      els.scheduleExplorerBody.innerHTML=renderScheduleDay(day);
    } else if(state.scheduleView==="week") {
      els.scheduleExplorerBody.innerHTML=renderScheduleWeek(days,{windowStart:Number(state.scheduleWindowStart),carryInDay});
    } else {
      els.scheduleExplorerBody.innerHTML=renderScheduleMonth(days,{
        anchorDate:state.scheduleDate,
        time:state.scheduleTime,
        carryInDay
      });
    }
  } catch(error) {
    if(requestId!==scheduleRequestId) return;
    console.error(error);
    els.scheduleSourceNote.textContent="Schedule evidence could not be loaded.";
    els.scheduleExplorerBody.innerHTML=`<p class="empty-state">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  }
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
    return `<article class="takeaway-card${cardClass}" title="${escapeHtml(evidenceMeta)}" data-evidence-meta="${escapeHtml(evidenceMeta)}">
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
    const allMonthlyKeys=[...new Set([...monthlyKeys,...benchmarkKeys])];
    const [dailySets,allMonthlySets,reviewedAnomalies,newsletterSchedule]=await Promise.all([
      Promise.all(dailyKeys.map((metricKey)=>loadTimeSeries(metricKey,"day","{}",selectedRange()))),
      Promise.all(allMonthlyKeys.map((metricKey)=>loadTimeSeries(metricKey,"month","{}",selectedRange()))),
      loadReviewedAnomalies(),
      loadNewsletterScheduleEvidence(selectedRange())
    ]);
    const dailyByMetric=Object.fromEntries(dailyKeys.map((metricKey,index)=>[metricKey,dailySets[index]]));
    const allMonthlyByMetric=Object.fromEntries(allMonthlyKeys.map((metricKey,index)=>[metricKey,allMonthlySets[index]]));
    const monthlyByMetric=Object.fromEntries(monthlyKeys.map((metricKey)=>[metricKey,allMonthlyByMetric[metricKey] || []]));
    const benchmarkByMetric=Object.fromEntries(benchmarkKeys.map((metricKey)=>[metricKey,allMonthlyByMetric[metricKey] || []]));
    takeawayFindings=analyzeTakeaways({dailyByMetric,monthlyByMetric,benchmarkByMetric,reviewedAnomalies});
    const newsletterFindings=analyzeNewsletterScheduleTakeaways({
      sources:newsletterSchedule.sources,
      entries:newsletterSchedule.entries,
      monthlyByMetric,
      dailyByMetric
    });
    takeawayFindings=sortTakeaways([...takeawayFindings,...newsletterFindings]);
    const scheduleNotices=[];
    if(newsletterSchedule.sources.length) {
      const firstNewsletter=newsletterSchedule.sources[0];
      const lastNewsletter=newsletterSchedule.sources.at(-1);
      scheduleNotices.push(`WNMU-FM Preview schedule evidence loaded for ${shortCoverageDate(firstNewsletter.issue_month)} – ${shortCoverageDate(lastNewsletter.issue_month)} (${newsletterSchedule.sources.length} ${newsletterSchedule.sources.length===1 ? "issue" : "issues"}). Monthly grids are treated only as evidence for their named month; explicitly dated listings remain date-specific.`);
    }
    const scheduleRange=takeawayScheduleRange();
    if(scheduleRange.start && scheduleRange.end) {
      const schedule=await fetchExactComposerScheduleRange(scheduleRange.start,scheduleRange.end);
      if(schedule.complete && schedule.entries.length) {
        let scheduleAnalysis=analyzeScheduleTakeaways({
          entries:schedule.entries,
          dailyByMetric,
          supportsSpecials:schedule.supportsSpecials
        });
        if(schedule.sourceType!=="episodes" && newsletterFindings.length) {
          const isNewsletterDuplicate=(change)=>newsletterDuplicatesScheduleChange(newsletterFindings,change);
          scheduleAnalysis={
            ...scheduleAnalysis,
            findings:scheduleAnalysis.findings.filter((finding)=>!isNewsletterDuplicate(finding.scheduleChange)),
            profile:{
              ...scheduleAnalysis.profile,
              regimeChanges:(scheduleAnalysis.profile.regimeChanges || []).filter((change)=>!isNewsletterDuplicate(change))
            }
          };
        }
        takeawayFindings=addScheduleContextToTrendFindings(takeawayFindings,scheduleAnalysis.profile);
        takeawayFindings=sortTakeaways([...takeawayFindings,...scheduleAnalysis.findings]);
        if(schedule.sourceType==="episodes") {
          scheduleNotices.push(scheduleRange.capped
            ? `Composer scheduling analysis uses exact dated schedules within the latest 400 days (${shortCoverageDate(scheduleRange.start)} – ${shortCoverageDate(scheduleRange.end)}).`
            : `Composer scheduling analysis uses exact dated schedules for ${shortCoverageDate(scheduleRange.start)} – ${shortCoverageDate(scheduleRange.end)}.`);
        } else {
          const coverageStart=schedule.coverageStart || scheduleRange.start;
          const coverageEnd=schedule.coverageEnd || scheduleRange.end;
          scheduleNotices.push(`Composer scheduling analysis uses WNMU-FM's archived recurrence definitions for ${shortCoverageDate(coverageStart)} – ${shortCoverageDate(coverageEnd)}; these support recurring-series changes but not one-day specials.`);
        }
      } else {
        scheduleNotices.push(`Composer-based scheduling analysis is unavailable for its lookup window: ${schedule.reason || "historical schedule unavailable"}`);
      }
    }
    takeawayScheduleNotice=scheduleNotices.join(" ");
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
  const target = ["overview","takeaways","explore","schedule","imports"].includes(tab) ? tab : "overview";
  state.activeTab = target;
  document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item.dataset.tab === target));
  document.querySelectorAll(".tab-panel").forEach((panel) => setHidden(panel, panel.dataset.panel !== target));
  if (persist) persistUiState();
  if(target==="takeaways" && state.role) void withBusy(()=>renderTakeaways());
  if(target==="schedule" && state.role) void withBusy(()=>renderScheduleExplorer());
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
  els.dataAvailabilityHint.innerHTML = `${escapeHtml(commonText+googleText)}${commonDaily.startDate ? ` <button type="button" class="coverage-use-range" data-coverage-start="${escapeHtml(commonDaily.startDate)}" data-coverage-end="${escapeHtml(commonDaily.endDate)}">Use common comparable period</button>` : ""}`;

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
  setHidden(els.headerNav, !isAuthenticated);
  setHidden(els.dataInfoButton, !isAuthenticated);
  setHidden(els.copyViewButton, !isAuthenticated);
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

function analysisRangeDayCount() {
  if(!state.startDate || !state.endDate) return Infinity;
  const start=new Date(`${state.startDate}T12:00:00Z`);
  const end=new Date(`${state.endDate}T12:00:00Z`);
  return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    ? Math.floor((end-start)/86400000)+1
    : Infinity;
}

function profileComparisonAvailability() {
  const days=analysisRangeDayCount();
  const oneDaySeries=state.trendDaySeries.length<=1;
  return {
    overall:true,
    day:oneDaySeries && days<=31,
    week:oneDaySeries && days<=183,
    month:oneDaySeries,
    quarter:oneDaySeries
  };
}

function updateProfileComparisonControl() {
  const availability=profileComparisonAvailability();
  [...els.trendProfileCompareSelect.options].forEach((option)=>{
    const allowed=availability[option.value]!==false;
    option.disabled=!allowed;
    option.title=allowed ? "" : (state.trendDaySeries.length>1
      ? "Choose one Days Included option to compare profiles by calendar period."
      : option.value==="day"
        ? "Day profiles are available for analysis periods of 31 days or less."
        : "Week profiles are available for analysis periods of about 6 months or less.");
  });
  if(!availability[state.trendProfileCompare]) {
    state.trendProfileCompare="overall";
    els.trendProfileCompareSelect.value="overall";
  } else if(els.trendProfileCompareSelect.value!==state.trendProfileCompare) {
    els.trendProfileCompareSelect.value=state.trendProfileCompare;
  }
}

function mondayIso(dateString) {
  const date=new Date(`${dateString}T12:00:00Z`);
  const dow=(date.getUTCDay()+6)%7;
  date.setUTCDate(date.getUTCDate()-dow);
  return date.toISOString().slice(0,10);
}

function profileGroupForDate(dateString, mode) {
  if(mode==="day") return {key:dateString,label:formatDayDate(dateString)};
  if(mode==="week") {
    const start=mondayIso(dateString);
    return {key:`week-${start}`,label:`Week of ${formatDayDate(start)}`};
  }
  if(mode==="month") {
    const key=String(dateString).slice(0,7);
    const date=new Date(`${key}-01T12:00:00Z`);
    return {key:`month-${key}`,label:date.toLocaleDateString(undefined,{month:"short",year:"numeric",timeZone:"UTC"})};
  }
  if(mode==="quarter") {
    const year=Number(String(dateString).slice(0,4));
    const month=Number(String(dateString).slice(5,7));
    const quarter=Math.floor((month-1)/3)+1;
    return {key:`quarter-${year}-Q${quarter}`,label:`Q${quarter} ${year}`};
  }
  return {key:"overall",label:"Average TLH"};
}

function buildDayComparisonSeries(rows, keys=state.trendDaySeries) {
  const selected=(keys?.length ? keys : ["all"]).map(daySeriesMeta);
  const series=selected.map((meta,index)=>({key:`days_${index}`,label:meta.label,colorIndex:meta.colorIndex,meta}));
  const points=Array.from({length:24},(_,hour)=>({
    label:hourLabel(hour),
    shortLabel:hourLabel(hour).replace(":00",""),
    values:Object.fromEntries(series.map((item)=>{
      const values=rows.filter((row)=>
        matchesWeekpart(row.schedule_date,item.meta.key) &&
        Number(String(row.schedule_hour || "").slice(0,2))===hour
      ).map((row)=>Number(row.tlh_hours)).filter(Number.isFinite);
      return [item.key,values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null];
    }))
  }));
  return {series:series.map(({key,label,colorIndex})=>({key,label,colorIndex})),points,groupCount:series.length};
}

function buildTimeOfDayProfileSeries(rows, mode) {
  const groups=new Map();
  rows.forEach((row)=>{
    const group=profileGroupForDate(row.schedule_date,mode);
    if(!groups.has(group.key)) groups.set(group.key,{...group,hours:Array.from({length:24},()=>[])});
    const hour=Number(String(row.schedule_hour || "").slice(0,2));
    const value=Number(row.tlh_hours);
    if(Number.isInteger(hour) && hour>=0 && hour<24 && Number.isFinite(value)) groups.get(group.key).hours[hour].push(value);
  });
  const ordered=[...groups.values()].sort((a,b)=>a.key.localeCompare(b.key));
  const series=ordered.map((group,index)=>({key:`profile_${index}`,label:group.label,group}));
  const points=Array.from({length:24},(_,hour)=>({
    label:hourLabel(hour),
    shortLabel:hourLabel(hour).replace(":00",""),
    values:Object.fromEntries(series.map((item)=>{
      const values=item.group.hours[hour];
      return [item.key,values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null];
    }))
  }));
  return {series:series.map(({key,label})=>({key,label})),points,groupCount:series.length};
}

async function renderTimeOfDayTrend(requestId) {
  setTrendControlAvailability({ programCapable:false });
  refreshTrendControlState();

  const filterNotes=[];
  if(!(state.trendDaySeries.length===1 && state.trendDaySeries[0]==="all")) filterNotes.push(selectedDaySeriesLabel());
  if(state.trendNotable!=="all") filterNotes.push(NOTABLE_MODES.find(([key])=>key===state.trendNotable)?.[1]);
  if(state.startDate || state.endDate) filterNotes.push(`Range: ${state.startDate ? formatDayDate(state.startDate) : "earliest"} – ${state.endDate ? formatDayDate(state.endDate) : "latest"}`);

  const rows=await loadStreamGuysHourly(selectedRange());
  if(requestId!==trendRequestId) return;
  const notableFiltered=rows.filter((row)=>matchesNotableDateMode(row.schedule_date,state.trendNotable));
  const filtered=notableFiltered.filter((row)=>matchesSelectedDaySeries(row.schedule_date));

  setHidden(els.trendBenchmarkNote,false);
  const alignment=filtered[0] || rows[0] || null;
  els.trendBenchmarkNote.textContent=alignment
    ? `StreamGuys source hours are preserved unchanged. This view currently applies the provisional +${Number(alignment.offset_hours || 0)} hour mapping from ${alignment.source_timezone_label || "the StreamGuys source clock"} to WNMU Eastern schedule time. Changing or disabling that single alignment setting rolls this interpretation back without changing the imports.`
    : "StreamGuys hourly TLH is not available in this Analysis Range.";

  if(state.trendHour!=="profile") {
    const hourKey=state.trendHour;
    const hourNumber=Number(hourKey);
    const hourRows=filtered.filter((row)=>String(row.schedule_hour || "").startsWith(`${hourKey}:`));
    const values=hourRows.map((row)=>Number(row.tlh_hours)).filter(Number.isFinite);
    const medianValue=values.length ? median(values) : null;
    const averageValue=values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
    const latest=hourRows.length ? hourRows[hourRows.length-1] : null;

    els.trendTitle.textContent=`StreamGuys TLH at ${hourLabel(hourNumber)}`;
    els.trendDescription.textContent=
      `This traces the ${hourLabel(hourNumber)}–${hourLabel((hourNumber+1)%24)} WNMU Eastern hour across the selected dates using one StreamGuys observation per day. Date labels are thinned for readability, but the line and nodes use the full daily series.` +
      (filterNotes.length ? ` Showing ${filterNotes.join(" · ")}.` : "");
    els.trendMedianSummary.innerHTML=values.length ? [
      `<span><strong>Average:</strong> ${escapeHtml(formatMetric(averageValue,"hours"))}</span>`,
      `<span><strong>Median:</strong> ${escapeHtml(formatMetric(medianValue,"hours"))}</span>`,
      latest ? `<span><strong>Latest:</strong> ${escapeHtml(formatMetric(latest.tlh_hours,"hours"))}</span>` : "",
      `<span><strong>Daily observations:</strong> ${values.length.toLocaleString()}</span>`
    ].join("") : "";

    setHidden(els.trendChartToolbar,false);
    updateTrendZoomControls();
    const points=hourRows.map((row)=>({
      date:row.schedule_date,
      label:formatDayDate(row.schedule_date),
      shortLabel:shortDayLabel(row.schedule_date),
      value:Number(row.tlh_hours),
      weekend:isWeekendDate(row.schedule_date),
      tooltipModel:{
        title:`${formatDayDate(row.schedule_date)} · ${hourLabel(hourNumber)}`,
        rows:[{
          tone:"station",
          label:"TLH",
          value:formatMetric(row.tlh_hours,"hours"),
          delta:medianValue===null ? "" : `${signedPercent(percentFromMedian(row.tlh_hours,medianValue))} vs this hour's median`
        }]
      }
    }));
    const chartPoints=zoomedTrendPoints(points);
    updateTrendZoomControls();
    renderLineChart(els.trendChart,chartPoints,{
      title:`StreamGuys TLH at ${hourLabel(hourNumber)}`,
      ariaLabel:`StreamGuys total listening hours at ${hourLabel(hourNumber)} over time`,
      grain:"day",
      primaryLabel:"TLH",
      yAxisLabel:"Total Listening Hours",
      yTickStep:20,
      yTickFormat:"integer",
      zoomMode:state.trendZoomMode,
      onZoomSelect:setTrendZoom
    });

    if(!hourRows.length) {
      renderTrendDataTable("",0);
      els.trendPrintColumns.innerHTML="";
      return;
    }
    renderTrendDataTable(`<table class="trend-data-table">
      <thead><tr><th>Date</th><th class="numeric">TLH</th><th class="numeric">Vs median</th><th>Raw StreamGuys hour</th></tr></thead>
      <tbody>${hourRows.map((row)=>`<tr${isWeekendDate(row.schedule_date) ? ' class="weekend-row"' : ""}><td>${escapeHtml(formatDayDate(row.schedule_date))}</td><td class="numeric">${escapeHtml(formatMetric(row.tlh_hours,"hours"))}</td><td class="numeric">${escapeHtml(signedPercent(percentFromMedian(row.tlh_hours,medianValue)))}</td><td>${escapeHtml(row.source_hour || "—")}</td></tr>`).join("")}</tbody>
    </table>`,hourRows.length);
    renderTrendPrintDetail(hourRows.map((row)=>({period_start:row.schedule_date,station_value:row.tlh_hours,unit:"hours"})),"day",medianValue);
    return;
  }

  clearTrendZoom();
  setHidden(els.trendChartToolbar,true);
  els.trendTitle.textContent="StreamGuys TLH by time of day";
  els.trendDescription.textContent=
    "Each point is the average StreamGuys total listening hours for that WNMU Eastern clock hour across the matching dates. Use the Analysis Range, quick ranges, week-part buttons and notable-date filter to change which days contribute to the profile. Choose an individual Hour focus to trace that hour across time." +
    (filterNotes.length ? ` Showing ${filterNotes.join(" · ")}.` : "");

  updateProfileComparisonControl();
  const comparisonMode=state.trendProfileCompare;
  if(comparisonMode==="overall") {
    const dayComparison=buildDayComparisonSeries(notableFiltered,state.trendDaySeries);
    els.trendTitle.textContent=dayComparison.groupCount>1 ? "StreamGuys TLH by time of day · day comparison" : `StreamGuys TLH by time of day · ${dayComparison.series[0]?.label || "All days"}`;
    els.trendDescription.textContent=
      `Each selected Days Included option is shown as its own 24-hour WNMU Eastern TLH profile. ${dayComparison.groupCount.toLocaleString()} line${dayComparison.groupCount===1 ? "" : "s"} shown.` +
      (filterNotes.length ? ` Showing ${filterNotes.join(" · ")}.` : "");
    els.trendMedianSummary.innerHTML=[
      `<span><strong>Day profiles:</strong> ${escapeHtml(selectedDaySeriesLabel())}</span>`,
      `<span><strong>Hourly observations:</strong> ${filtered.length.toLocaleString()}</span>`
    ].join("");
    renderMultiLineChart(els.trendChart,dayComparison.points,{
      title:"StreamGuys TLH by time of day",
      ariaLabel:"StreamGuys total listening hours by WNMU Eastern clock hour for selected day groups",
      series:dayComparison.series,
      formatValue:(value)=>formatMetric(value,"hours"),
      yAxisLabel:"Total Listening Hours",
      yTickStep:20,
      yTickFormat:"integer",
      labelEvery:2
    });
    renderTrendDataTable("",0);
    els.trendPrintColumns.classList.add("single");
    els.trendPrintColumns.innerHTML=`<p class="print-trend-note"><strong>Time-of-day day comparison:</strong> ${escapeHtml(selectedDaySeriesLabel())}.</p>`;
    return;
  }

  const profileComparison=buildTimeOfDayProfileSeries(filtered,comparisonMode);

  if(comparisonMode!=="overall") {
    els.trendTitle.textContent=`StreamGuys TLH by time of day · ${comparisonMode==="day" ? "daily" : comparisonMode==="week" ? "weekly" : comparisonMode==="month" ? "monthly" : "quarterly"} profiles`;
    els.trendDescription.textContent=
      `Each line is a separate ${comparisonMode} profile across the 24-hour WNMU Eastern clock, using only dates that match the selected day and special-date filters. ${profileComparison.groupCount.toLocaleString()} profiles are shown.` +
      (filterNotes.length ? ` Showing ${filterNotes.join(" · ")}.` : "");
    els.trendMedianSummary.innerHTML=[
      `<span><strong>Profiles:</strong> ${profileComparison.groupCount.toLocaleString()}</span>`,
      `<span><strong>Hourly observations:</strong> ${filtered.length.toLocaleString()}</span>`
    ].join("");
    renderMultiLineChart(els.trendChart,profileComparison.points,{
      title:"StreamGuys time-of-day profiles",
      ariaLabel:`StreamGuys total listening hours by time of day compared by ${comparisonMode}`,
      series:profileComparison.series,
      formatValue:(value)=>formatMetric(value,"hours"),
      yAxisLabel:"Total Listening Hours",
      yTickStep:20,
      yTickFormat:"integer",
      labelEvery:2
    });
    renderTrendDataTable("",0);
    els.trendPrintColumns.classList.add("single");
    els.trendPrintColumns.innerHTML=`<p class="print-trend-note"><strong>Time-of-day comparison:</strong> ${profileComparison.groupCount} ${escapeHtml(comparisonMode)} profiles across the selected analysis period.</p>`;
    return;
  }

  const buckets=Array.from({length:24},(_,hour)=>({hour,values:[]}));
  filtered.forEach((row)=>{
    const hour=Number(String(row.schedule_hour || "").slice(0,2));
    const value=Number(row.tlh_hours);
    if(Number.isInteger(hour) && hour>=0 && hour<24 && Number.isFinite(value)) buckets[hour].values.push(value);
  });

  const stats=buckets.map(({hour,values})=>{
    const sorted=[...values].sort((a,b)=>a-b);
    const average=values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
    return {
      hour,
      average,
      median:values.length ? median(values) : null,
      min:values.length ? sorted[0] : null,
      max:values.length ? sorted[sorted.length-1] : null,
      count:values.length
    };
  });
  const populated=stats.filter((item)=>item.average!==null);
  const peak=populated.reduce((best,item)=>!best || item.average>best.average ? item : best,null);
  const low=populated.reduce((best,item)=>!best || item.average<best.average ? item : best,null);

  els.trendMedianSummary.innerHTML=populated.length ? [
    peak ? `<span><strong>Peak hour:</strong> ${escapeHtml(hourLabel(peak.hour))}</span>` : "",
    peak ? `<span><strong>Peak avg. TLH:</strong> ${escapeHtml(formatMetric(peak.average,"hours"))}</span>` : "",
    low ? `<span><strong>Lowest hour:</strong> ${escapeHtml(hourLabel(low.hour))}</span>` : "",
    `<span><strong>Hourly observations:</strong> ${filtered.length.toLocaleString()}</span>`
  ].join("") : "";

  const points=stats.map((item)=>({
    label:hourLabel(item.hour),
    shortLabel:hourLabel(item.hour).replace(":00",""),
    value:item.average,
    tooltipModel:{
      title:hourLabel(item.hour),
      rows:[{
        tone:"station",
        label:"Average TLH",
        value:item.average===null ? "—" : formatMetric(item.average,"hours"),
        delta:item.count ? `${item.count.toLocaleString()} matching days · median ${formatMetric(item.median,"hours")}` : "No matching days"
      }]
    }
  }));

  renderLineChart(els.trendChart,points,{
    title:"StreamGuys TLH by time of day",
    ariaLabel:"Average StreamGuys total listening hours by WNMU Eastern clock hour",
    primaryLabel:"Average TLH",
    yAxisLabel:"Total Listening Hours",
    yTickStep:20,
    yTickFormat:"integer",
    showBars:false,
    labelAngle:0,
    labelEvery:2,
    minLabelGap:12
  });

  if(!populated.length) {
    renderTrendDataTable("",0);
    els.trendPrintColumns.innerHTML="";
    return;
  }

  renderTrendDataTable(`<table class="trend-data-table">
    <thead><tr><th>Eastern hour</th><th class="numeric">Average TLH</th><th class="numeric">Median TLH</th><th class="numeric">Low</th><th class="numeric">High</th><th class="numeric">Days</th></tr></thead>
    <tbody>${stats.map((item)=>`<tr><td>${escapeHtml(hourLabel(item.hour))}</td><td class="numeric">${item.average===null ? "—" : escapeHtml(formatMetric(item.average,"hours"))}</td><td class="numeric">${item.median===null ? "—" : escapeHtml(formatMetric(item.median,"hours"))}</td><td class="numeric">${item.min===null ? "—" : escapeHtml(formatMetric(item.min,"hours"))}</td><td class="numeric">${item.max===null ? "—" : escapeHtml(formatMetric(item.max,"hours"))}</td><td class="numeric">${item.count.toLocaleString()}</td></tr>`).join("")}</tbody>
  </table>`,stats.length);
  els.trendPrintColumns.classList.add("single");
  els.trendPrintColumns.innerHTML=`<p class="print-trend-note"><strong>Time-of-day profile:</strong> average StreamGuys TLH by WNMU Eastern clock hour for the selected date and day filters. The Central-to-Eastern source alignment remains provisional and reversible.</p>`;
}

async function renderTrend() {
  const requestId = ++trendRequestId;
  if(state.trendMode==="timeofday") {
    await renderTimeOfDayTrend(requestId);
    return;
  }
  setHidden(els.trendChartToolbar,false);
  const validMetricKeys = new Set(TREND_METRICS.map((item)=>item.key));
  state.trendMetrics = state.trendMetrics.filter((key)=>validMetricKeys.has(key));
  if (!state.trendMetrics.length) state.trendMetrics = ["streaming.listeners"];

  const metricKeys = [...state.trendMetrics];
  const multiple = metricKeys.length > 1;
  const grain = state.trendGrain;
  const programCapable = metricKeys.every((key)=>key === "audio.downloads" || key === "audio.users");
  setTrendControlAvailability({ programCapable });
  refreshTrendControlState();
  updateTrendZoomControls();

  const selectedProgram = programCapable ? state.trendProgram : "";
  const filterSignature = selectedProgram ? JSON.stringify({ selected_program:selectedProgram }) : "{}";
  const metricLabels = metricKeys.map(trendMetricLabel);
  els.trendTitle.textContent = multiple
    ? `Compare: ${metricLabels.join(" + ")}`
    : selectedProgram ? `${metricLabels[0]}: ${selectedProgram}` : metricLabels[0];

  const filterNotes = [];
  if (grain === "day" && !(state.trendDaySeries.length===1 && state.trendDaySeries[0]==="all")) filterNotes.push(selectedDaySeriesLabel());
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
      ? rows.filter((row)=>matchesSelectedDaySeries(row.period_start) && matchesNotableDateMode(row.period_start,state.trendNotable))
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
  const { hours, entries, typicalEntries = entries, scheduleNote, periodStart, periodEnd, rangeMismatch = false, sourceType = "npr_one", alignment = null } = context;
  const byKey=new Map(hours.map((row)=>[row.dimension_value,row]));
  const typicalByHour=buildTypicalHourContext(typicalEntries);
  const names=[...new Set(entries.map((entry)=>entry.program).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const previous=state.scheduleProgram;
  els.scheduleProgramFilter.innerHTML='<option value="">All programs</option>'+names.map((name)=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if(previous && names.includes(previous)) els.scheduleProgramFilter.value=previous; else state.scheduleProgram="";
  setHidden(els.scheduleProgramFilterControl, names.length === 0);
  els.listeningHourPanel.classList.remove("compact-empty");
  if(els.listeningHourEyebrow) els.listeningHourEyebrow.textContent=sourceType==="streamguys" ? "StreamGuys + WNMU schedule" : "NPR One + WNMU schedule";

  const rangeWarning = rangeMismatch
    ? `<span class="source-range-warning" role="status"><strong>Source range notice</strong><span>Listening by Hour uses <b>${escapeHtml(formatDayDate(periodStart))} – ${escapeHtml(formatDayDate(periodEnd))}</b>; your Analysis Range is <b>${escapeHtml(formatDayDate(state.startDate))} – ${escapeHtml(formatDayDate(state.endDate))}</b>. NPR provides this profile only as a whole-report aggregate, so this graph remains on the NPR source period.</span></span> `
    : "";
  els.nprHourDescription.innerHTML=sourceType==="streamguys"
    ? `StreamGuys TLH is averaged for each <strong>WNMU Eastern clock hour</strong> across <strong>${escapeHtml(formatDayDate(periodStart))} – ${escapeHtml(formatDayDate(periodEnd))}</strong>. The imported source hour is preserved unchanged; this view uses a <strong>provisional +${Number(alignment?.offset_hours || 0)} hour</strong> schedule alignment from ${escapeHtml(alignment?.source_timezone_label || "the StreamGuys source clock")}. Schedule columns provide program context; TLH is measured at the hour level, not by individual program when an hour contains a transition. ${escapeHtml(scheduleNote)}`
    : `${rangeWarning}NPR One gives a <strong>weekday average</strong> and a <strong>weekend average</strong> for each clock hour across the source period <strong>${escapeHtml(formatDayDate(periodStart))} – ${escapeHtml(formatDayDate(periodEnd))}</strong>, not seven separate daily audience counts. Schedule columns are context, not program-level audience measurements. ${escapeHtml(scheduleNote)}`;

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
    title:sourceType==="streamguys" ? "StreamGuys TLH by hour" : "NPR One listening by hour",
    ariaLabel:sourceType==="streamguys" ? "Average StreamGuys total listening hours by Eastern clock hour, weekdays compared with weekends" : "Average NPR One hourly listeners, weekdays compared with weekends",
    primaryLabel:"Weekday",
    secondaryLabel:"Weekend",
    showBars:false,
    labelAngle:0,
    labelEvery:2,
    minLabelGap:12
  });
  const hourlyValueLabel=sourceType==="streamguys" ? "Avg. TLH" : "Avg.";
  els.nprHourTable.innerHTML=entries.length ? `
    <section class="hour-section"><h4>Monday–Friday schedule against weekday hourly average</h4><div class="table-wrap"><table class="hour-table weekday-hour-table"><thead><tr><th>Hour</th><th>Weekday<br>${hourlyValueLabel}</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th></tr></thead><tbody>${weekdayRows.join("") || '<tr><td colspan="7">No hours match this program filter.</td></tr>'}</tbody></table></div></section>
    <section class="hour-section"><h4>Weekend schedule against weekend hourly average</h4><div class="table-wrap"><table class="hour-table weekend-hour-table"><thead><tr><th>Hour</th><th>Weekend<br>${hourlyValueLabel}</th><th>Saturday</th><th>Sunday</th></tr></thead><tbody>${weekendRows.join("") || '<tr><td colspan="4">No hours match this program filter.</td></tr>'}</tbody></table></div></section>` : "";
}

async function renderListeningByHour(hours, requestId = breakdownRequestId, { rangeMismatch = false, sourceType = "npr_one", alignment = null } = {}) {
  if (!hours.length) {
    listeningHourContext=null;
    state.scheduleProgram="";
    els.listeningHourPanel.classList.add("compact-empty");
    setHidden(els.scheduleProgramFilterControl,true);
    setHidden(els.nprHourChart,true);
    els.nprHourTable.innerHTML="";
    els.nprHourDescription.innerHTML=`<span class="source-range-warning"><strong>Listening by Hour unavailable.</strong> No imported ${sourceType==="streamguys" ? "StreamGuys hourly TLH" : "NPR One hour-of-day profile"} is available.</span>`;
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
  listeningHourContext={hours,entries,typicalEntries,scheduleNote,periodStart,periodEnd,rangeMismatch,sourceType,alignment};
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
  const [programs, devices, channels] = await Promise.all([
    loadLatestBreakdown("audio.downloads_by_program", "program", "{}", selectedRange()),
    loadLatestBreakdown("streaming.device_share_pct", "device", "{}", selectedRange()),
    loadLatestBreakdown("website.sessions_by_channel", "traffic_channel", "{}", selectedRange())
  ]);
  if (requestId !== breakdownRequestId) return;

  renderBarChart(els.programBars, sortBreakdown(programs).map((row) => ({ label: row.dimension_value, value: row.station_value, formattedValue:formatMetric(row.station_value,row.unit) })), { limit: 12, onBarClick:(row)=>openBreakdownDrilldown("On-demand downloads",row,programs[0] ? formatPeriod(programs[0],programs[0].grain) : "") });
  renderBarChart(els.deviceBars, sortBreakdown(devices).map((row) => ({ label: row.dimension_value, value: row.station_value, formattedValue:`${Number(row.station_value).toFixed(1)}%` })), {
    maxValue: 100,
    formatValue: (value) => `${Number(value).toFixed(1)}%`,
    onBarClick:(row)=>openBreakdownDrilldown("Live-stream device share",row,devices[0] ? formatPeriod(devices[0],devices[0].grain) : "")
  });
  renderBarChart(els.channelBars, sortBreakdown(channels).map((row) => ({ label: exploreDimensionLabel("website-channels",row.dimension_value), value: row.station_value, formattedValue:formatMetric(row.station_value,row.unit) })), { limit: 8, onBarClick:(row)=>openBreakdownDrilldown("Website sessions",row,channels[0] ? formatPeriod(channels[0],channels[0].grain) : "") });
  await renderStreamingWeekpart();
}

async function renderAnomalies() {
  const anomalies = await loadOpenAnomalies();
  els.anomalyCount.textContent = String(anomalies.length);
  if (!anomalies.length) {
    els.anomalyList.innerHTML = '<p class="empty-state">No open anomaly flags.</p>';
    return;
  }
  els.anomalyList.innerHTML = anomalies.map((item) => {
    const overlap=Number(item.occurrenceCount || 1)>1
      ? ` <span class="anomaly-overlap">Seen in ${Number(item.occurrenceCount).toLocaleString()} overlapping imports.</span>`
      : "";
    const grain=String(item.grain || item.evidence?.grain || "unknown");
    const grainLabel=grain==="day" ? "Day" : grain==="week" ? "Week" : grain==="month" ? "Month" : "Unknown grain";
    return `<div class="anomaly-item" data-anomaly-id="${item.id}" data-anomaly-key="${escapeHtml(encodeURIComponent(item.anomaly_key || ""))}" data-anomaly-grain="${escapeHtml(grain)}">
      <div class="anomaly-head"><span class="anomaly-title">${escapeHtml(item.title)}</span><span class="anomaly-badges"><span class="anomaly-grain">${escapeHtml(grainLabel)}</span><span class="severity ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></span></div>
      <p class="anomaly-detail">${escapeHtml(item.detail || "")}${overlap}</p>
      <div class="anomaly-actions">
        <button class="small-button" type="button" data-anomaly-action="expected">Expected</button>
        <button class="small-button" type="button" data-anomaly-action="excluded">Exclude</button>
        <button class="small-button" type="button" data-anomaly-action="resolved">Resolve</button>
      </div>
    </div>`;
  }).join("");
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

function coreHistoryNextTarget(imports,type,whenComplete,targetStart="2025-09-22") {
  const missing=["day","week","month"].filter((grain)=>{
    const span=collectionSpan(imports,type,grain);
    return !span || span.start>targetStart;
  });
  if(missing.length) return `Extend source-valid ${missing.join(", ")} history back through ${formatDayDate(targetStart)}.`;
  return whenComplete;
}

async function renderCollectionChecklist() {
  const imports = await loadImports();
  const rows = [
    { type:"station_streaming", label:"Live streaming", next:coreHistoryNextTarget(imports,"station_streaming","Core Day/Week/Month history plus StreamGuys hourly TLH is loaded. Hourly TLH is provisionally aligned to WNMU Eastern schedule time while the raw source hour remains preserved. Next priority: verify the source timezone interpretation and add finer half-hour/session detail if available.") },
    { type:"station_website", label:"NPR Website", next:coreHistoryNextTarget(imports,"station_website","Core Day/Week/Month history is loaded. Continue periodic refreshes; dated content analysis now belongs primarily in Google Analytics 4.") },
    { type:"audio_downloads", label:"On-demand audio", next:coreHistoryNextTarget(imports,"audio_downloads","Core Day/Week/Month history is loaded. Next expand program drilldowns beyond the currently represented local programs.") },
    { type:"npr_one", label:"NPR One", next:coreHistoryNextTarget(imports,"npr_one","Core Day/Week/Month history is loaded. Continue periodic refreshes as completed reporting periods become available.") }
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
        <li><strong>Live-stream hour/daypart data:</strong> StreamGuys hourly TLH is now loaded and available for schedule-aligned analysis. The Central-to-Eastern mapping remains explicitly provisional and reversible.</li>
        <li><strong>Program drilldowns:</strong> currently only ${programs.length} program buckets are represented (${escapeHtml(programs.join(", ") || "none")}). Get the longest available drilldown for every selectable discrete program.</li>
        <li><strong>Dated Google Analytics 4 content:</strong> ${ga4Daily ? "Date + Page Path / Landing Page daily detail is now supported. Next collect Date + Event name so station-relevant actions can be trended by day." : "Date + Page Path is the most valuable next website export because it allows content to enter Trend Explorer and daily drilldowns."}</li>
        <li><strong>Google Analytics 4 audio-event detail:</strong> event totals can show audio_action and player_interactions, but event parameters are still needed to identify what was played or how the player was used.</li>
        <li><strong>Program/topic taxonomy:</strong> we need categories such as news, classical, jazz, local arts, public affairs and specialty music so performance can be compared by content type.</li>
        <li><strong>Historical schedule:</strong> Preview newsletter evidence is loaded only for issue months we actually possess, with missing issues preserved as gaps. Composer recurrence history accumulates from actual archive captures. Exact dated logs remain especially valuable for preemptions and substitutions.</li>
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
      state.activeTab==="takeaways" ? renderTakeaways() : Promise.resolve(),
      state.activeTab==="schedule" ? renderScheduleExplorer() : Promise.resolve()
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
  els.trendViewButtons.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-trend-view]");
    if(!button) return;
    const view=validChoice(button.dataset.trendView,["day","week","month","timeofday"],"day");
    if(view==="timeofday") {
      state.trendMode="timeofday";
    } else {
      state.trendMode="overtime";
      state.trendGrain=view;
    }
    clearTrendZoom();
    persistUiState();
    void withBusy(()=>renderTrend());
  });
  els.trendHourSelect.addEventListener("change",()=>{
    state.trendHour=validChoice(els.trendHourSelect.value,["profile",...Array.from({length:24},(_,hour)=>String(hour).padStart(2,"0"))],"profile");
    clearTrendZoom();
    persistUiState();
    void withBusy(()=>renderTrend());
  });
  els.trendProfileCompareSelect.addEventListener("change",()=>{
    state.trendProfileCompare=validChoice(els.trendProfileCompareSelect.value,["overall","day","week","month","quarter"],"overall");
    persistUiState();
    void withBusy(()=>renderTrend());
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
  els.trendWeekpartButtons.addEventListener("change", (event) => {
    const input=event.target.closest("input[data-weekpart]");
    if(!input) return;
    const key=input.dataset.weekpart;
    let next=[...state.trendDaySeries];
    if(input.checked) {
      if(!next.includes(key)) next.push(key);
    } else {
      next=next.filter((item)=>item!==key);
    }
    if(!next.length) {
      next=["all"];
      input.checked=true;
    }
    state.trendDaySeries=next;
    state.trendWeekpart=next[0] || "all";
    if(state.trendDaySeries.length>1 && state.trendProfileCompare!=="overall") state.trendProfileCompare="overall";
    updateProfileComparisonControl();
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
  els.scheduleViewButtons.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-schedule-view]");
    if(!button) return;
    state.scheduleView=validChoice(button.dataset.scheduleView,["month","week","day"],"month");
    applyScheduleControls();
    persistUiState();
    void withBusy(()=>renderScheduleExplorer());
  });
  els.scheduleAnchorDate.addEventListener("change",()=>{
    const date=validDateKey(els.scheduleAnchorDate.value);
    if(!date) {
      els.scheduleAnchorDate.value=state.scheduleDate || detroitTodayIso();
      return;
    }
    state.scheduleDate=date;
    persistUiState();
    void withBusy(()=>renderScheduleExplorer());
  });
  els.scheduleTime.addEventListener("change",()=>{
    state.scheduleTime=validScheduleTime(els.scheduleTime.value,state.scheduleTime || "12:00");
    applyScheduleControls();
    persistUiState();
    if(state.scheduleView==="month") void withBusy(()=>renderScheduleExplorer());
  });
  els.scheduleWindowStart.addEventListener("change",()=>{
    state.scheduleWindowStart=validChoice(els.scheduleWindowStart.value,["0","6","12","18"],"6");
    persistUiState();
    if(state.scheduleView==="week") void withBusy(()=>renderScheduleExplorer());
  });
  els.schedulePrevButton.addEventListener("click",()=>{
    state.scheduleDate=shiftScheduleDate(state.scheduleDate || detroitTodayIso(),state.scheduleView,-1);
    applyScheduleControls();
    persistUiState();
    void withBusy(()=>renderScheduleExplorer());
  });
  els.scheduleTodayButton.addEventListener("click",()=>{
    state.scheduleDate=detroitTodayIso();
    applyScheduleControls();
    persistUiState();
    void withBusy(()=>renderScheduleExplorer());
  });
  els.scheduleNextButton.addEventListener("click",()=>{
    state.scheduleDate=shiftScheduleDate(state.scheduleDate || detroitTodayIso(),state.scheduleView,1);
    applyScheduleControls();
    persistUiState();
    void withBusy(()=>renderScheduleExplorer());
  });
  els.scheduleExplorerBody.addEventListener("click",(event)=>{
    const dayButton=event.target.closest("[data-schedule-date]");
    if(!dayButton) return;
    const date=validDateKey(dayButton.dataset.scheduleDate);
    if(!date) return;
    state.scheduleDate=date;
    state.scheduleView="day";
    applyScheduleControls();
    persistUiState();
    void withBusy(()=>renderScheduleExplorer());
  });
  els.takeawayList.addEventListener("click",(event)=>{
    const button=event.target.closest("[data-takeaway-evidence]");
    if(!button) return;
    const metrics=String(button.dataset.metrics || "").split(",").map((item)=>item.trim()).filter(Boolean);
    if(!metrics.length) return;
    const validMetrics=new Set(TREND_METRICS.map((item)=>item.key));
    state.trendMetrics=metrics.filter((metric)=>validMetrics.has(metric));
    if(!state.trendMetrics.length) return;
    state.trendMode="overtime";
    state.trendHour="profile";
    state.trendProfileCompare="overall";
    state.trendGrain=button.dataset.grain || "day";
    state.trendWeekpart="all";
    state.trendDaySeries=["all"];
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
  els.dataInfoButton.addEventListener("click",()=>{
    if(typeof els.dataInfoDialog.showModal==="function") els.dataInfoDialog.showModal();
    else els.dataInfoDialog.setAttribute("open","");
  });
  els.dataInfoDialogClose.addEventListener("click",()=>els.dataInfoDialog.close());
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
      const anomalyKey=decodeURIComponent(wrapper.dataset.anomalyKey || "");
      const anomalyGrain=String(wrapper.dataset.anomalyGrain || "");
      const anomalyQuery=anomalyKey && anomalyGrain
        ? new URLSearchParams({anomaly_key:`eq.${anomalyKey}`,grain:`eq.${anomalyGrain}`,status:"eq.open"}).toString()
        : `id=eq.${wrapper.dataset.anomalyId}`;
      await updateRows("wnmufm_analytics_anomalies", anomalyQuery, {
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
    renderScheduleViewButtons();
    applyScheduleControls();
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

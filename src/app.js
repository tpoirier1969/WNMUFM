import { APP_VERSION } from "./version.js";
import { consumeOAuthCallback, currentUser, fetchRole, getSession, signIn, signInWithGitHub, signOut, updateRows } from "./api.js";
import { invalidateDataCache, loadDateObservations, loadImports, loadLatestBreakdown, loadLatestValues, loadOpenAnomalies, loadTimeSeries } from "./data.js";
import { importExport } from "./importer.js";
import { renderBarChart, renderLineChart, formatMetric } from "./charts.js";
import { formatDayDate, formatPeriod, isWeekendDate, matchesWeekpart, median, percentFromMedian, shortDayLabel, shortMonthLabel } from "./analysis.js";
import { matchesNotableDateMode, notableContextLabel, notableDateContext } from "./notable-dates.js";
import { buildHourSchedule, hourLabel } from "./schedule.js";
import { fetchComposerSchedule } from "./schedule-client.js";
import { CONFIG } from "./config.js";

const els = Object.fromEntries([
  "startupPanel","authPanel","appPanel","loginForm","loginEmail","loginPassword","loginMessage","githubLoginButton","userBadge","logoutButton","printButton",
  "refreshButton","summaryCards","trendMetricButtons","trendGrain","trendWeekpartControls","trendWeekpartButtons","trendNotableControls","trendNotableButtons","trendProgramControl","trendProgramSelect","trendMedianSummary","trendTitle","trendDescription","trendChart","trendTable","trendPrintColumns","programBars",
  "deviceBars","channelBars","streamingWeekpartBars","streamingWeekpartNote","scheduleProgramFilter","nprHourChart","nprHourTable","nprHourDescription","detailDialog","detailDialogEyebrow","detailDialogTitle","detailDialogBody","detailDialogClose","anomalyCount","anomalyList","coverageTable","dropZone","fileInput",
  "filterName","filterValue","importQueue","importHistory","collectionChecklist","versionBadge","exploreViewButtons","exploreDescription","explorePeriod","exploreChart","exploreTable","globalStartDate","globalEndDate","clearDateRange"
].map((id) => [id, document.getElementById(id)]));

const UI_STATE_KEY = "wnmufm.analytics.ui";
const restoredUi = (() => {
  try { return JSON.parse(sessionStorage.getItem(UI_STATE_KEY) || "{}"); } catch { return {}; }
})();
const state = {
  role:null,
  loading:false,
  trendMetric:"streaming.listeners",
  trendWeekpart:"all",
  trendNotable:"all",
  trendProgram:"",
  scheduleProgram:"",
  startDate:restoredUi.startDate || "",
  endDate:restoredUi.endDate || "",
  activeTab:["overview","explore","imports"].includes(restoredUi.activeTab) ? restoredUi.activeTab : "overview",
  exploreView:restoredUi.exploreView || "audio-programs"
};
let busyDepth = 0;

function persistUiState() {
  try {
    sessionStorage.setItem(UI_STATE_KEY,JSON.stringify({
      activeTab:state.activeTab,
      startDate:state.startDate,
      endDate:state.endDate,
      exploreView:state.exploreView
    }));
  } catch {
    // Session persistence is convenience state, not analytics data.
  }
}

function selectedRange() {
  return { startDate:state.startDate, endDate:state.endDate };
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

function renderTrendControlButtons() {
  els.trendMetricButtons.innerHTML = TREND_METRICS.map((item) =>
    `<button type="button" class="filter-button ${item.priority === "diagnostic" ? "diagnostic" : ""}" data-trend-metric="${escapeHtml(item.key)}" aria-pressed="${item.key === state.trendMetric}">${escapeHtml(item.label)}</button>`
  ).join("");
  els.trendWeekpartButtons.innerHTML = WEEKPARTS.map(([key,label]) =>
    `<button type="button" class="filter-button" data-weekpart="${key}" aria-pressed="${key === state.trendWeekpart}">${label}</button>`
  ).join("");
  els.trendNotableButtons.innerHTML = NOTABLE_MODES.map(([key,label]) =>
    `<button type="button" class="filter-button" data-holiday-mode="${key}" aria-pressed="${key === state.trendNotable}">${label}</button>`
  ).join("");
}

function refreshTrendControlState() {
  els.trendMetricButtons.querySelectorAll("[data-trend-metric]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.trendMetric === state.trendMetric));
  });
  els.trendWeekpartButtons.querySelectorAll("[data-weekpart]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.weekpart === state.trendWeekpart));
  });
  els.trendNotableButtons.querySelectorAll("[data-holiday-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.holidayMode === state.trendNotable));
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
  if (state.trendProgram && names.includes(state.trendProgram)) els.trendProgramSelect.value = state.trendProgram;
  else state.trendProgram = "";
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
  "audio.downloads","audio.users","audio.downloads_per_user",
  "npr_one.localized_listeners","npr_one.average_minutes"
];

async function openDateDrilldown(point, metricKey, medianValue) {
  const date = point.date;
  const holiday = notableDateContext(date);
  openDetailDialog(formatDayDate(date), '<p class="empty-state">Loading the day’s context…</p>');
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
      const dayEntries = buildDailySchedule(scheduleResult.entries).get(date) || [];
      scheduleHtml = dayEntries.length
        ? `<div class="schedule-list">${dayEntries.map((entry) => `<div class="schedule-item"><span>${escapeHtml(scheduleTime(entry.start))}–${escapeHtml(scheduleTime(entry.end))}</span><strong>${escapeHtml(entry.program)}</strong></div>`).join("")}</div>`
        : '<p class="panel-note">No schedule entries were returned for this date.</p>';
    } catch (error) {
      scheduleHtml = `<p class="panel-note">Schedule lookup unavailable: ${escapeHtml(error.message)}</p>`;
    }

    const channelRows = observations.filter((row) => row.metric_key === "website.sessions_by_channel" && row.dimension_type === "traffic_channel");
    const playerRows = observations.filter((row) => row.metric_key === "audio.downloads_by_player" && row.dimension_type === "player");

    els.detailDialogBody.innerHTML = `
      <div class="detail-summary">
        <div><span>Selected metric</span><strong>${selected ? escapeHtml(formatMetric(selected.station_value,selected.unit)) : escapeHtml(point.value)}</strong></div>
        <div><span>Vs selected-range median</span><strong>${escapeHtml(signedPercent(delta))}</strong></div>
        <div><span>Calendar context</span><strong>${holiday ? escapeHtml(`${holiday.name} (${holiday.delta === 0 ? "holiday" : `${Math.abs(holiday.delta)} day${Math.abs(holiday.delta) === 1 ? "" : "s"} ${holiday.delta < 0 ? "before" : "after"}`})`) : "No major holiday within ±3 days"}</strong></div>
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
        ${metricKey.startsWith("streaming.") ? '<p class="source-limit">We have daily live-stream totals here, not listener counts by hour or by program. When you add hourly/sub-hourly streaming data, this panel can show the actual audience curve underneath the schedule.</p>' : ""}
      </section>
      ${channelRows.length ? '<section class="detail-section"><h3>Website traffic sources that day</h3><div id="detailChannelBars"></div></section>' : ""}
      ${playerRows.length ? '<section class="detail-section"><h3>Audio players that day</h3><div id="detailPlayerBars"></div></section>' : ""}
    `;
    if (channelRows.length) renderBarChart(document.getElementById("detailChannelBars"), channelRows.sort((a,b)=>Number(b.station_value)-Number(a.station_value)).slice(0,8).map((row)=>({label:row.dimension_value,value:row.station_value})));
    if (playerRows.length) renderBarChart(document.getElementById("detailPlayerBars"), playerRows.sort((a,b)=>Number(b.station_value)-Number(a.station_value)).slice(0,8).map((row)=>({label:row.dimension_value,value:row.station_value})));
  } catch (error) {
    els.detailDialogBody.innerHTML = `<p class="empty-state">Could not load this drilldown: ${escapeHtml(error.message)}</p>`;
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
  "website-channels": {
    title: "Website sessions by traffic channel",
    metric: "website.sessions_by_channel",
    dimension: "traffic_channel",
    description: "Shows how visitors reached wnmufm.org: direct, search, social, referral, newsletters and other channels. Use it to evaluate acquisition, not just raw pageviews."
  },
  "website-countries": {
    title: "Website sessions by country",
    metric: "website.sessions_by_country",
    dimension: "country",
    description: "Geographic website traffic helps distinguish service-area use from unusual outside traffic. Geography is a clue, not proof that traffic is invalid."
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
}

function setAuthenticated(isAuthenticated) {
  els.startupPanel.hidden = true;
  els.authPanel.hidden = isAuthenticated;
  els.appPanel.hidden = !isAuthenticated;
  els.logoutButton.hidden = !isAuthenticated;
  els.printButton.hidden = !isAuthenticated;
  els.userBadge.hidden = !isAuthenticated;
}

function showLoginMessage(message, success = false) {
  els.loginMessage.textContent = message || "";
  els.loginMessage.style.color = success ? "var(--success)" : "var(--danger)";
}

async function establishAccess() {
  const session = await getSession().catch(() => null);
  if (!session?.access_token) {
    setAuthenticated(false);
    return false;
  }
  const role = await fetchRole();
  if (!role) {
    await signOut().catch(() => null);
    showLoginMessage("This account is valid, but it has not been assigned WNMU-FM Analytics access.");
    setAuthenticated(false);
    return false;
  }
  state.role = role;
  const user = currentUser();
  els.userBadge.textContent = role.display_name || user?.email || "Signed in";
  setAuthenticated(true);
  return true;
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
  const metricKey = state.trendMetric;
  const grain = els.trendGrain.value;
  const label = trendMetricLabel(metricKey);
  const programCapable = metricKey === "audio.downloads" || metricKey === "audio.users";
  els.trendWeekpartControls.hidden = grain !== "day";
  els.trendNotableControls.hidden = grain !== "day";
  els.trendProgramControl.hidden = !programCapable;
  refreshTrendControlState();

  const selectedProgram = programCapable ? state.trendProgram : "";
  const filterSignature = selectedProgram ? JSON.stringify({ selected_program:selectedProgram }) : "{}";
  els.trendTitle.textContent = selectedProgram ? `${label}: ${selectedProgram}` : label;
  const filterNotes = [];
  if (grain === "day" && state.trendWeekpart !== "all") filterNotes.push(WEEKPARTS.find(([key]) => key === state.trendWeekpart)?.[1]);
  if (grain === "day" && state.trendNotable !== "all") filterNotes.push(NOTABLE_MODES.find(([key]) => key === state.trendNotable)?.[1]);
  if (selectedProgram) filterNotes.push(`Program: ${selectedProgram}`);
  els.trendDescription.textContent = `${METRIC_DESCRIPTIONS[metricKey] || ""}${filterNotes.length ? ` Showing ${filterNotes.join(" · ")}.` : ""}`;

  const rows = await loadTimeSeries(metricKey, grain, filterSignature);
  const filteredRows = grain === "day"
    ? rows.filter((row) => matchesWeekpart(row.period_start,state.trendWeekpart) && matchesNotableDateMode(row.period_start,state.trendNotable))
    : rows;
  const numericValues = filteredRows.map((row)=>row.station_value).filter((value)=>value !== null && Number.isFinite(Number(value)));
  const medianValue = median(numericValues);
  const latest = [...filteredRows].reverse().find((row)=>row.station_value !== null);
  els.trendMedianSummary.innerHTML = medianValue === null ? "" :
    `<span><strong>Median:</strong> ${escapeHtml(formatMetric(medianValue,filteredRows[0]?.unit))}</span>` +
    (latest ? `<span><strong>Latest vs median:</strong> ${escapeHtml(signedPercent(percentFromMedian(latest.station_value,medianValue)))}</span>` : "") +
    `<span><strong>Observations:</strong> ${numericValues.length}</span>`;

  const points = filteredRows.filter((row) => row.station_value !== null).map((row) => ({
    date: row.period_start,
    label: formatPeriod(row,grain),
    shortLabel: grain === "day" ? shortDayLabel(row.period_start) : grain === "week" ? `Wk ${shortDayLabel(row.period_start)}` : formatPeriod(row,grain),
    value: Number(row.station_value),
    weekend: grain === "day" && isWeekendDate(row.period_start)
  }));
  renderLineChart(els.trendChart,points,{
    title:label,
    ariaLabel:`${label} by ${grain}`,
    grain,
    median:medianValue,
    onPointClick: grain === "day" ? (point) => openDateDrilldown(point,metricKey,medianValue) : null
  });

  if (!filteredRows.length) {
    els.trendTable.innerHTML = "";
    return;
  }
  els.trendTable.innerHTML = `<table class="trend-data-table">
    <thead><tr><th>Period</th><th class="numeric">WNMU-FM</th><th class="numeric">Vs median</th><th class="numeric">Benchmark</th></tr></thead>
    <tbody>${filteredRows.map((row) => {
      const delta = medianValue === null ? null : percentFromMedian(row.station_value,medianValue);
      const holiday = grain === "day" ? notableDateContext(row.period_start) : null;
      return `<tr${rowClass(row,grain)}><td>${escapeHtml(formatPeriod(row,grain))}${holiday ? ` <span class="holiday-tag">${escapeHtml(holiday.name)}</span>` : ""}</td><td class="numeric">${escapeHtml(formatMetric(row.station_value,row.unit))}</td><td class="numeric">${escapeHtml(signedPercent(delta))}</td><td class="numeric">${row.benchmark_value === null ? "—" : escapeHtml(formatMetric(row.benchmark_value,row.unit))}</td></tr>`;
    }).join("")}</tbody>
  </table>`;
}

function sortBreakdown(rows) {
  return [...rows].sort((a, b) => Number(b.station_value || 0) - Number(a.station_value || 0));
}

function titlesForHour(entries,day,hour) {
  const startMinute = hour * 60;
  const endMinute = startMinute + 60;
  const seen = new Set();
  return entries.filter((entry) => {
    const date = new Date(`${entry.date}T12:00:00Z`);
    if (date.getUTCDay() !== day) return false;
    const [sh,sm] = String(entry.start || "00:00").split(":").map(Number);
    const [eh,em] = String(entry.end || entry.start || "00:00").split(":").map(Number);
    const start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end <= start) end += 1440;
    return start < endMinute && end > startMinute;
  }).map((entry)=>entry.program).filter((name)=>name && !seen.has(name) && seen.add(name)).sort((a,b)=>a.localeCompare(b));
}

function programLines(names) {
  const filtered = state.scheduleProgram ? names.filter((name)=>name === state.scheduleProgram) : names;
  return filtered.length ? filtered.map((name)=>`<span class="program-line">${escapeHtml(name)}</span>`).join("") : '<span class="program-line muted">—</span>';
}

async function renderListeningByHour(hours) {
  if (!hours.length) {
    els.nprHourTable.innerHTML = '<p class="empty-state">No NPR One hour-of-day data is available.</p>';
    return;
  }
  const periodStart=hours[0].period_start;
  const periodEnd=hours[0].period_end;
  const byKey=new Map(hours.map((row)=>[row.dimension_value,row]));
  let entries=[];
  let scheduleNote="";
  try {
    const result=await fetchComposerSchedule(periodStart,periodEnd);
    entries=result.entries;
    scheduleNote=result.sourceType==="recurrences"
      ? "Program titles use the normal recurring WNMU-FM Composer schedule; one-off substitutions may differ."
      : "Program titles use dated Composer episodes for this report period.";
  } catch(error) {
    scheduleNote=`Schedule lookup unavailable: ${error.message}`;
  }

  const names=[...new Set(entries.map((entry)=>entry.program).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const previous=state.scheduleProgram;
  els.scheduleProgramFilter.innerHTML='<option value="">All programs</option>'+names.map((name)=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if(previous && names.includes(previous)) els.scheduleProgramFilter.value=previous; else state.scheduleProgram="";

  els.nprHourDescription.innerHTML=`NPR One gives a <strong>weekday average</strong> and a <strong>weekend average</strong> for each clock hour, not seven separate daily audience counts. The table therefore breaks the <em>schedule</em> out by day while keeping the audience number at the source's actual weekday/weekend level. ${escapeHtml(scheduleNote)}`;

  const weekdayRows=[];
  const weekendRows=[];
  for(let hour=0;hour<24;hour+=1){
    const key=String(hour).padStart(2,"0");
    const weekday=byKey.get(`weekday|${key}`);
    const weekend=byKey.get(`weekend|${key}`);
    const dayTitles=[0,1,2,3,4,5,6].map((day)=>titlesForHour(entries,day,hour));
    const matchesWeekday=!state.scheduleProgram || [1,2,3,4,5].some((day)=>dayTitles[day].includes(state.scheduleProgram));
    const matchesWeekend=!state.scheduleProgram || [6,0].some((day)=>dayTitles[day].includes(state.scheduleProgram));
    if(matchesWeekday) weekdayRows.push(`<tr><td>${escapeHtml(hourLabel(hour))}</td><td class="hour-average">${weekday ? escapeHtml(formatMetric(weekday.station_value,weekday.unit)) : "—"}</td><td>${programLines(dayTitles[1])}</td><td>${programLines(dayTitles[2])}</td><td>${programLines(dayTitles[3])}</td><td>${programLines(dayTitles[4])}</td><td>${programLines(dayTitles[5])}</td></tr>`);
    if(matchesWeekend) weekendRows.push(`<tr><td>${escapeHtml(hourLabel(hour))}</td><td class="hour-average">${weekend ? escapeHtml(formatMetric(weekend.station_value,weekend.unit)) : "—"}</td><td>${programLines(dayTitles[6])}</td><td>${programLines(dayTitles[0])}</td></tr>`);
  }
  els.nprHourTable.innerHTML=`
    <section class="hour-section"><h4>Monday–Friday schedule against weekday hourly average</h4><div class="table-wrap"><table class="hour-table weekday-hour-table"><thead><tr><th>Hour</th><th>Weekday<br>avg.</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th></tr></thead><tbody>${weekdayRows.join("") || '<tr><td colspan="7">No hours match this program filter.</td></tr>'}</tbody></table></div></section>
    <section class="hour-section"><h4>Weekend schedule against weekend hourly average</h4><div class="table-wrap"><table class="hour-table weekend-hour-table"><thead><tr><th>Hour</th><th>Weekend<br>avg.</th><th>Saturday</th><th>Sunday</th></tr></thead><tbody>${weekendRows.join("") || '<tr><td colspan="4">No hours match this program filter.</td></tr>'}</tbody></table></div></section>`;
}

async function renderStreamingWeekpart() {
  const rows=await loadTimeSeries("streaming.listeners","day");
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
  const [programs, devices, channels, hours] = await Promise.all([
    loadLatestBreakdown("audio.downloads_by_program", "program"),
    loadLatestBreakdown("streaming.device_share_pct", "device"),
    loadLatestBreakdown("website.sessions_by_channel", "traffic_channel"),
    loadLatestBreakdown("npr_one.average_hourly_listeners", "hour_weekpart")
  ]);
  renderBarChart(els.programBars, sortBreakdown(programs).map((row) => ({ label: row.dimension_value, value: row.station_value, formattedValue:formatMetric(row.station_value,row.unit) })), { limit: 12, onBarClick:(row)=>openBreakdownDrilldown("On-demand downloads",row,programs[0] ? formatPeriod(programs[0],programs[0].grain) : "") });
  renderBarChart(els.deviceBars, sortBreakdown(devices).map((row) => ({ label: row.dimension_value, value: row.station_value, formattedValue:`${Number(row.station_value).toFixed(1)}%` })), {
    maxValue: 100,
    formatValue: (value) => `${Number(value).toFixed(1)}%`,
    onBarClick:(row)=>openBreakdownDrilldown("Live-stream device share",row,devices[0] ? formatPeriod(devices[0],devices[0].grain) : "")
  });
  renderBarChart(els.channelBars, sortBreakdown(channels).map((row) => ({ label: row.dimension_value, value: row.station_value, formattedValue:formatMetric(row.station_value,row.unit) })), { limit: 8, onBarClick:(row)=>openBreakdownDrilldown("Website sessions",row,channels[0] ? formatPeriod(channels[0],channels[0].grain) : "") });
  await Promise.all([renderListeningByHour(hours),renderStreamingWeekpart()]);
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
    station_website:"Website",
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
    ${[...grouped.values()].map((group) => `<tr><td>${escapeHtml(labels[group.type] || group.type)}</td><td>${escapeHtml([...group.grains].sort().join(", "))}</td><td>${escapeHtml(group.start ? `${formatDayDate(group.start)} – ${formatDayDate(group.end)}` : "Raw only")}</td><td>${escapeHtml(group.run ? `Before ${formatDayDate(group.run)}` : "Unknown")}</td><td class="numeric">${group.count}</td></tr>`).join("")}
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
  return `<span class="collection-status ${fullYear ? "good" : "partial"}">${fullYear ? "Year+" : "Short"} · ${escapeHtml(formatDayDate(span.start, { year:false }))} – ${escapeHtml(formatDayDate(span.end, { year:false }))}</span>`;
}

async function renderCollectionChecklist() {
  const imports = await loadImports();
  const rows = [
    { type:"station_streaming", label:"Live streaming", next:"Full-year Day is loaded. Next get full-year Week and Month exports; hourly/daypart data remains the key program-analysis gap." },
    { type:"station_website", label:"Website", next:"Daily year is loaded. Next get full-year Week and Month exports so unique-user comparisons are source-valid." },
    { type:"audio_downloads", label:"On-demand audio", next:"Daily year is loaded. Next get full-year Week and Month exports, then longer drilldowns for every available program." },
    { type:"npr_one", label:"NPR One", next:"Daily year is loaded. Next get full-year Week and Month exports." }
  ];

  const programs = [...new Set(imports.filter((item) => item.report_type === "audio_program_drilldown" && item.selected_program).map((item) => item.selected_program))].sort();

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
      <p><strong>Content-first gaps:</strong></p>
      <ul>
        <li><strong>Live-stream hour/daypart data:</strong> needed before we can honestly connect live listening to scheduled programs.</li>
        <li><strong>Program drilldowns:</strong> currently only ${programs.length} program buckets are represented (${escapeHtml(programs.join(", ") || "none")}). Get the longest available drilldown for every selectable discrete program.</li>
        <li><strong>Website content detail:</strong> page/landing-page/referrer exports are needed to learn which stories and topics actually attract people.</li>
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
      return `<tr><td>${escapeHtml(new Date(item.imported_at).toLocaleString())}</td><td>${escapeHtml(item.report_type)}</td><td>${escapeHtml(item.grain)}</td><td>${escapeHtml(item.report_start ? `${formatDayDate(item.report_start)} – ${formatDayDate(item.report_end)}` : "Raw only")}</td><td>${escapeHtml(item.report_run_date ? formatDayDate(item.report_run_date) : "Unknown")}</td><td>${escapeHtml(filter)}</td><td class="numeric">${item.row_count}</td><td>${escapeHtml(item.status)}</td></tr>`;
    }).join("")}
  </tbody></table>`;
}

async function renderExplore() {
  const view = EXPLORE_VIEWS[els.exploreView.value] || EXPLORE_VIEWS["audio-programs"];
  els.exploreDescription.textContent = view.description;
  const rows = await loadLatestBreakdown(view.metric, view.dimension);
  if (!rows.length) {
    els.explorePeriod.textContent = "";
    els.exploreChart.innerHTML = '<p class="empty-state">No complete data is available for this exploration yet.</p>';
    els.exploreTable.innerHTML = "";
    return;
  }
  els.explorePeriod.textContent = `${formatPeriod(rows[0], rows[0].grain)}${rows[0].analysis_tail_incomplete ? " · includes report-run day" : ""}`;
  const sorted = sortBreakdown(rows);
  const isPercent = rows[0].unit === "percent";
  renderBarChart(els.exploreChart, sorted.map((row) => ({ label: row.dimension_value, value: row.station_value })), {
    maxValue: isPercent ? 100 : undefined,
    formatValue: (value) => formatMetric(value, rows[0].unit),
    limit: 25
  });
  els.exploreTable.innerHTML = `<table><thead><tr><th>Category</th><th class="numeric">WNMU-FM</th><th class="numeric">Benchmark</th></tr></thead><tbody>
    ${sorted.map((row) => `<tr><td>${escapeHtml(row.dimension_value)}</td><td class="numeric">${escapeHtml(formatMetric(row.station_value,row.unit))}</td><td class="numeric">${row.benchmark_value === null ? "—" : escapeHtml(formatMetric(row.benchmark_value,row.unit))}</td></tr>`).join("")}
  </tbody></table>`;
}

async function refreshDashboard() {
  if (state.loading) return;
  state.loading = true;
  setBusy(true);
  els.refreshButton.disabled = true;
  try {
    await Promise.all([renderSummary(), renderTrend(), renderBreakdowns(), renderAnomalies(), renderCoverage(), renderImportHistory(), renderCollectionChecklist(), renderExplore()]);
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
  const files = [...fileList].filter((file) => file.name.toLowerCase().endsWith(".zip"));
  if (!files.length) return;
  const userEmail = currentUser()?.email || null;
  const filters = filterContext();
  let importedCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;
  let observationCount = 0;
  let anomalyCount = 0;

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
          row.querySelector(".status").textContent = `${result.inspected.reportLabel} · ${result.inspected.normalized.range.grain}${program} · ${result.normalizedCount} observations · ${result.anomalyCount} flags`;
        }
      } catch (error) {
        errorCount += 1;
        console.error(error);
        row.classList.add("error");
        row.querySelector(".status").textContent = error.message;
      }
    }
    invalidateDataCache();
    await renderProgramFilterOptions();
    await refreshDashboard();
  });

  els.fileInput.value = "";
  if (importedCount > 0) {
    const reportWord = importedCount === 1 ? "report" : "reports";
    const observationWord = observationCount === 1 ? "observation" : "observations";
    const messages = [
      `<p><strong>Data added to the app.</strong></p>`,
      `<p>${importedCount} ${reportWord} imported with ${observationCount.toLocaleString()} ${observationWord}. The dashboard has been refreshed.</p>`,
      anomalyCount ? `<p>${anomalyCount} data-quality ${anomalyCount === 1 ? "flag was" : "flags were"} created for review.</p>` : "",
      duplicateCount ? `<p>${duplicateCount} ${duplicateCount === 1 ? "file was" : "files were"} already imported.</p>` : "",
      errorCount ? `<p>${errorCount} ${errorCount === 1 ? "file could not" : "files could not"} be imported. See the import queue for details.</p>` : ""
    ].join("");
    openDetailDialog("Import complete", messages, "NPR Analytics");
  } else if (duplicateCount > 0 && errorCount === 0) {
    openDetailDialog(
      "Already imported",
      `<p>No new data was added because ${duplicateCount === 1 ? "this report is" : "these reports are"} already in the app.</p>`,
      "NPR Analytics"
    );
  } else if (errorCount > 0) {
    openDetailDialog(
      "Import not completed",
      `<p>No new data was added. See the import queue for the ${errorCount === 1 ? "error" : "errors"}.</p>`,
      "NPR Analytics"
    );
  }
}

function bindTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
    });
  });
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showLoginMessage("Signing in…", true);
    try {
      await signIn(els.loginEmail.value.trim(), els.loginPassword.value);
      const allowed = await establishAccess();
      if (allowed) {
        els.loginPassword.value = "";
        showLoginMessage("");
        await refreshDashboard();
      }
    } catch (error) {
      showLoginMessage(error.message);
    }
  });

  els.githubLoginButton.addEventListener("click", () => {
    showLoginMessage("Opening GitHub sign in…", true);
    signInWithGitHub();
  });

  els.logoutButton.addEventListener("click", async () => {
    await signOut().catch(() => null);
    state.role = null;
    setAuthenticated(false);
  });

  els.printButton.addEventListener("click", () => window.print());
  els.refreshButton.addEventListener("click", refreshDashboard);
  els.trendMetricButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-trend-metric]");
    if (!button) return;
    state.trendMetric = button.dataset.trendMetric;
    void withBusy(() => renderTrend());
  });
  els.trendWeekpartButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-weekpart]");
    if (!button) return;
    state.trendWeekpart = button.dataset.weekpart;
    void withBusy(() => renderTrend());
  });
  els.trendNotableButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-holiday-mode]");
    if (!button) return;
    state.trendNotable = button.dataset.holidayMode;
    void withBusy(() => renderTrend());
  });
  els.trendProgramSelect.addEventListener("change", () => {
    state.trendProgram = els.trendProgramSelect.value;
    void withBusy(() => renderTrend());
  });
  els.scheduleProgramFilter.addEventListener("change", () => {
    state.scheduleProgram = els.scheduleProgramFilter.value;
    void withBusy(() => renderBreakdowns());
  });
  els.detailDialogClose.addEventListener("click", () => els.detailDialog.close());
  els.trendGrain.addEventListener("change", () => void withBusy(() => renderTrend()));
  els.exploreView.addEventListener("change", () => void withBusy(() => renderExplore()));

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
      await Promise.all([renderAnomalies(), renderSummary(), renderTrend()]);
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
    bindTabs();
    bindEvents();
    try {
      await consumeOAuthCallback();
    } catch (error) {
      showLoginMessage(error.message);
    }
    const authenticated = await establishAccess();
    if (authenticated) {
      await renderProgramFilterOptions();
      await refreshDashboard();
    }
    setInterval(checkVersion, 5 * 60 * 1000);
  } finally {
    setBusy(false);
  }
}

boot();

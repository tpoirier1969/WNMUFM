import { APP_VERSION } from "./version.js";
import { consumeOAuthCallback, currentUser, fetchRole, getSession, signIn, signInWithGitHub, signOut, updateRows } from "./api.js";
import { invalidateDataCache, loadImports, loadLatestBreakdown, loadLatestValues, loadOpenAnomalies, loadTimeSeries } from "./data.js";
import { importExport } from "./importer.js";
import { renderBarChart, renderLineChart, formatMetric } from "./charts.js";
import { formatDayDate, formatPeriod, isWeekendDate, shortDayLabel } from "./analysis.js";
import { buildHourSchedule, fetchComposerSchedule, hourLabel } from "./schedule.js";
import { CONFIG } from "./config.js";

const els = Object.fromEntries([
  "authPanel","appPanel","loginForm","loginEmail","loginPassword","loginMessage","githubLoginButton","userBadge","logoutButton","printButton",
  "refreshButton","summaryCards","trendMetric","trendGrain","trendTitle","trendDescription","trendChart","trendTable","programBars",
  "deviceBars","channelBars","nprHourTable","nprHourDescription","anomalyCount","anomalyList","coverageTable","dropZone","fileInput",
  "filterName","filterValue","importQueue","importHistory","versionBadge","exploreView","exploreDescription","explorePeriod","exploreChart","exploreTable"
].map((id) => [id, document.getElementById(id)]));

const state = { role: null, loading: false };

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
    <div class="metric-sub">${row ? escapeHtml(formatPeriod(row, "day")) : "No complete imported day yet"}</div>
  </article>`;
}

async function renderSummary() {
  const values = await loadLatestValues([
    "streaming.listeners",
    "streaming.listener_hours",
    "website.active_users",
    "audio.downloads",
    "npr_one.localized_listeners"
  ], "day");
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
  const metricKey = els.trendMetric.value;
  const grain = els.trendGrain.value;
  const label = els.trendMetric.selectedOptions[0]?.textContent || metricKey;
  els.trendTitle.textContent = label;
  els.trendDescription.textContent = METRIC_DESCRIPTIONS[metricKey] || "";
  const rows = await loadTimeSeries(metricKey, grain);
  const points = rows.filter((row) => row.station_value !== null).map((row) => ({
    label: formatPeriod(row, grain),
    shortLabel: grain === "day" ? shortDayLabel(row.period_start) : grain === "week" ? `Wk ${shortDayLabel(row.period_start)}` : formatPeriod(row, grain),
    value: Number(row.station_value),
    weekend: grain === "day" && isWeekendDate(row.period_start)
  }));
  renderLineChart(els.trendChart, points, { title: label, ariaLabel: `${label} by ${grain}` });
  if (!rows.length) {
    els.trendTable.innerHTML = "";
    return;
  }
  els.trendTable.innerHTML = `<table>
    <thead><tr><th>Period</th><th class="numeric">WNMU-FM</th><th class="numeric">Benchmark</th></tr></thead>
    <tbody>${rows.map((row) => `<tr${rowClass(row, grain)}><td>${escapeHtml(formatPeriod(row, grain))}</td><td class="numeric">${escapeHtml(formatMetric(row.station_value,row.unit))}</td><td class="numeric">${row.benchmark_value === null ? "—" : escapeHtml(formatMetric(row.benchmark_value,row.unit))}</td></tr>`).join("")}</tbody>
  </table>`;
}

function sortBreakdown(rows) {
  return [...rows].sort((a, b) => Number(b.station_value || 0) - Number(a.station_value || 0));
}

async function renderListeningByHour(hours) {
  if (!hours.length) {
    els.nprHourTable.innerHTML = '<p class="empty-state">No NPR One hour-of-day data is available.</p>';
    return;
  }
  const periodStart = hours[0].period_start;
  const periodEnd = hours[0].period_end;
  const byKey = new Map(hours.map((row) => [row.dimension_value, row]));
  let schedule = new Map();
  let scheduleNote = "";

  try {
    const entries = await fetchComposerSchedule(periodStart, periodEnd);
    schedule = buildHourSchedule(entries);
    scheduleNote = `Program names are cross-referenced to NPR Composer for ${formatDayDate(periodStart)} through ${formatDayDate(periodEnd)}.`;
  } catch (error) {
    scheduleNote = `The NPR One figures are valid, but automatic Composer schedule lookup is currently unavailable in this browser: ${error.message}`;
  }

  els.nprHourDescription.innerHTML = `NPR One does <strong>not</strong> provide individual dates for this breakdown. It reports an average for each clock hour across weekdays and weekends during ${escapeHtml(formatDayDate(periodStart))} through ${escapeHtml(formatDayDate(periodEnd))}. The table is therefore ordered by time of day, not by audience size. ${escapeHtml(scheduleNote)} <a href="${escapeHtml(CONFIG.stationScheduleUrl)}" target="_blank" rel="noreferrer">Open the WNMU-FM schedule</a>.`;

  const rows = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const key = String(hour).padStart(2, "0");
    const weekday = byKey.get(`weekday|${key}`);
    const weekend = byKey.get(`weekend|${key}`);
    rows.push(`<tr>
      <td>${escapeHtml(hourLabel(hour))}</td>
      <td class="numeric">${weekday ? escapeHtml(formatMetric(weekday.station_value, weekday.unit)) : "—"}</td>
      <td>${escapeHtml(schedule.get(`weekday|${key}`) || "Schedule lookup unavailable")}</td>
      <td class="numeric">${weekend ? escapeHtml(formatMetric(weekend.station_value, weekend.unit)) : "—"}</td>
      <td>${escapeHtml(schedule.get(`weekend|${key}`) || "Schedule lookup unavailable")}</td>
    </tr>`);
  }
  els.nprHourTable.innerHTML = `<table class="hour-table">
    <thead><tr><th>Hour</th><th class="numeric">Weekday avg.</th><th>Programs scheduled on weekdays</th><th class="numeric">Weekend avg.</th><th>Programs scheduled on weekends</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

async function renderBreakdowns() {
  const [programs, devices, channels, hours] = await Promise.all([
    loadLatestBreakdown("audio.downloads_by_program", "program"),
    loadLatestBreakdown("streaming.device_share_pct", "device"),
    loadLatestBreakdown("website.sessions_by_channel", "traffic_channel"),
    loadLatestBreakdown("npr_one.average_hourly_listeners", "hour_weekpart")
  ]);
  renderBarChart(els.programBars, sortBreakdown(programs).map((row) => ({ label: row.dimension_value, value: row.station_value })), { limit: 12 });
  renderBarChart(els.deviceBars, sortBreakdown(devices).map((row) => ({ label: row.dimension_value, value: row.station_value })), {
    maxValue: 100,
    formatValue: (value) => `${Number(value).toFixed(1)}%`
  });
  renderBarChart(els.channelBars, sortBreakdown(channels).map((row) => ({ label: row.dimension_value, value: row.station_value })), { limit: 8 });
  await renderListeningByHour(hours);
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
  els.explorePeriod.textContent = formatPeriod(rows[0], rows[0].grain);
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
  els.refreshButton.disabled = true;
  try {
    await Promise.all([renderSummary(), renderTrend(), renderBreakdowns(), renderAnomalies(), renderCoverage(), renderImportHistory(), renderExplore()]);
  } catch (error) {
    console.error(error);
    els.summaryCards.innerHTML = `<p class="empty-state">Could not load analytics: ${escapeHtml(error.message)}</p>`;
  } finally {
    state.loading = false;
    els.refreshButton.disabled = false;
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

  for (const file of files) {
    const row = queueRow(file, "Inspecting…");
    try {
      const result = await importExport(file, filters, userEmail);
      if (result.duplicate) {
        row.classList.add("success");
        row.querySelector(".status").textContent = "Already imported";
      } else {
        row.classList.add("success");
        const program = result.inspected.selectedProgram ? ` · ${result.inspected.selectedProgram}` : "";
        row.querySelector(".status").textContent = `${result.inspected.reportLabel} · ${result.inspected.normalized.range.grain}${program} · ${result.normalizedCount} observations · ${result.anomalyCount} flags`;
      }
    } catch (error) {
      console.error(error);
      row.classList.add("error");
      row.querySelector(".status").textContent = error.message;
    }
  }
  invalidateDataCache();
  await refreshDashboard();
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
  els.trendMetric.addEventListener("change", renderTrend);
  els.trendGrain.addEventListener("change", renderTrend);
  els.exploreView.addEventListener("change", renderExplore);

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
  els.versionBadge.textContent = `v${APP_VERSION}`;
  bindTabs();
  bindEvents();
  try {
    await consumeOAuthCallback();
  } catch (error) {
    showLoginMessage(error.message);
  }
  const authenticated = await establishAccess();
  if (authenticated) await refreshDashboard();
  setInterval(checkVersion, 5 * 60 * 1000);
}

boot();

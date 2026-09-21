import { APP_VERSION } from "./version.js";
import { currentUser, fetchRole, getSession, signIn, signOut, updateRows } from "./api.js";
import { loadImports, loadLatestBreakdown, loadLatestValues, loadOpenAnomalies, loadTimeSeries } from "./data.js";
import { importExport } from "./importer.js";
import { renderBarChart, renderLineChart, formatMetric } from "./charts.js";

const els = Object.fromEntries([
  "authPanel","appPanel","loginForm","loginEmail","loginPassword","loginMessage","userBadge","logoutButton",
  "refreshButton","summaryCards","trendMetric","trendGrain","trendTitle","trendChart","trendTable","programBars",
  "deviceBars","channelBars","nprHourBars","anomalyCount","anomalyList","coverageTable","dropZone","fileInput",
  "filterName","filterValue","importQueue","importHistory","versionBadge"
].map((id) => [id, document.getElementById(id)]));

const state = { role: null, loading: false };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric", timeZone:"UTC" });
}

function shortDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month:"short", day:"numeric", timeZone:"UTC" });
}

function rangeText(row) {
  if (!row?.period_start) return "No dated data";
  return row.period_start === row.period_end ? formatDate(row.period_start) : `${formatDate(row.period_start)} – ${formatDate(row.period_end)}`;
}

function setAuthenticated(isAuthenticated) {
  els.authPanel.hidden = isAuthenticated;
  els.appPanel.hidden = !isAuthenticated;
  els.logoutButton.hidden = !isAuthenticated;
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
    <div class="metric-sub">${row ? escapeHtml(rangeText(row)) : "No imported data yet"}</div>
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

async function renderTrend() {
  const metricKey = els.trendMetric.value;
  const grain = els.trendGrain.value;
  const label = els.trendMetric.selectedOptions[0]?.textContent || metricKey;
  els.trendTitle.textContent = label;
  const rows = await loadTimeSeries(metricKey, grain);
  const points = rows.filter((row) => row.station_value !== null).map((row) => ({
    label: rangeText(row),
    shortLabel: shortDate(row.period_start),
    value: Number(row.station_value)
  }));
  renderLineChart(els.trendChart, points, { title: label, ariaLabel: `${label} by ${grain}` });
  if (!rows.length) {
    els.trendTable.innerHTML = "";
    return;
  }
  els.trendTable.innerHTML = `<table>
    <thead><tr><th>Period</th><th class="numeric">WNMU-FM</th><th class="numeric">Benchmark</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${escapeHtml(rangeText(row))}</td><td class="numeric">${escapeHtml(formatMetric(row.station_value,row.unit))}</td><td class="numeric">${row.benchmark_value === null ? "—" : escapeHtml(formatMetric(row.benchmark_value,row.unit))}</td></tr>`).join("")}</tbody>
  </table>`;
}

async function renderBreakdowns() {
  const [programs, devices, channels, hours] = await Promise.all([
    loadLatestBreakdown("audio.downloads_by_program", "program"),
    loadLatestBreakdown("streaming.device_share_pct", "device"),
    loadLatestBreakdown("website.sessions_by_channel", "traffic_channel"),
    loadLatestBreakdown("npr_one.average_hourly_listeners", "hour_weekpart")
  ]);
  renderBarChart(els.programBars, programs.map((row) => ({ label: row.dimension_value, value: row.station_value })), { limit: 12 });
  renderBarChart(els.deviceBars, devices.map((row) => ({ label: row.dimension_value, value: row.station_value })), { formatValue: (value) => `${Number(value).toFixed(1)}%` });
  renderBarChart(els.channelBars, channels.map((row) => ({ label: row.dimension_value, value: row.station_value })), { limit: 8 });
  renderBarChart(els.nprHourBars, hours.map((row) => ({ label: row.dimension_value.replace("|"," "), value: row.station_value })), { limit: 24 });
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
    if (!grouped.has(key)) grouped.set(key, { type:key, grains:new Set(), start:null, end:null, count:0 });
    const group = grouped.get(key);
    group.grains.add(item.grain);
    group.count += 1;
    if (item.report_start && (!group.start || item.report_start < group.start)) group.start = item.report_start;
    if (item.report_end && (!group.end || item.report_end > group.end)) group.end = item.report_end;
  });
  els.coverageTable.innerHTML = `<table><thead><tr><th>Report</th><th>Grains</th><th>Coverage</th><th class="numeric">Imports</th></tr></thead><tbody>
    ${[...grouped.values()].map((group) => `<tr><td>${escapeHtml(labels[group.type] || group.type)}</td><td>${escapeHtml([...group.grains].sort().join(", "))}</td><td>${escapeHtml(group.start ? `${formatDate(group.start)} – ${formatDate(group.end)}` : "Raw only")}</td><td class="numeric">${group.count}</td></tr>`).join("")}
  </tbody></table>`;
}

async function renderImportHistory() {
  const imports = await loadImports();
  if (!imports.length) {
    els.importHistory.innerHTML = '<p class="empty-state">Nothing imported yet.</p>';
    return;
  }
  els.importHistory.innerHTML = `<table><thead><tr><th>Imported</th><th>Report</th><th>View</th><th>Coverage</th><th>Program/filter</th><th class="numeric">Rows</th><th>Status</th></tr></thead><tbody>
    ${imports.map((item) => {
      const filter = item.selected_program || Object.entries(item.filter_context || {}).map(([key,value]) => `${key}=${value}`).join(", ") || "Unfiltered";
      return `<tr><td>${escapeHtml(new Date(item.imported_at).toLocaleString())}</td><td>${escapeHtml(item.report_type)}</td><td>${escapeHtml(item.grain)}</td><td>${escapeHtml(item.report_start ? `${formatDate(item.report_start)} – ${formatDate(item.report_end)}` : "Raw only")}</td><td>${escapeHtml(filter)}</td><td class="numeric">${item.row_count}</td><td>${escapeHtml(item.status)}</td></tr>`;
    }).join("")}
  </tbody></table>`;
}

async function refreshDashboard() {
  if (state.loading) return;
  state.loading = true;
  els.refreshButton.disabled = true;
  try {
    await Promise.all([renderSummary(), renderTrend(), renderBreakdowns(), renderAnomalies(), renderCoverage(), renderImportHistory()]);
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

  els.logoutButton.addEventListener("click", async () => {
    await signOut().catch(() => null);
    state.role = null;
    setAuthenticated(false);
  });

  els.refreshButton.addEventListener("click", refreshDashboard);
  els.trendMetric.addEventListener("change", renderTrend);
  els.trendGrain.addEventListener("change", renderTrend);

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
      await renderAnomalies();
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
  const authenticated = await establishAccess();
  if (authenticated) await refreshDashboard();
  setInterval(checkVersion, 5 * 60 * 1000);
}

boot();

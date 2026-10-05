import test from "node:test";
import assert from "node:assert/strict";
import { buildViewSearch, parseViewState, validIsoDate } from "../src/view-state.js";

test("shareable view state round-trips through the query string", () => {
  const original = {
    activeTab:"explore",
    startDate:"2025-09-12",
    endDate:"2026-09-20",
    rangeMode:"custom",
    trendMetrics:["streaming.listeners","streaming.listener_hours"],
    trendMode:"timeofday",
    trendHour:"08",
    trendProfileCompare:"month",
    trendDaySeries:["weekday","mon"],
    trendGrain:"week",
    trendWeekpart:"weekend",
    trendNotable:"exclude",
    trendProgram:"Classical Music",
    trendZoomStart:"2026-01-01",
    trendZoomEnd:"2026-03-31",
    exploreView:"website-channels",
    takeawayCategory:"website",
    scheduleView:"week",
    scheduleDate:"2023-10-03",
    scheduleTime:"20:00",
    scheduleWindowStart:"18"
  };

  const search = buildViewSearch(original);
  const parsed = parseViewState(search);
  assert.deepEqual(parsed, original);
});

test("Trend Explorer time-of-day mode is shareable and wired to StreamGuys hourly data", async () => {
  const search=buildViewSearch({
    activeTab:"overview",
    trendMode:"timeofday",
    trendHour:"07",
    startDate:"2025-09-01",
    endDate:"2026-09-01"
  });
  assert.equal(parseViewState(search).trendMode,"timeofday");
  assert.equal(parseViewState(search).trendHour,"07");

  const fs=await import("node:fs/promises");
  const app=await fs.readFile(new URL("../src/app.js",import.meta.url),"utf8");
  const html=await fs.readFile(new URL("../index.html",import.meta.url),"utf8");
  assert.match(html,/data-trend-view="day"/);
  assert.match(html,/data-trend-view="week"/);
  assert.match(html,/data-trend-view="month"/);
  assert.match(html,/data-trend-view="timeofday"/);
  assert.match(app,/renderTimeOfDayTrend/);
  assert.match(app,/loadStreamGuysHourly\(selectedRange\(\)\)/);
  assert.match(app,/StreamGuys TLH by time of day/);
  assert.match(html,/Hour focus/);
  assert.match(html,/id="trendQuickRangeButtons"/);
  assert.match(html,/Analysis period/);
  assert.match(app,/trace that hour across time/);
});

test("Time-of-Day profile controls expose day series, schedule-aware drilldown and episode detail", async () => {
  const fs=await import("node:fs/promises");
  const [app,html]=await Promise.all([
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../index.html",import.meta.url),"utf8")
  ]);
  assert.match(html,/id="trendProfileCompareSelect"/);
  assert.match(html,/id="trendAudioDetailButton"/);
  assert.match(app,/buildDayComparisonSeries/);
  assert.match(app,/conciseScheduleContext/);
  assert.match(app,/profilePointTooltip/);
  assert.match(app,/drillIntoTimeOfDayPoint/);
  assert.match(app,/audio-episodes/);
  assert.match(app,/loadLatestBreakdownForImportScope/);
});

test("shareable view parsing distinguishes absent values from explicit empty values", () => {
  const parsed = parseViewState("?program=&tab=overview");
  assert.equal(parsed.trendProgram, "");
  assert.equal(parsed.activeTab, "overview");
  assert.equal(parsed.startDate, undefined);
});

test("shareable view query encodes spaces and punctuation safely", () => {
  const search = buildViewSearch({
    activeTab:"overview",
    trendProgram:"Ask Me Another: UP Edition",
    trendMetrics:["audio.downloads"]
  });
  assert.equal(search,"?tab=overview&metrics=audio.downloads&program=Ask+Me+Another%3A+UP+Edition");
  assert.equal(parseViewState(search).trendProgram,"Ask Me Another: UP Edition");
});

test("app exposes a copy-view control and initializes full state after password sign-in", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html,/id="copyViewButton"/);
  const loginStart = app.indexOf('els.loginForm.addEventListener');
  const loginEnd = app.indexOf('els.githubLoginButton.addEventListener');
  const loginHandler = app.slice(loginStart, loginEnd);
  assert.ok(loginHandler.includes("await syncAvailableDataRange();"));
  assert.ok(loginHandler.includes("await renderProgramFilterOptions();"));
  assert.ok(loginHandler.includes("await refreshDashboard();"));
  assert.ok(app.includes("buildViewSearch(viewStateSnapshot())"));
});


test("GitHub sign-in preserves shared state before leaving the app", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app,/githubLoginButton\.addEventListener[\s\S]*persistUiState\(\);[\s\S]*signInWithGitHub\(\);/);
});


test("date-range edits do not refresh on intermediate date-part changes", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app,/rangeInputs\.forEach[\s\S]*addEventListener\("input",markRangeEdit\)/);
  assert.match(app,/addEventListener\("blur",commitRangeAfterLeavingControls\)/);
  assert.match(app,/event\.key !== "Enter"/);
  assert.match(app,/if\(rangeInputs\.includes\(document\.activeElement\)\) return;/);
  assert.doesNotMatch(app,/globalStartDate\.addEventListener\("change"/);
  assert.doesNotMatch(app,/globalEndDate\.addEventListener\("change"/);
});


test("obsolete separate Listening by Hour source-range UI is removed", async () => {
  const fs = await import("node:fs/promises");
  const [app,html] = await Promise.all([
    fs.readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../index.html", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(app,/renderListeningByHour|renderListeningHourContext|Source range notice/);
  assert.doesNotMatch(html,/id="listeningHourPanel"|id="nprHourChart"|id="scheduleProgramFilter"/);
});


test("shared links explicitly clear stale program and zoom state", () => {
  const search=buildViewSearch({
    activeTab:"overview",
    trendProgram:"",
    trendZoomStart:"",
    trendZoomEnd:""
  });
  assert.match(search,/program=/);
  assert.match(search,/zoomStart=/);
  assert.match(search,/zoomEnd=/);
  const parsed=parseViewState(search);
  assert.equal(parsed.trendProgram,"");
  assert.equal(parsed.trendZoomStart,"");
  assert.equal(parsed.trendZoomEnd,"");
});

test("shared date validation rejects impossible calendar dates", () => {
  assert.equal(validIsoDate("2026-02-28"),"2026-02-28");
  assert.equal(validIsoDate("2026-02-31"),"");
  assert.equal(validIsoDate("2026-99-15"),"");
  assert.equal(validIsoDate("not-a-date"),"");
});

test("range presets and toolbar actions cancel or flush pending manual edits", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app,/cancelRangeCommitTimer\(\);\s*rangeEditPending=false;\s*state\.startDate=button\.dataset\.start/s);
  assert.match(app,/printButton\.addEventListener\("click", async \(\) => \{\s*const stored=storePendingRangeEdit\(\)/s);
  assert.match(app,/copyViewButton\.addEventListener\("click", \(\) => \{\s*const stored=storePendingRangeEdit\(\)/s);
  assert.match(app,/if\(rangeEditPending\) commitRangeEdit\(\);/);
  assert.doesNotMatch(app,/event\.preventDefault\(\);\s*rangeEditPending=true;\s*commitRangeEdit\(\);/s);
});


test("new app sessions default to the latest 13 months while preserving explicit range state", async () => {
  const fs=await import("node:fs/promises");
  const app=await fs.readFile(new URL("../src/app.js",import.meta.url),"utf8");
  assert.match(app,/\["all","custom","recent13"\]/);
  assert.match(app,/\? "custom" : "recent13"/);
  assert.match(app,/defaultRecentRange\(next,13\)/);
  assert.match(app,/data-range-preset.*last-13m|rangePreset === "last-13m"/s);
});


test("schedule view state can be shared independently from the audience Analysis Range", () => {
  const search=buildViewSearch({
    activeTab:"schedule",
    startDate:"2025-09-12",
    endDate:"2026-09-20",
    scheduleView:"day",
    scheduleDate:"2023-10-03",
    scheduleTime:"20:00",
    scheduleWindowStart:"18"
  });
  const parsed=parseViewState(search);
  assert.equal(parsed.activeTab,"schedule");
  assert.equal(parsed.scheduleDate,"2023-10-03");
  assert.equal(parsed.startDate,"2025-09-12");
  assert.equal(parsed.endDate,"2026-09-20");
});

test("Trend Explorer workflow keeps incompatible controls visible but disabled", async () => {
  const fs=await import("node:fs/promises");
  const app=await fs.readFile(new URL("../src/app.js",import.meta.url),"utf8");
  const html=await fs.readFile(new URL("../index.html",import.meta.url),"utf8");
  assert.match(html,/Days included/);
  assert.match(html,/Special dates/);
  assert.match(html,/What to measure/);
  assert.match(app,/setTrendControlAvailability/);
  assert.match(app,/Time of day currently uses StreamGuys TLH/);
  assert.match(app,/Days included is available for Day and Time of day views/);
});

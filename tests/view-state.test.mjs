import test from "node:test";
import assert from "node:assert/strict";
import { buildViewSearch, parseViewState } from "../src/view-state.js";

test("shareable view state round-trips through the query string", () => {
  const original = {
    activeTab:"explore",
    startDate:"2025-09-12",
    endDate:"2026-09-20",
    rangeMode:"custom",
    trendMetrics:["streaming.listeners","streaming.listener_hours"],
    trendGrain:"week",
    trendWeekpart:"weekend",
    trendNotable:"exclude",
    trendProgram:"Classical Music",
    trendZoomStart:"2026-01-01",
    trendZoomEnd:"2026-03-31",
    exploreView:"website-channels"
  };

  const search = buildViewSearch(original);
  const parsed = parseViewState(search);
  assert.deepEqual(parsed, original);
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


test("source-range mismatch stays inline and never opens the detail modal", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app,/Source range notice/);
  assert.match(app,/this graph remains on the NPR source period/);
  assert.doesNotMatch(app,/rangeNoticeArmed/);
  assert.doesNotMatch(app,/Listening by Hour uses a different source period/);
});

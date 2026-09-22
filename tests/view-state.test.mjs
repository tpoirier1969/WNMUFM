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
  assert.match(search,/program=Ask+Me+Another%3A+UP+Edition/);
  assert.equal(parseViewState(search).trendProgram,"Ask Me Another: UP Edition");
});

test("app exposes a copy-view control and initializes full state after password sign-in", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html,/id="copyViewButton"/);
  assert.match(app,/await syncAvailableDataRange();s*await renderProgramFilterOptions();s*await refreshDashboard();/s);
  assert.match(app,/buildViewSearch(viewStateSnapshot())/);
});

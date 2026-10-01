import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};

const { exactEpisodeCoverage } = await import("../src/schedule-client.js");

test("exact Composer coverage is complete only when every requested date is represented", () => {
  const coverage=exactEpisodeCoverage([
    {date:"2026-09-01"},
    {date:"2026-09-02"},
    {date:"2026-09-03"}
  ],"2026-09-01","2026-09-03");

  assert.equal(coverage.complete,true);
  assert.equal(coverage.coverageStart,"2026-09-01");
  assert.equal(coverage.coverageEnd,"2026-09-03");
  assert.equal(coverage.coveredDays,3);
  assert.deepEqual(coverage.missingDates,[]);
});

test("partial Composer episode responses are not presented as complete historical coverage", () => {
  const coverage=exactEpisodeCoverage([
    {date:"2026-09-01"},
    {date:"2026-09-03"}
  ],"2026-09-01","2026-09-03");

  assert.equal(coverage.complete,false);
  assert.equal(coverage.coveredDays,2);
  assert.deepEqual(coverage.missingDates,["2026-09-02"]);
});

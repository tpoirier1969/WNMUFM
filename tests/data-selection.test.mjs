import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};

const { selectAvailableObservationRange, selectLongestBreakdownRows } = await import("../src/data.js");

test("range profiles prefer the longest available source period", () => {
  const rows = [
    { source_import_id:9, period_start:"2026-08-23", period_end:"2026-09-21", dimension_value:"weekday|08" },
    { source_import_id:9, period_start:"2026-08-23", period_end:"2026-09-21", dimension_value:"weekend|08" },
    { source_import_id:17, period_start:"2025-09-22", period_end:"2026-09-21", dimension_value:"weekday|08" },
    { source_import_id:17, period_start:"2025-09-22", period_end:"2026-09-21", dimension_value:"weekend|08" }
  ];
  const selected = selectLongestBreakdownRows(rows);
  assert.equal(selected.length, 2);
  assert.ok(selected.every((row) => row.source_import_id === 17));
});

test("available analysis range uses earliest and latest usable observation dates", () => {
  const range=selectAvailableObservationRange([
    {period_start:"2025-09-12",period_end:"2025-09-12",station_value:10},
    {period_start:"2026-09-20",period_end:"2026-09-20",station_value:20},
    {period_start:"2026-09-21",period_end:"2026-09-21",station_value:null}
  ]);
  assert.deepEqual(range,{startDate:"2025-09-12",endDate:"2026-09-20"});
});


test("Trend Explorer distinguishes global Analysis Range from metric/grain source coverage", async () => {
  const fs=await import("node:fs/promises");
  const [app,data]=await Promise.all([
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../src/data.js",import.meta.url),"utf8")
  ]);
  assert.match(data,/export async function loadTimeSeriesRange/);
  assert.match(app,/loadTimeSeriesRange\(metricKey,grain,filterSignature\)/);
  assert.match(app,/Source coverage for/);
  assert.match(app,/Source coverage at/);
  assert.match(app,/No imported source coverage is available/);
});

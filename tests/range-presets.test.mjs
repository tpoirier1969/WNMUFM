import test from "node:test";
import assert from "node:assert/strict";
import { buildRangePresets } from "../src/range-presets.js";

test("Trend Explorer quick ranges anchor to the latest imported date", () => {
  const presets=buildRangePresets({startDate:"2025-09-12",endDate:"2026-09-20"});
  const byKey=new Map(presets.map((item)=>[item.key,item]));

  assert.deepEqual(
    {startDate:byKey.get("full").startDate,endDate:byKey.get("full").endDate},
    {startDate:"2025-09-12",endDate:"2026-09-20"}
  );
  assert.deepEqual(
    {startDate:byKey.get("last-3m").startDate,endDate:byKey.get("last-3m").endDate},
    {startDate:"2026-06-21",endDate:"2026-09-20"}
  );
  assert.deepEqual(
    {startDate:byKey.get("this-year").startDate,endDate:byKey.get("this-year").endDate},
    {startDate:"2026-01-01",endDate:"2026-09-20"}
  );
  assert.deepEqual(
    {startDate:byKey.get("last-year").startDate,endDate:byKey.get("last-year").endDate},
    {startDate:"2025-09-12",endDate:"2025-12-31"}
  );
});

test("season shortcuts use meteorological seasons and clip to imported coverage", () => {
  const presets=buildRangePresets({startDate:"2025-09-12",endDate:"2026-09-20"});
  const byKey=new Map(presets.map((item)=>[item.key,item]));
  assert.deepEqual(
    {startDate:byKey.get("winter").startDate,endDate:byKey.get("winter").endDate},
    {startDate:"2025-12-01",endDate:"2026-02-28"}
  );
  assert.deepEqual(
    {startDate:byKey.get("spring").startDate,endDate:byKey.get("spring").endDate},
    {startDate:"2026-03-01",endDate:"2026-05-31"}
  );
  assert.deepEqual(
    {startDate:byKey.get("summer").startDate,endDate:byKey.get("summer").endDate},
    {startDate:"2026-06-01",endDate:"2026-08-31"}
  );
  assert.deepEqual(
    {startDate:byKey.get("fall").startDate,endDate:byKey.get("fall").endDate},
    {startDate:"2026-09-01",endDate:"2026-09-20"}
  );
});

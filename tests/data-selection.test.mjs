import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};

const { selectLongestBreakdownRows } = await import("../src/data.js");

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

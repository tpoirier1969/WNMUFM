import test from "node:test";
import assert from "node:assert/strict";
import { matchesWeekpart } from "../src/analysis.js";

test("week-part filters distinguish weekdays, weekends and named days", () => {
  assert.equal(matchesWeekpart("2026-09-21", "weekday"), true);
  assert.equal(matchesWeekpart("2026-09-21", "weekend"), false);
  assert.equal(matchesWeekpart("2026-09-20", "weekend"), true);
  assert.equal(matchesWeekpart("2026-09-20", "sun"), true);
  assert.equal(matchesWeekpart("2026-09-20", "sat"), false);
});

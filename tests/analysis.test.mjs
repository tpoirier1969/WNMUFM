import test from "node:test";
import assert from "node:assert/strict";
import { formatPeriod, isWeekendDate, periodIsComplete, shortDayLabel, shortMonthLabel, periodWithinRange } from "../src/analysis.js";

test("run-day and later periods are not treated as complete", () => {
  assert.equal(periodIsComplete("2026-09-20", "2026-09-21"), true);
  assert.equal(periodIsComplete("2026-09-21", "2026-09-21"), false);
  assert.equal(periodIsComplete("2026-09-26", "2026-09-21"), false);
});

test("weekend detection uses the actual calendar", () => {
  assert.equal(isWeekendDate("2026-09-19"), true);
  assert.equal(isWeekendDate("2026-09-20"), true);
  assert.equal(isWeekendDate("2026-09-21"), false);
});

test("daily labels include weekday", () => {
  assert.match(shortDayLabel("2026-09-21"), /^Mon /);
  assert.match(formatPeriod({ period_start:"2026-09-21", period_end:"2026-09-21" }, "day"), /^Mon,/);
});

test("compact chart date labels always include a two-digit year", () => {
  assert.equal(shortDayLabel("2026-09-21"), "Mon 9/21/26");
  assert.equal(shortMonthLabel("2026-09-01"), "Sep '26");
});

test("period range matching requires the complete source period to fit", () => {
  const row={period_start:"2026-09-07",period_end:"2026-09-13"};
  assert.equal(periodWithinRange(row,"2026-09-01","2026-09-30"),true);
  assert.equal(periodWithinRange(row,"2026-09-10","2026-09-30"),false);
});

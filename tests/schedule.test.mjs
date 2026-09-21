import test from "node:test";
import assert from "node:assert/strict";
import { buildHourSchedule, normalizeComposerEpisodes } from "../src/schedule.js";

test("Composer episode normalization accepts nested program and airtime objects", () => {
  const rows = normalizeComposerEpisodes([{
    program: { name:"Morning Edition" },
    airtime: [{ date:"2026-09-21", start:"06:00", end:"09:00" }]
  }]);
  assert.deepEqual(rows, [{ date:"2026-09-21", start:"06:00", end:"09:00", program:"Morning Edition" }]);
});

test("hour schedule keeps chronological buckets and groups weekday programs", () => {
  const schedule = buildHourSchedule([
    { date:"2026-09-21", start:"06:00", end:"09:00", program:"Morning Edition" },
    { date:"2026-09-22", start:"06:00", end:"09:00", program:"Morning Edition" },
    { date:"2026-09-19", start:"16:00", end:"17:00", program:"The Shuffle" }
  ]);
  assert.match(schedule.get("weekday|07"), /Morning Edition/);
  assert.match(schedule.get("weekend|16"), /The Shuffle/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { notableDateContext, notableDatesForYear } from "../src/notable-dates.js";

test("2026 federal Election Day is identified as notable context", () => {
  const election=notableDatesForYear(2026).find((item)=>item.kind==="election");
  assert.equal(election.date.toISOString().slice(0,10),"2026-11-03");
  assert.equal(notableDateContext("2026-11-03")?.name,"Federal Election Day");
});

test("major 2026 civic addresses are exact-date context", () => {
  assert.equal(notableDateContext("2026-02-24")?.name,"State of the Union");
  assert.equal(notableDateContext("2026-02-25")?.name,"Michigan State of the State");
  assert.notEqual(notableDateContext("2026-02-23")?.name,"State of the Union");
});

test("verified Michigan election dates are tagged without implying schedule changes", () => {
  assert.equal(notableDateContext("2025-11-04")?.name,"Michigan local election day");
  assert.equal(notableDateContext("2026-08-04")?.name,"Michigan primary election");
});

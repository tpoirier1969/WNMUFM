import test from "node:test";
import assert from "node:assert/strict";
import { normalizeComposerPrograms } from "../src/schedule.js";

test("Composer recurring programs expand into dated weekly airtimes", () => {
  const rows = normalizeComposerPrograms([{
    name:"The Shuffle",
    recurrences:[{days:"Saturday",start:"16:00",end:"17:00"},{days:"Monday",start:"14:00",end:"15:00"}]
  }], "2026-09-14", "2026-09-20");
  assert.deepEqual(rows, [
    {date:"2026-09-14",start:"14:00",end:"15:00",program:"The Shuffle",genre:""},
    {date:"2026-09-19",start:"16:00",end:"17:00",program:"The Shuffle",genre:""}
  ]);
});


test("Composer recurrence effective dates prevent stale historical schedules from overlapping current airtimes", () => {
  const rows=normalizeComposerPrograms([
    {
      name:"Old Saturday Show",
      recurrences:[{days:"Saturday",start_time:"20:00",end_time:"22:00",start_date:"2024-01-06",end_date:"2025-12-27",no_end_date:false}]
    },
    {
      name:"New Saturday Show",
      recurrences:[{days:"Saturday",start_time:"20:00",end_time:"22:00",start_date:"2026-01-03",no_end_date:true}]
    }
  ],"2025-12-20","2026-01-10");

  assert.deepEqual(rows,[
    {date:"2025-12-20",start:"20:00",end:"22:00",program:"Old Saturday Show",genre:""},
    {date:"2025-12-27",start:"20:00",end:"22:00",program:"Old Saturday Show",genre:""},
    {date:"2026-01-03",start:"20:00",end:"22:00",program:"New Saturday Show",genre:""},
    {date:"2026-01-10",start:"20:00",end:"22:00",program:"New Saturday Show",genre:""}
  ]);
});

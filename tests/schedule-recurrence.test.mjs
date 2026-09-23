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

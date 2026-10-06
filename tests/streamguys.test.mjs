import test from "node:test";
import assert from "node:assert/strict";
import { inspectStreamGuysCsvText, looksLikeStreamGuysCsvText, STREAMGUYS_PARSER_VERSION } from "../src/streamguys.js";

test("StreamGuys TLH by Day exports are recognized and normalized as hourly day facts", () => {
  const text=[
    "Day,TLH,hour_of_day_local",
    "2026-09-28,17:30:00,05:00",
    "2026-09-29,0:30:00,05:00"
  ].join("\n");
  assert.equal(looksLikeStreamGuysCsvText(text),true);
  const result=inspectStreamGuysCsvText(text,{fileName:"TLH by Day 05.csv",stationKey:"wnmu_fm"});
  assert.equal(result.parserVersion,STREAMGUYS_PARSER_VERSION);
  assert.deepEqual(result.normalized.range,{grain:"day",start:"2026-09-28",end:"2026-09-29"});
  assert.equal(result.normalized.observations.length,2);
  assert.equal(result.normalized.observations[0].station_value,17.5);
  assert.equal(result.normalized.observations[0].dimension_value,"05:00");
  assert.equal(result.normalized.observations[0].filter_signature,"source=StreamGuys;hour_of_day_local=05:00");
  assert.equal(result.filterContext.hour_of_day_local,"05:00");
});

test("StreamGuys importer preserves multiple source hours when a CSV contains them", () => {
  const text=[
    "Day,TLH,hour_of_day_local",
    "2026-09-28,01:00:00,05:00",
    "2026-09-28,02:30:00,06:00"
  ].join("\n");
  const result=inspectStreamGuysCsvText(text);
  assert.equal(result.filterContext.hour_of_day_local,"multiple");
  assert.deepEqual(result.normalized.observations.map((row)=>row.dimension_value),["05:00","06:00"]);
});

test("StreamGuys blank TLH remains missing rather than becoming zero", () => {
  const text=[
    "Day,TLH,hour_of_day_local",
    "2026-09-28,,05:00",
    "2026-09-29,01:15:00,05:00"
  ].join("\n");
  const result=inspectStreamGuysCsvText(text);
  assert.equal(result.normalized.observations.length,1);
  assert.equal(result.normalized.observations[0].station_value,1.25);
  assert.match(result.note,/blank TLH row/);
});

test("StreamGuys importer rejects wrong files and duplicate day-hour facts", () => {
  assert.equal(looksLikeStreamGuysCsvText("Date,Users\n2026-09-28,10"),false);
  assert.throws(
    ()=>inspectStreamGuysCsvText("Date,Users\n2026-09-28,10"),
    /must contain Day, TLH, and hour_of_day_local/
  );
  assert.throws(
    ()=>inspectStreamGuysCsvText([
      "Day,TLH,hour_of_day_local",
      "2026-09-28,01:00:00,05:00",
      "2026-09-28,02:00:00,05:00"
    ].join("\n")),
    /more than one TLH row/
  );
});

test("Imports screen exposes a dedicated StreamGuys importer and explicit source websites", async () => {
  const fs=await import("node:fs/promises");
  const [html,app]=await Promise.all([
    fs.readFile(new URL("../index.html",import.meta.url),"utf8"),
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8")
  ]);
  assert.match(html,/id="streamGuysDropZone"/);
  assert.match(html,/portal\.streamguys\.com\/home\/users/);
  assert.match(html,/studio\.npr\.org/);
  assert.match(html,/analytics\.google\.com/);
  assert.match(app,/sourceHint:"streamguys"/);
});

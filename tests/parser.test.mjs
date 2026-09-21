import test from "node:test";
import assert from "node:assert/strict";
import { cleanNumber, durationToSeconds, parseCsv } from "../src/csv.js";
import { detectReport, inferGrain, inferDrilldownProgram, REPORT_TYPES } from "../src/reports.js";

test("CSV parser handles quoted commas and escaped quotes", () => {
  const parsed = parseCsv('Name,Value\n"Smith, Jane","She said ""yes"""\n');
  assert.equal(parsed.rows[0].Name, "Smith, Jane");
  assert.equal(parsed.rows[0].Value, 'She said "yes"');
});

test("number cleanup accepts NPR comma formatting", () => {
  assert.equal(cleanNumber("100,870"), 100870);
  assert.equal(cleanNumber("63.4%"), 63.4);
  assert.equal(cleanNumber(""), null);
});

test("duration parsing supports hh:mm:ss", () => {
  assert.equal(durationToSeconds("01:02:03"), 3723);
});

test("grain inference distinguishes day week and month", () => {
  assert.equal(inferGrain(["2026-09-01","2026-09-02","2026-09-03"]), "day");
  assert.equal(inferGrain(["2026-09-01","2026-09-08","2026-09-15"]), "week");
  assert.equal(inferGrain(["2026-07","2026-08","2026-09"]), "month");
});

test("report recognition uses CSV signatures", () => {
  assert.equal(detectReport(["folder/listeners.csv","folder/total_listener_hours.csv"]), REPORT_TYPES.STREAMING);
  assert.equal(detectReport(["active_users.csv","channels_table.csv"]), REPORT_TYPES.WEBSITE);
  assert.equal(detectReport(["downloads.csv","programs.csv"]), REPORT_TYPES.AUDIO);
  assert.equal(detectReport(["active_npr_one_listeners_(localized_on_mobile_apps).csv"]), REPORT_TYPES.NPR_ONE);
});

test("audio drilldown is recognized before general audio", () => {
  assert.equal(detectReport(["dashboard-audio_downloads_program_drilldown/downloads.csv","dashboard-audio_downloads_program_drilldown/programs.csv"]), REPORT_TYPES.AUDIO_DRILLDOWN);
});

test("drilldown program inference requires a unique total match", () => {
  const files = new Map([
    ["downloads.csv", { rows: [{ Downloads:"3" }, { Downloads:"4" }] }],
    ["programs.csv", { rows: [{ Program_link:"Program A", Downloads:"7" }, { Program_link:"Program B", Downloads:"2" }] }]
  ]);
  assert.deepEqual(inferDrilldownProgram(files), { program:"Program A", confidence:"exact-download-total-match" });

  files.get("programs.csv").rows.push({ Program_link:"Program C", Downloads:"7" });
  assert.equal(inferDrilldownProgram(files).confidence, "ambiguous");
});

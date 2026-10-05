import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};

const { buildObservationExclusionContext, collapseOpenAnomalies, selectAvailableObservationRange, selectLongestBreakdownRows, splitIsoRangeByMonth } = await import("../src/data.js");

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

test("available analysis range uses earliest and latest usable observation dates", () => {
  const range=selectAvailableObservationRange([
    {period_start:"2025-09-12",period_end:"2025-09-12",station_value:10},
    {period_start:"2026-09-20",period_end:"2026-09-20",station_value:20},
    {period_start:"2026-09-21",period_end:"2026-09-21",station_value:null}
  ]);
  assert.deepEqual(range,{startDate:"2025-09-12",endDate:"2026-09-20"});
});


test("Trend Explorer distinguishes global Analysis Range from metric/grain source coverage", async () => {
  const fs=await import("node:fs/promises");
  const [app,data]=await Promise.all([
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../src/data.js",import.meta.url),"utf8")
  ]);
  assert.match(data,/export async function loadTimeSeriesRange/);
  assert.match(app,/loadTimeSeriesRange\(metricKey,grain,filterSignature\)/);
  assert.match(app,/Source coverage for/);
  assert.match(app,/Source coverage at/);
  assert.match(app,/No imported source coverage is available/);
});


test("excluded anomaly periods follow logical source and grain across overlapping imports", () => {
  const context=buildObservationExclusionContext([
    {id:13,report_type:"station_website",grain:"day",selected_program:null,report_run_date:"2026-09-20"},
    {id:18,report_type:"station_website",grain:"day",selected_program:null,report_run_date:"2026-09-20"},
    {id:37,report_type:"station_website",grain:"week",selected_program:null,report_run_date:"2026-09-24"},
    {id:57,report_type:"audio_program_drilldown",grain:"day",selected_program:"Classiclectic",report_run_date:"2026-01-01"},
    {id:66,report_type:"audio_program_drilldown",grain:"day",selected_program:"STATION STORIES",report_run_date:"2026-01-01"}
  ],[
    {import_id:13,grain:"day",evidence:{date:"2026-08-26"}},
    {import_id:57,grain:"day",evidence:{date:"2025-11-17"}}
  ]);

  assert.ok(context.excludedDatesBySource.get("station_website|{}|grain:day").has("2026-08-26"));
  assert.equal(context.sourceKeyByImport.get(18),"station_website");
  assert.equal(context.sourceGrainKeyByImport.get(18),"station_website|{}|grain:day");
  assert.equal(context.excludedDatesBySource.has("station_website|{}|grain:week"),false);
  assert.ok(context.excludedDatesBySource.get('audio_program_drilldown|{"selected_program":"Classiclectic"}|grain:day').has("2025-11-17"));
  assert.equal(context.excludedDatesBySource.has('audio_program_drilldown|{"selected_program":"STATION STORIES"}|grain:day'),false);
});

test("newsletter dated overrides are selected by their actual date, not only the newsletter issue month", async () => {
  const fs=await import("node:fs/promises");
  const data=await fs.readFile(new URL("../src/data.js",import.meta.url),"utf8");
  const start=data.indexOf("export async function loadNewsletterScheduleEvidence");
  const end=data.indexOf("function importSourceKey",start);
  const body=data.slice(start,end);
  assert.match(body,/entry_type:"eq\.dated_override"/);
  assert.match(body,/specific_date",`gte\.\$\{range\.startDate\}`/);
  assert.match(body,/specific_date",`lte\.\$\{range\.endDate\}`/);
  assert.match(body,/missingSourceIds/);
  assert.match(body,/selectPagedRows\("wnmufm_schedule_newsletter_entries",monthlyParams/);
  assert.match(body,/entries:\[\.\.\.monthlyEntries,\.\.\.datedEntries\]/);
  assert.doesNotMatch(body,/monthSources\.map\(\(source\)=>/);
});


test("StreamGuys hourly ranges split into month-sized chunks for bounded concurrent loading", () => {
  assert.deepEqual(splitIsoRangeByMonth("2025-12-29","2026-02-03"),[
    {startDate:"2025-12-29",endDate:"2025-12-31"},
    {startDate:"2026-01-01",endDate:"2026-01-31"},
    {startDate:"2026-02-01",endDate:"2026-02-03"}
  ]);
  assert.deepEqual(splitIsoRangeByMonth("2026-02-03","2026-02-03"),[
    {startDate:"2026-02-03",endDate:"2026-02-03"}
  ]);
});

test("summary latest values use one multi-metric query instead of one request per card", async () => {
  const fs=await import("node:fs/promises");
  const data=await fs.readFile(new URL("../src/data.js",import.meta.url),"utf8");
  const start=data.indexOf("export async function loadLatestValues");
  const end=data.indexOf("export async function loadDateObservations",start);
  const body=data.slice(start,end);
  assert.match(body,/metric_key: \`in\.\(/);
  assert.doesNotMatch(body,/Promise\.all\(metricKeys\.map/);
  assert.match(body,/latest-values\|/);
});

test("open anomaly rows collapse only when logical key and grain both match", () => {
  const collapsed=collapseOpenAnomalies([
    {
      id:10,
      import_id:1,
      anomaly_key:"website_spike_2026-08-23",
      grain:"day",
      severity:"warning",
      detected_at:"2026-09-21T10:00:00Z",
      title:"Earlier daily flag"
    },
    {
      id:20,
      import_id:2,
      anomaly_key:"website_spike_2026-08-23",
      grain:"day",
      severity:"high",
      detected_at:"2026-09-24T10:00:00Z",
      title:"Later daily flag"
    },
    {
      id:21,
      import_id:37,
      anomaly_key:"website_spike_2026-08-23",
      grain:"week",
      severity:"high",
      detected_at:"2026-09-24T11:00:00Z",
      title:"Weekly flag"
    },
    {
      id:30,
      import_id:3,
      anomaly_key:"bulk_audio_2026-09-14_overview",
      grain:"day",
      severity:"high",
      detected_at:"2026-09-22T10:00:00Z",
      title:"Other event"
    }
  ]);

  assert.equal(collapsed.length,3);
  const dailyWebsite=collapsed.find((item)=>item.anomaly_key==="website_spike_2026-08-23" && item.grain==="day");
  const weeklyWebsite=collapsed.find((item)=>item.anomaly_key==="website_spike_2026-08-23" && item.grain==="week");
  assert.ok(dailyWebsite);
  assert.ok(weeklyWebsite);
  assert.equal(dailyWebsite.occurrenceCount,2);
  assert.equal(dailyWebsite.severity,"high");
  assert.equal(dailyWebsite.id,20);
  assert.equal(weeklyWebsite.occurrenceCount,1);
  assert.equal(weeklyWebsite.id,21);
});

test("anomaly review updates every open row for the logical key and grain only", async () => {
  const fs=await import("node:fs/promises");
  const app=await fs.readFile(new URL("../src/app.js",import.meta.url),"utf8");
  assert.match(app,/data-anomaly-key=/);
  assert.match(app,/data-anomaly-grain=/);
  assert.match(app,/anomaly_key:\`eq\.\$\{anomalyKey\}\`/);
  assert.match(app,/grain:\`eq\.\$\{anomalyGrain\}\`/);
  assert.match(app,/status:"eq\.open"/);
});


test("repeat analytics queries are cached by range until data cache invalidation", async () => {
  const fs=await import("node:fs/promises");
  const data=await fs.readFile(new URL("../src/data.js",import.meta.url),"utf8");
  assert.match(data,/const observationQueryCache = new Map\(\)/);
  assert.match(data,/function cachedQuery\(/);
  assert.match(data,/observationQueryCache\.clear\(\)/);
  assert.match(data,/streamguys-hourly\|\$\{range\?\.startDate/);
  assert.match(data,/time-series\|\$\{metricKey\}\|\$\{grain\}/);
  assert.match(data,/latest-breakdown\|\$\{metricKey\}\|\$\{dimensionType\}/);
});


test("Schedule evidence range comes only from actual stored schedule evidence rows", async () => {
  const fs=await import("node:fs/promises");
  const data=await fs.readFile(new URL("../src/data.js",import.meta.url),"utf8");
  assert.match(data,/export async function loadScheduleEvidenceRange/);
  assert.match(data,/wnmufm_schedule_newsletter_entries/);
  assert.match(data,/entry_type:"eq.monthly_grid"/);
  assert.match(data,/entry_type:"eq.dated_override"/);
  assert.match(data,/wnmufm_schedule_daily_archive/);
  assert.match(data,/schedule-evidence-range/);
});

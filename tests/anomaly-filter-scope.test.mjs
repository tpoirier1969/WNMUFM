import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = globalThis.localStorage || {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};

const { buildObservationExclusionContext } = await import("../src/data.js");

test("excluded anomaly dates stay inside the matching report filter scope", () => {
  const imports=[
    {id:1,report_type:"station_website",grain:"day",filter_context:{device:"mobile"},selected_program:null,report_run_date:"2026-09-01"},
    {id:2,report_type:"station_website",grain:"day",filter_context:{device:"desktop"},selected_program:null,report_run_date:"2026-09-01"},
    {id:3,report_type:"station_website",grain:"day",filter_context:{},selected_program:null,report_run_date:"2026-09-01"}
  ];
  const excluded=[{
    import_id:1,
    grain:"day",
    evidence:{date:"2026-08-23",grain:"day",review_scope:'station_website|{"device":"mobile"}'}
  }];
  const context=buildObservationExclusionContext(imports,excluded);
  const mobileKey=context.sourceGrainKeyByImport.get(1);
  const desktopKey=context.sourceGrainKeyByImport.get(2);
  const baseKey=context.sourceGrainKeyByImport.get(3);
  assert.notEqual(mobileKey,desktopKey);
  assert.notEqual(mobileKey,baseKey);
  assert.equal(context.excludedDatesBySource.get(mobileKey)?.has("2026-08-23"),true);
  assert.equal(context.excludedDatesBySource.get(desktopKey)?.has("2026-08-23") || false,false);
  assert.equal(context.excludedDatesBySource.get(baseKey)?.has("2026-08-23") || false,false);
});

test("legacy exclusions without review_scope inherit their import's exact filter scope", () => {
  const imports=[
    {id:1,report_type:"station_website",grain:"day",filter_context:{device:"mobile"},selected_program:null,report_run_date:"2026-09-01"},
    {id:2,report_type:"station_website",grain:"day",filter_context:{},selected_program:null,report_run_date:"2026-09-01"}
  ];
  const excluded=[{import_id:1,grain:"day",evidence:{date:"2026-08-23",grain:"day"}}];
  const context=buildObservationExclusionContext(imports,excluded);
  assert.equal(context.excludedDatesBySource.get(context.sourceGrainKeyByImport.get(1))?.has("2026-08-23"),true);
  assert.equal(context.excludedDatesBySource.get(context.sourceGrainKeyByImport.get(2))?.has("2026-08-23") || false,false);
});

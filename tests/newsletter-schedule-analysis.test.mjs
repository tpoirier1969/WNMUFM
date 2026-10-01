import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNewsletterScheduleTakeaways, newsletterDuplicatesScheduleChange } from "../src/newsletter-schedule-analysis.js";

function source(id,month,page=8) {
  return {id,source_key:`preview-${month.slice(0,7)}`,issue_month:month,title:`Preview ${month.slice(0,7)}`,schedule_page:page};
}

function grid(sourceId,month,weekday,start,end,title) {
  return {
    source_id:sourceId,
    issue_month:month,
    entry_type:"monthly_grid",
    specific_date:null,
    weekday,
    source_weekday:weekday,
    start_time:start,
    end_time:end,
    program_title:title,
    source_page:8,
    date_scope:"issue_month",
    evidence_basis:"monthly_schedule_grid"
  };
}

test("consecutive monthly grids surface known schedule changes without inventing an exact date", () => {
  const sources=[source(1,"2023-09-01"),source(2,"2023-10-01",9)];
  const entries=[
    grid(1,"2023-09-01",5,"12:00:00","13:00:00","Gateways Radio"),
    grid(2,"2023-10-01",5,"12:00:00","13:00:00","Fiesta!")
  ];
  const findings=analyzeNewsletterScheduleTakeaways({sources,entries});
  assert.equal(findings.length,1);
  assert.equal(findings[0].kind,"newsletter-grid-change");
  assert.match(findings[0].title,/October 2023 grid: Gateways Radio → Fiesta! on Fridays at 12 PM/i);
  assert.match(findings[0].summary,/month-to-month schedule difference, not an exact change date/i);
  assert.equal(findings[0].newsletterEvidence.dateScope,"issue_month");
});

test("nonconsecutive newsletter months are not bridged into an assumed change", () => {
  const sources=[source(1,"2023-09-01"),source(3,"2023-11-01")];
  const entries=[
    grid(1,"2023-09-01",5,"12:00:00","13:00:00","Gateways Radio"),
    grid(3,"2023-11-01",5,"12:00:00","13:00:00","Fiesta!")
  ];
  const findings=analyzeNewsletterScheduleTakeaways({sources,entries});
  assert.equal(findings.length,0);
});

test("monthly streaming movement is attached as context rather than program attribution", () => {
  const sources=[source(1,"2023-09-01"),source(2,"2023-10-01",9)];
  const entries=[
    grid(1,"2023-09-01",6,"20:00:00","21:00:00","Festival Highlights"),
    grid(2,"2023-10-01",6,"20:00:00","21:00:00","Blues Today")
  ];
  const monthlyByMetric={
    "streaming.listeners":[
      {period_start:"2023-09-01",station_value:100,benchmark_value:1000,benchmark_label:"Typical Station"},
      {period_start:"2023-10-01",station_value:120,benchmark_value:1050,benchmark_label:"Typical Station"}
    ],
    "streaming.listener_hours":[
      {period_start:"2023-09-01",station_value:200},
      {period_start:"2023-10-01",station_value:180}
    ]
  };
  const [finding]=analyzeNewsletterScheduleTakeaways({sources,entries,monthlyByMetric});
  assert.match(finding.summary,/live-stream listeners rose 20\.0%/i);
  assert.match(finding.summary,/live-stream listener hours fell 10\.0%/i);
  assert.match(finding.summary,/NPR Typical Station listeners changed \+5\.0%/i);
  assert.match(finding.summary,/month-level context, not program-level attribution/i);
  assert.deepEqual(finding.metricKeys,["streaming.listeners","streaming.listener_hours"]);
});

test("dated listings automatically use daily streaming context when that grain is available", () => {
  const sources=[source(2,"2026-02-01",9)];
  const date="2026-02-10";
  const entries=[{
    source_id:2,
    entry_key:"preview-2026-02:override:2026-02-10:20:00:special",
    issue_month:"2026-02-01",
    entry_type:"dated_override",
    specific_date:date,
    weekday:2,
    source_weekday:2,
    start_time:"20:00:00",
    end_time:"22:00:00",
    program_title:"Special Concert",
    replaces_program_title:"Regular Concert",
    source_page:10,
    date_scope:"specific_date",
    evidence_basis:"explicit_dated_listing"
  }];
  const peerDates=["2026-01-13","2026-01-20","2026-01-27","2026-02-03","2026-02-17","2026-02-24"];
  const dailyByMetric={
    "streaming.listeners":[
      ...peerDates.map((period_start)=>({period_start,station_value:100,benchmark_value:1000,benchmark_label:"Typical Station"})),
      {period_start:date,station_value:140,benchmark_value:1020,benchmark_label:"Typical Station"}
    ]
  };
  const [finding]=analyzeNewsletterScheduleTakeaways({sources,entries,dailyByMetric});
  assert.match(finding.summary,/live-stream listeners were 40\.0% above the median of nearby Tuesdays/i);
  assert.match(finding.summary,/NPR Typical Station was 2\.0% above its nearby Tuesday baseline/i);
  assert.deepEqual(finding.metricKeys,["streaming.listeners"]);
  assert.equal(finding.actionability,90);
});

test("explicit dated newsletter listings stay date-specific", () => {
  const sources=[source(2,"2023-10-01",9)];
  const entries=[{
    source_id:2,
    entry_key:"preview-2023-10:override:2023-10-03:20:00:carnegie",
    issue_month:"2023-10-01",
    entry_type:"dated_override",
    specific_date:"2023-10-03",
    weekday:2,
    source_weekday:2,
    start_time:"20:00:00",
    end_time:"22:00:00",
    program_title:"Carnegie Hall Live",
    replaces_program_title:"Deutche Welle Festival",
    source_page:10,
    date_scope:"specific_date",
    evidence_basis:"explicit_dated_listing"
  }];
  const [finding]=analyzeNewsletterScheduleTakeaways({sources,entries});
  assert.equal(finding.kind,"newsletter-dated-override");
  assert.match(finding.title,/Oct 3, 2023: Carnegie Hall Live replaced Deutche Welle Festival/i);
  assert.equal(finding.sourceStart,"2023-10-03");
  assert.equal(finding.newsletterEvidence.dateScope,"specific_date");
});


test("split and resized newsletter blocks are compared by time coverage", () => {
  const sources=[source(1,"2023-09-01"),source(2,"2023-10-01",9)];
  const entries=[
    grid(1,"2023-09-01",5,"12:00:00","13:00:00","Program A"),
    grid(2,"2023-10-01",5,"12:00:00","12:30:00","Program A"),
    grid(2,"2023-10-01",5,"12:30:00","13:00:00","Program B")
  ];
  const findings=analyzeNewsletterScheduleTakeaways({sources,entries});
  assert.equal(findings.length,1);
  assert.match(findings[0].title,/Program A → Program B on Fridays at 12:30 PM/i);
  assert.equal(findings[0].newsletterEvidence.changes[0].start_time,"12:30:00");
  assert.equal(findings[0].newsletterEvidence.changes[0].end_time,"13:00:00");
});

test("missing streaming measurements stay missing instead of becoming fabricated declines", () => {
  const sources=[source(1,"2023-09-01"),source(2,"2023-10-01",9)];
  const entries=[
    grid(1,"2023-09-01",5,"12:00:00","13:00:00","Program A"),
    grid(2,"2023-10-01",5,"12:00:00","13:00:00","Program B")
  ];
  const monthlyByMetric={
    "streaming.listeners":[
      {period_start:"2023-09-01",station_value:100,benchmark_value:1000,benchmark_label:"Typical Station"},
      {period_start:"2023-10-01",station_value:null,benchmark_value:null,benchmark_label:"Typical Station"}
    ]
  };
  const [finding]=analyzeNewsletterScheduleTakeaways({sources,entries,monthlyByMetric});
  assert.match(finding.summary,/No source-valid monthly streaming comparison is available/i);
  assert.doesNotMatch(finding.summary,/100\.0%/);
});

test("zero audience movement is described as unchanged", () => {
  const sources=[source(1,"2023-09-01"),source(2,"2023-10-01",9)];
  const entries=[
    grid(1,"2023-09-01",5,"12:00:00","13:00:00","Program A"),
    grid(2,"2023-10-01",5,"12:00:00","13:00:00","Program B")
  ];
  const monthlyByMetric={
    "streaming.listeners":[
      {period_start:"2023-09-01",station_value:100,benchmark_value:1000,benchmark_label:"Typical Station"},
      {period_start:"2023-10-01",station_value:100,benchmark_value:1000,benchmark_label:"Typical Station"}
    ]
  };
  const [finding]=analyzeNewsletterScheduleTakeaways({sources,entries,monthlyByMetric});
  assert.match(finding.summary,/live-stream listeners were unchanged \(0\.0%\)/i);
  assert.match(finding.summary,/NPR Typical Station listeners were unchanged \(0\.0%\)/i);
  assert.doesNotMatch(finding.summary,/rose 0\.0%/i);
});

test("newsletter deduplication matches the actual recurring change, not the whole month", () => {
  const sources=[source(1,"2023-09-01"),source(2,"2023-10-01",9)];
  const entries=[
    grid(1,"2023-09-01",5,"12:00:00","13:00:00","Program A"),
    grid(2,"2023-10-01",5,"12:00:00","13:00:00","Program B")
  ];
  const findings=analyzeNewsletterScheduleTakeaways({sources,entries});
  assert.equal(newsletterDuplicatesScheduleChange(findings,{
    effectiveDate:"2023-10-06",
    weekday:5,
    fromProgram:"Program A",
    toProgram:"Program B",
    startSlot:24,
    endSlot:25
  }),true);
  assert.equal(newsletterDuplicatesScheduleChange(findings,{
    effectiveDate:"2023-10-06",
    weekday:5,
    fromProgram:"Different Program",
    toProgram:"Another Program",
    startSlot:24,
    endSlot:25
  }),false);
});


test("dated null measurements remain missing instead of becoming zero-valued audience context", () => {
  const sources=[source(2,"2026-02-01",9)];
  const date="2026-02-10";
  const entries=[{
    source_id:2,
    entry_key:"preview-2026-02:override:2026-02-10:20:00:special-null",
    issue_month:"2026-02-01",
    entry_type:"dated_override",
    specific_date:date,
    weekday:2,
    source_weekday:2,
    start_time:"20:00:00",
    end_time:"22:00:00",
    program_title:"Special Concert",
    replaces_program_title:"Regular Concert",
    source_page:10,
    date_scope:"specific_date",
    evidence_basis:"explicit_dated_listing"
  }];
  const peerDates=["2026-01-13","2026-01-20","2026-01-27","2026-02-03","2026-02-17","2026-02-24"];
  const dailyByMetric={
    "streaming.listeners":[
      ...peerDates.map((period_start)=>({period_start,station_value:100,benchmark_value:1000,benchmark_label:"Typical Station"})),
      {period_start:date,station_value:null,benchmark_value:null,benchmark_label:"Typical Station"}
    ]
  };
  const [finding]=analyzeNewsletterScheduleTakeaways({sources,entries,dailyByMetric});
  assert.match(finding.summary,/No source-valid daily streaming comparison is available/i);
  assert.doesNotMatch(finding.summary,/100\.0%/);
  assert.equal(finding.actionability,80);
});

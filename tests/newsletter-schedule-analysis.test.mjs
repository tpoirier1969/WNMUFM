import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNewsletterScheduleTakeaways } from "../src/newsletter-schedule-analysis.js";

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

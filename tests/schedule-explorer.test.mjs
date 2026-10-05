import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleDay,
  entriesAtTime,
  entriesAtTimeForDay,
  newsletterScheduleForDate,
  renderScheduleDay,
  renderScheduleMonth,
  renderScheduleWeek,
  scheduleViewRange,
  shiftScheduleDate
} from "../src/schedule-explorer.js";

function source(id,month) {
  return {id,issue_month:month,source_key:`preview-${month.slice(0,7)}`};
}

function grid(sourceId,month,weekday,start,end,program) {
  return {
    source_id:sourceId,
    issue_month:month,
    entry_type:"monthly_grid",
    specific_date:null,
    weekday,
    start_time:start,
    end_time:end,
    program_title:program,
    source_page:8
  };
}

function override(sourceId,month,date,weekday,start,end,program,replaces) {
  return {
    source_id:sourceId,
    issue_month:month,
    entry_type:"dated_override",
    specific_date:date,
    weekday,
    start_time:start,
    end_time:end,
    program_title:program,
    replaces_program_title:replaces,
    source_page:10
  };
}

test("schedule view ranges use Sunday-Saturday weeks and full calendar month rows", () => {
  assert.deepEqual(
    scheduleViewRange("week","2026-10-01"),
    {startDate:"2026-09-27",endDate:"2026-10-03",displayStart:"2026-09-27",displayEnd:"2026-10-03"}
  );
  assert.deepEqual(
    scheduleViewRange("month","2026-10-01"),
    {startDate:"2026-09-27",endDate:"2026-10-31",displayStart:"2026-10-01",displayEnd:"2026-10-31"}
  );
  assert.deepEqual(
    scheduleViewRange("day","2026-10-01"),
    {startDate:"2026-10-01",endDate:"2026-10-01",displayStart:"2026-10-01",displayEnd:"2026-10-01"}
  );
});

test("newsletter monthly grids never leak outside their named month", () => {
  const schedule={
    sources:[source(1,"2023-10-01")],
    entries:[grid(1,"2023-10-01",2,"20:00:00","22:00:00","October Program")]
  };
  assert.equal(newsletterScheduleForDate(schedule,"2023-10-03").length,1);
  assert.equal(newsletterScheduleForDate(schedule,"2023-11-07").length,0);
});

test("a dated Preview override replaces the overlapping base grid only on its stated date", () => {
  const schedule={
    sources:[source(1,"2023-10-01")],
    entries:[
      grid(1,"2023-10-01",2,"20:00:00","22:00:00","Regular Concert"),
      override(1,"2023-10-01","2023-10-03",2,"20:00:00","22:00:00","Carnegie Hall Live","Regular Concert")
    ]
  };

  const special=newsletterScheduleForDate(schedule,"2023-10-03");
  assert.deepEqual(special.map((item)=>item.program),["Carnegie Hall Live"]);
  assert.equal(special[0].evidenceKind,"newsletter-dated");
  assert.equal(special[0].exact,true);

  const followingTuesday=newsletterScheduleForDate(schedule,"2023-10-10");
  assert.deepEqual(followingTuesday.map((item)=>item.program),["Regular Concert"]);
  assert.equal(followingTuesday[0].evidenceKind,"newsletter-grid");
  assert.equal(followingTuesday[0].exact,false);
});

test("exact Composer episodes outrank newsletter and archived recurrence evidence", () => {
  const newsletter={
    sources:[source(1,"2026-10-01")],
    entries:[grid(1,"2026-10-01",4,"12:00:00","13:00:00","Preview Program")]
  };
  const composer={
    sourceType:"episodes",
    entries:[{date:"2026-10-01",start:"12:00",end:"13:00",program:"Exact Episode"}]
  };
  const day=buildScheduleDay({date:"2026-10-01",newsletter,composer});
  assert.equal(day.sourceKind,"composer-exact");
  assert.deepEqual(day.entries.map((item)=>item.program),["Exact Episode"]);
});

test("Preview evidence outranks archived Composer recurrence for the same date", () => {
  const newsletter={
    sources:[source(1,"2026-10-01")],
    entries:[grid(1,"2026-10-01",4,"12:00:00","13:00:00","Preview Program")]
  };
  const composer={
    sourceType:"archive_recurrences",
    entries:[{date:"2026-10-01",start:"12:00",end:"13:00",program:"Archived Program"}]
  };
  const day=buildScheduleDay({date:"2026-10-01",newsletter,composer});
  assert.equal(day.sourceKind,"newsletter-grid");
  assert.deepEqual(day.entries.map((item)=>item.program),["Preview Program"]);
});

test("archived Composer recurrence is used when stronger evidence is absent", () => {
  const composer={
    sourceType:"archive_recurrences_partial",
    entries:[{date:"2026-10-01",start:"12:00",end:"13:00",program:"Archived Program"}]
  };
  const day=buildScheduleDay({date:"2026-10-01",newsletter:{sources:[],entries:[]},composer});
  assert.equal(day.sourceKind,"composer-archive");
  assert.deepEqual(day.entries.map((item)=>item.program),["Archived Program"]);
  assert.equal(day.entries[0].exact,false);
});

test("month snapshot matching uses the selected clock time", () => {
  const entries=[
    {start:"11:00",end:"12:00",program:"Morning"},
    {start:"12:00",end:"13:30",program:"Noon"},
    {start:"13:30",end:"14:00",program:"Afternoon"}
  ];
  assert.deepEqual(entriesAtTime(entries,"12:30").map((item)=>item.program),["Noon"]);
  assert.deepEqual(entriesAtTime(entries,"13:30").map((item)=>item.program),["Afternoon"]);
});

test("schedule navigation moves by the active view without inventing dates", () => {
  assert.equal(shiftScheduleDate("2026-10-01","day",-1),"2026-09-30");
  assert.equal(shiftScheduleDate("2026-10-01","week",1),"2026-10-08");
  assert.equal(shiftScheduleDate("2026-01-31","month",1),"2026-02-28");
});


test("Schedule Explorer renderers keep visible years and evidence labels", () => {
  const days=[{
    date:"2026-10-01",
    sourceKind:"composer-exact",
    sourceLabel:"Exact Composer episodes",
    entries:[{
      date:"2026-10-01",
      start:"12:00",
      end:"13:00",
      program:"Midday Program",
      evidenceKind:"composer-exact",
      sourceLabel:"Exact Composer episodes",
      exact:true
    }]
  }];
  assert.match(renderScheduleDay(days[0]),/Oct 1, 2026/);
  assert.match(renderScheduleDay(days[0]),/Exact/);
  assert.match(renderScheduleWeek(days,{windowStart:12}),/Oct 1, 2026/);
  assert.match(renderScheduleMonth(days,{anchorDate:"2026-10-01",time:"12:00"}),/Oct 1, 2026/);
});

test("app exposes Schedule as a top-level module with independent controls", async () => {
  const fs=await import("node:fs/promises");
  const [app,html]=await Promise.all([
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../index.html",import.meta.url),"utf8")
  ]);
  assert.match(html,/data-tab="schedule"/);
  assert.match(html,/data-panel="schedule"/);
  assert.match(html,/id="scheduleAnchorDate"/);
  assert.match(app,/renderScheduleExplorer/);
  assert.match(app,/loadNewsletterScheduleEvidence\(fetchRange\)/);
  assert.match(app,/fetchExactComposerScheduleRange\(fetchRange\.startDate,fetchRange\.endDate/);
});


test("unknown Composer end times do not become 24-hour schedule blocks", () => {
  const entries=[{date:"2026-10-01",start:"10:00",end:"10:00",program:"Unknown Duration"}];
  assert.deepEqual(entriesAtTime(entries,"10:30"),[]);
  assert.deepEqual(entriesAtTime(entries,"23:30"),[]);
});

test("overnight programs carry into the following day's Month and Week slots", () => {
  const days=[
    {
      date:"2026-10-02",
      sourceKind:"composer-exact",
      sourceLabel:"Exact Composer episodes",
      entries:[{date:"2026-10-02",start:"23:30",end:"01:30",program:"Overnight Program",evidenceKind:"composer-exact",sourceLabel:"Exact Composer episodes",exact:true}]
    },
    {
      date:"2026-10-03",
      sourceKind:"composer-exact",
      sourceLabel:"Exact Composer episodes",
      entries:[]
    }
  ];
  assert.deepEqual(entriesAtTimeForDay(days,1,"00:30").map((item)=>item.program),["Overnight Program"]);
  assert.match(renderScheduleWeek(days,{windowStart:0}),/Overnight Program/);
  assert.match(renderScheduleMonth(days,{anchorDate:"2026-10-03",time:"00:30"}),/Overnight Program/);
});

test("dated-only Preview evidence is labeled as dated evidence, not a monthly grid", () => {
  const newsletter={
    sources:[source(1,"2023-09-01")],
    entries:[override(1,"2023-09-01","2023-10-01",0,"15:00:00","16:00:00","Special Program","Regular Program")]
  };
  const day=buildScheduleDay({date:"2023-10-01",newsletter,composer:{sourceType:"none",entries:[]}});
  assert.equal(day.sourceKind,"newsletter-dated");
  assert.equal(day.sourceLabel,"Preview dated listing");
});

test("partial exact Composer results can fall back to archived recurrence evidence per missing day", () => {
  const composer={
    sourceType:"episodes",
    entries:[{date:"2026-10-01",start:"12:00",end:"13:00",program:"Exact Day"}],
    archiveEntries:[{date:"2026-10-02",start:"12:00",end:"13:00",program:"Archive Day"}]
  };
  const day=buildScheduleDay({date:"2026-10-02",newsletter:{sources:[],entries:[]},composer});
  assert.equal(day.sourceKind,"composer-archive");
  assert.deepEqual(day.entries.map((item)=>item.program),["Archive Day"]);
});


test("the first visible Week or Month day can use overnight carry-in from the fetched prior day", () => {
  const carryInDay={
    date:"2026-09-26",
    entries:[{date:"2026-09-26",start:"23:30",end:"01:30",program:"Saturday Overnight",evidenceKind:"composer-exact",sourceLabel:"Exact Composer episodes",exact:true}]
  };
  const visible=[{
    date:"2026-09-27",
    sourceKind:"composer-exact",
    sourceLabel:"Exact Composer episodes",
    entries:[]
  }];
  assert.deepEqual(
    entriesAtTimeForDay(visible,0,"00:30",carryInDay.entries).map((item)=>item.program),
    ["Saturday Overnight"]
  );
  assert.match(renderScheduleWeek(visible,{windowStart:0,carryInDay}),/Saturday Overnight/);
  assert.match(renderScheduleMonth(visible,{anchorDate:"2026-09-27",time:"00:30",carryInDay}),/Saturday Overnight/);
});


test("Schedule month and week views hide dates outside stored evidence bounds", async () => {
  const fs=await import("node:fs/promises");
  const source=await fs.readFile(new URL("../src/schedule-explorer.js",import.meta.url),"utf8");
  assert.match(source,/function dateWithinAvailable/);
  assert.match(source,/availableStart=""\s*,availableEnd=""/);
  assert.match(source,/schedule-month-day outside-evidence/);
  assert.match(source,/schedule-week-table/);
  assert.match(source,/class="outside-evidence"/);
});

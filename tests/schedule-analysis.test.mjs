import test from "node:test";
import assert from "node:assert/strict";
import {
  addScheduleContextToTrendFindings,
  analyzeScheduleTakeaways,
  detectMajorScheduleChanges,
  detectPersistentScheduleChanges
} from "../src/schedule-analysis.js";

function addDays(value,days) {
  const date=new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function weeklyDates(start,count) {
  const dates=[];
  let current=start;
  for(let i=0;i<count;i+=1) {
    dates.push(current);
    current=addDays(current,7);
  }
  return dates;
}

function normalDay(date) {
  return [{date,start:"00:00",end:"23:59",program:"Regular Schedule"}];
}

function changedDay(date) {
  return [
    {date,start:"00:00",end:"12:00",program:"Regular Schedule"},
    {date,start:"12:00",end:"18:00",program:"Special Programming"},
    {date,start:"18:00",end:"23:59",program:"Regular Schedule"}
  ];
}

function saturdaySeriesDay(date,program) {
  return [
    {date,start:"00:00",end:"20:00",program:"Regular Schedule"},
    {date,start:"20:00",end:"22:00",program},
    {date,start:"22:00",end:"23:59",program:"Regular Schedule"}
  ];
}

test("major one-day schedule departures compare a date with nearby same-weekday schedules", () => {
  const dates=weeklyDates("2026-01-05",12);
  const changed=new Set([dates[4],dates[8]]);
  const entries=dates.flatMap((date)=>changed.has(date) ? changedDay(date) : normalDay(date));
  const profile=detectMajorScheduleChanges(entries);
  assert.deepEqual(profile.changes.map((item)=>item.date),[dates[4],dates[8]]);
  assert.ok(profile.changes.every((item)=>item.changedHours===6));
  assert.ok(profile.changes.every((item)=>item.changedFraction>=.2));
});

test("persistent weekly series replacements are detected as recurring schedule changes", () => {
  const dates=weeklyDates("2026-01-03",14);
  const effectiveDate=dates[7];
  const entries=dates.flatMap((date,index)=>
    saturdaySeriesDay(date,index<7 ? "Prairie Home Companion" : "Replacement Show")
  );
  const result=detectPersistentScheduleChanges(entries);
  assert.equal(result.changes.length,1);
  const change=result.changes[0];
  assert.equal(change.effectiveDate,effectiveDate);
  assert.equal(change.weekday,6);
  assert.equal(change.fromProgram,"Prairie Home Companion");
  assert.equal(change.toProgram,"Replacement Show");
  assert.equal(change.changedHours,2);
  assert.equal(change.startTime,"8:00 PM");
  assert.equal(change.endTime,"10:00 PM");
});

test("persistent series changes compare same-weekday daily streaming before and after the schedule change", () => {
  const dates=weeklyDates("2026-01-03",14);
  const effectiveDate=dates[7];
  const entries=dates.flatMap((date,index)=>
    saturdaySeriesDay(date,index<7 ? "Prairie Home Companion" : "Replacement Show")
  );
  const listeners=dates.map((date,index)=>({
    period_start:date,
    period_end:date,
    station_value:index<7 ? 400 : 300,
    benchmark_value:index<7 ? 1000 : 980,
    benchmark_label:"Typical Station",
    unit:"listeners"
  }));
  const hours=dates.map((date,index)=>({
    period_start:date,
    period_end:date,
    station_value:index<7 ? 600 : 420,
    unit:"hours"
  }));

  const result=analyzeScheduleTakeaways({
    entries,
    dailyByMetric:{
      "streaming.listeners":listeners,
      "streaming.listener_hours":hours
    }
  });
  const finding=result.findings.find((item)=>item.kind==="schedule-regime-effect");
  assert.ok(finding);
  assert.match(finding.title,/After Prairie Home Companion was replaced by Replacement Show on Saturdays at 8:00 PM/i);
  assert.match(finding.title,/live-stream listeners fell 25\.0%/i);
  assert.match(finding.summary,/live-stream listener hours fell 30\.0%/i);
  assert.match(finding.summary,/NPR Typical Station Saturdays changed -2\.0%/i);
  assert.match(finding.summary,/association in daily totals, not proof/i);
  assert.deepEqual(finding.metricKeys,["streaming.listeners","streaming.listener_hours"]);
  assert.equal(finding.scheduleChange.effectiveDate,effectiveDate);
});

test("one-day special programming can produce a specific daily audience takeaway", () => {
  const dates=weeklyDates("2026-01-03",12);
  const specialDate=dates[5];
  const entries=dates.flatMap((date)=>date===specialDate ? changedDay(date) : normalDay(date));
  const listeners=dates.map((date)=>({
    period_start:date,
    period_end:date,
    station_value:date===specialDate ? 300 : 400,
    benchmark_value:date===specialDate ? 990 : 1000,
    benchmark_label:"Typical Station",
    unit:"listeners"
  }));

  const result=analyzeScheduleTakeaways({
    entries,
    dailyByMetric:{"streaming.listeners":listeners}
  });
  const finding=result.findings.find((item)=>item.kind==="schedule-special-day");
  assert.ok(finding);
  assert.match(finding.title,/Special programming on Saturday/i);
  assert.match(finding.title,/25\.0% lower live-stream listeners/i);
  assert.match(finding.summary,/Special Programming instead of Regular Schedule/i);
  assert.match(finding.summary,/full day's totals, not an hourly measurement/i);
});

test("small schedule differences do not become major-change Takeaways", () => {
  const dates=weeklyDates("2026-01-05",10);
  const entries=dates.flatMap((date,index)=>index===5 ? [
    {date,start:"00:00",end:"22:00",program:"Regular Schedule"},
    {date,start:"22:00",end:"23:59",program:"Late Special"}
  ] : normalDay(date));
  const result=analyzeScheduleTakeaways({entries,dailyByMetric:{}});
  assert.equal(result.profile.changes.length,0);
  assert.equal(result.findings.length,0);
});

test("monthly NPR trend findings gain persistent FM schedule context", () => {
  const profile={
    changes:[],
    regimeChanges:[{
      weekday:6,
      effectiveDate:"2026-02-07",
      fromProgram:"Prairie Home Companion",
      toProgram:"Replacement Show",
      startTime:"8:00 PM",
      endTime:"10:00 PM",
      changedHours:2,
      startSlot:40,
      endSlot:43
    }]
  };
  const finding={
    id:"benchmark-trend:streaming.listeners:2026-02",
    kind:"benchmark-trend",
    category:"npr-comparison",
    sourceFamily:"streaming",
    periodStart:"2026-02-01",
    periodEnd:"2026-02-28",
    summary:"WNMU-FM rose while NPR fell."
  };
  const enriched=addScheduleContextToTrendFindings([finding],profile)[0];
  assert.ok(enriched.scheduleContext);
  assert.match(enriched.summary,/recurring Saturday change began Feb 7, 2026/i);
  assert.match(enriched.summary,/Prairie Home Companion was replaced by Replacement Show/i);
  assert.match(enriched.summary,/not evidence that the schedule caused the audience movement/i);
});

test("monthly NPR trend findings also gain one-day special-programming context", () => {
  const profile={
    changes:[{
      date:"2026-02-14",
      changedHours:6,
      windows:[{start:"12:00",end:"18:00",actual:["Special Programming"],expected:["Regular Schedule"]}]
    }],
    regimeChanges:[]
  };
  const finding={
    kind:"benchmark-trend",
    sourceFamily:"streaming",
    periodStart:"2026-02-01",
    periodEnd:"2026-02-28",
    summary:"Streaming trend."
  };
  const enriched=addScheduleContextToTrendFindings([finding],profile)[0];
  assert.match(enriched.summary,/major one-day schedule departure/i);
  assert.match(enriched.summary,/Special Programming instead of Regular Schedule/i);
});

test("schedule context is not attached to non-streaming NPR trend findings", () => {
  const profile={
    changes:[{date:"2026-02-10",changedHours:6,windows:[]}],
    regimeChanges:[],
    coverage:{startDate:"2026-02-01",endDate:"2026-02-28",dates:28}
  };
  const finding={
    kind:"benchmark-trend",
    sourceFamily:"website",
    periodStart:"2026-02-01",
    periodEnd:"2026-02-28",
    summary:"Website trend."
  };
  assert.deepEqual(addScheduleContextToTrendFindings([finding],profile),[finding]);
});

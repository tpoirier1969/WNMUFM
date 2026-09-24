import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScheduleTakeaways, detectMajorScheduleChanges } from "../src/schedule-analysis.js";

function addDays(value,days) {
  const date=new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function mondayDates(start,count) {
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

test("major schedule changes compare a date with nearby same-weekday schedules", () => {
  const dates=mondayDates("2026-01-05",12);
  const changed=new Set([dates[4],dates[8]]);
  const entries=dates.flatMap((date)=>changed.has(date) ? changedDay(date) : normalDay(date));
  const profile=detectMajorScheduleChanges(entries);
  assert.deepEqual(profile.changes.map((item)=>item.date),[dates[4],dates[8]]);
  assert.ok(profile.changes.every((item)=>item.changedHours===6));
  assert.ok(profile.changes.every((item)=>item.changedFraction>=.2));
});

test("schedule takeaways compare changed dates with normal same-weekday audience baselines", () => {
  const dates=mondayDates("2026-01-05",12);
  const changed=new Set([dates[4],dates[8]]);
  const entries=dates.flatMap((date)=>changed.has(date) ? changedDay(date) : normalDay(date));
  const rows=dates.map((date)=>({
    period_start:date,
    period_end:date,
    station_value:changed.has(date) ? 300 : 400,
    unit:"listeners"
  }));
  const result=analyzeScheduleTakeaways({
    entries,
    dailyByMetric:{ "streaming.listeners":rows }
  });
  const general=result.findings.find((item)=>item.id==="schedule:major-days");
  const audience=result.findings.find((item)=>item.id==="schedule-effect:streaming.listeners");
  assert.ok(general);
  assert.ok(audience);
  assert.match(audience.summary,/association, not proof/i);
  assert.match(audience.summary,/-25\.0%/);
  assert.equal(audience.category,"scheduling");
  assert.equal(audience.sampleSize,2);
});

test("small schedule differences do not become major-change findings", () => {
  const dates=mondayDates("2026-01-05",10);
  const entries=dates.flatMap((date,index)=>index===5 ? [
    {date,start:"00:00",end:"22:00",program:"Regular Schedule"},
    {date,start:"22:00",end:"23:59",program:"Late Special"}
  ] : normalDay(date));
  const result=analyzeScheduleTakeaways({entries,dailyByMetric:{}});
  assert.equal(result.profile.changes.length,0);
  assert.equal(result.findings.length,0);
});

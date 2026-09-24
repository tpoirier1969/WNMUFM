import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTakeaways, TAKEAWAY_CATEGORIES, TAKEAWAY_METRICS } from "../src/takeaways.js";

function dayRows(start,count,weekdayValue,weekendValue,{unit="listeners",spike=null}={}) {
  const rows=[];
  const date=new Date(`${start}T12:00:00Z`);
  for(let i=0;i<count;i+=1) {
    const current=new Date(date);
    current.setUTCDate(date.getUTCDate()+i);
    const day=current.getUTCDay();
    let value=(day===0 || day===6) ? weekendValue : weekdayValue;
    if(spike && i===spike.index) value=spike.value;
    const iso=current.toISOString().slice(0,10);
    rows.push({ period_start:iso, period_end:iso, station_value:value, unit });
  }
  return rows;
}

function monthRows(startYear,startMonth,count,base,{unit="listeners",growth=0}={}) {
  const rows=[];
  for(let i=0;i<count;i+=1) {
    const total=(startMonth-1)+i;
    const year=startYear+Math.floor(total/12);
    const month=(total%12)+1;
    const start=`${year}-${String(month).padStart(2,"0")}-01`;
    const end=new Date(Date.UTC(year,month,0,12)).toISOString().slice(0,10);
    rows.push({ period_start:start, period_end:end, station_value:base+(i*growth), unit });
  }
  return rows;
}

test("Takeaways exposes the expected user-facing categories and source metrics", () => {
  assert.ok(TAKEAWAY_CATEGORIES.some(([key])=>key==="cross-source"));
  assert.ok(TAKEAWAY_CATEGORIES.some(([key])=>key==="data-quality"));
  assert.ok(TAKEAWAY_METRICS.some((item)=>item.key==="streaming.listeners"));
  assert.ok(TAKEAWAY_METRICS.some((item)=>item.key==="ga4.site_sessions"));
});

test("weekday/weekend and day-of-week patterns are derived from daily source facts", () => {
  const rows=dayRows("2026-01-01",84,400,280);
  const findings=analyzeTakeaways({ dailyByMetric:{ "streaming.listeners":rows } });
  const weekpart=findings.find((item)=>item.id==="weekpart:streaming.listeners");
  const dow=findings.find((item)=>item.id==="dow:streaming.listeners");
  assert.ok(weekpart);
  assert.match(weekpart.summary,/weekend median/i);
  assert.match(weekpart.summary,/-30\.0%/);
  assert.equal(weekpart.sampleSize,84);
  assert.ok(dow);
  assert.equal(dow.grain,"day");
});

test("extreme spikes are framed as reviewable data-quality findings, not invalid data", () => {
  const rows=dayRows("2026-01-01",70,500,400,{unit:"views",spike:{index:30,value:10000}});
  const findings=analyzeTakeaways({ dailyByMetric:{ "website.pageviews":rows } });
  const outlier=findings.find((item)=>item.id==="outlier:website.pageviews");
  assert.ok(outlier);
  assert.equal(outlier.category,"data-quality");
  assert.match(outlier.summary,/may be legitimate/i);
  assert.doesNotMatch(outlier.summary,/bot|invalid|bad data/i);
});

test("same-source data-quality spikes on the same date are grouped with and", () => {
  const dailyByMetric={
    "website.active_users":dayRows("2026-01-01",70,500,400,{unit:"users",spike:{index:30,value:12000}}),
    "website.pageviews":dayRows("2026-01-01",70,900,700,{unit:"views",spike:{index:30,value:20000}})
  };
  const findings=analyzeTakeaways({dailyByMetric});
  const quality=findings.filter((item)=>item.category==="data-quality");
  assert.equal(quality.length,1);
  assert.equal(quality[0].kind,"outlier-group");
  assert.match(quality[0].title,/active users and NPR website pageviews/i);
  assert.match(quality[0].summary,/grouped as one data-quality event/i);
  assert.deepEqual(quality[0].metricKeys,["website.active_users","website.pageviews"]);
  assert.equal(quality[0].evidence.length,2);
});

test("monthly comparisons use source-valid month rows rather than summing daily uniques", () => {
  const rows=monthRows(2025,1,20,100,{unit:"users"});
  rows[7].station_value=100;
  rows[19].station_value=130;
  const findings=analyzeTakeaways({ monthlyByMetric:{ "website.active_users":rows } });
  const yoy=findings.find((item)=>item.id==="yoy:website.active_users");
  assert.ok(yoy);
  assert.match(yoy.summary,/30\.0%/);
  assert.equal(yoy.grain,"month");
  assert.equal(yoy.sampleSize,2);
});

test("cross-source weekend consensus requires several source families", () => {
  const dailyByMetric={
    "streaming.listeners":dayRows("2026-01-01",84,400,300),
    "website.active_users":dayRows("2026-01-01",84,500,350,{unit:"users"}),
    "audio.downloads":dayRows("2026-01-01",84,20,10,{unit:"downloads"}),
    "npr_one.localized_listeners":dayRows("2026-01-01",84,150,110),
    "ga4.site_sessions":dayRows("2026-01-01",84,1200,900,{unit:"sessions"})
  };
  const findings=analyzeTakeaways({dailyByMetric});
  const cross=findings.find((item)=>item.id==="cross-source:weekend");
  assert.ok(cross);
  assert.equal(cross.category,"cross-source");
  assert.match(cross.summary,/source families/);
});


test("the app exposes Takeaways as a top-level evidence-backed module", async () => {
  const fs=await import("node:fs/promises");
  const [app,html]=await Promise.all([
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../index.html",import.meta.url),"utf8")
  ]);
  assert.match(html,/data-tab="takeaways"/);
  assert.match(html,/data-panel="takeaways"/);
  assert.match(html,/id="takeawayCategoryButtons"/);
  assert.match(app,/analyzeTakeaways/);
  assert.match(app,/Open evidence in Trend Explorer/);
  assert.match(app,/data-metrics=/);
  assert.match(app,/button\.dataset\.metrics/);
  assert.match(app,/Each card shows the actual source span used/);
});


test("Takeaways can add exact dated FM schedule-change findings without claiming causation", async () => {
  const fs=await import("node:fs/promises");
  const [app,takeaways]=await Promise.all([
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../src/takeaways.js",import.meta.url),"utf8")
  ]);
  assert.match(takeaways,/\["scheduling","Scheduling"\]/);
  assert.match(app,/fetchExactComposerScheduleRange/);
  assert.match(app,/analyzeScheduleTakeaways/);
  assert.match(app,/Scheduling findings use exact dated Composer schedules/);
});

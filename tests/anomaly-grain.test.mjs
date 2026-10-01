import test from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies, REPORT_TYPES } from "../src/reports.js";
import { analyzeTakeaways } from "../src/takeaways.js";

function addDays(value,days) {
  const date=new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

test("detected anomalies preserve the source grain", () => {
  const starts=["2026-07-26","2026-08-02","2026-08-09","2026-08-16","2026-08-23","2026-08-30","2026-09-06"];
  const observations=[];
  starts.forEach((period_start,index)=>{
    observations.push({
      grain:"week",
      period_start,
      metric_key:"website.active_users",
      dimension_type:"",
      station_value:index===4 ? 3000 : 100
    });
    observations.push({
      grain:"week",
      period_start,
      metric_key:"website.engaged_seconds_per_user",
      dimension_type:"",
      station_value:index===4 ? 1 : 45
    });
  });

  const anomalies=detectAnomalies(observations,REPORT_TYPES.WEBSITE);
  assert.equal(anomalies.length,1);
  assert.equal(anomalies[0].grain,"week");
  assert.equal(anomalies[0].evidence.grain,"week");
  assert.equal(anomalies[0].anomaly_key,"website_spike_2026-08-23");
  assert.match(anomalies[0].evidence.review_scope,/^station_website\|/);
});

test("weekly review decisions do not suppress a daily Takeaway on the same calendar date", () => {
  const spikeDate="2026-01-15";
  const daily=Array.from({length:35},(_,index)=>({
    period_start:addDays("2026-01-01",index),
    period_end:addDays("2026-01-01",index),
    station_value:addDays("2026-01-01",index)===spikeDate ? 1000 : 100,
    unit:"users"
  }));

  const weeklyReviewed=[{
    anomaly_key:`website_spike_${spikeDate}`,
    grain:"week",
    status:"expected",
    evidence:{date:spikeDate,grain:"week"}
  }];
  const weeklyResult=analyzeTakeaways({
    dailyByMetric:{"website.active_users":daily},
    reviewedAnomalies:weeklyReviewed
  });
  assert.ok(weeklyResult.some((finding)=>
    finding.category==="data-quality" && (finding.outlierDate===spikeDate || finding.title?.includes("Jan 15, 2026"))
  ));

  const dailyReviewed=[{
    anomaly_key:`website_spike_${spikeDate}`,
    grain:"day",
    status:"expected",
    evidence:{date:spikeDate,grain:"day"}
  }];
  const dailyResult=analyzeTakeaways({
    dailyByMetric:{"website.active_users":daily},
    reviewedAnomalies:dailyReviewed
  });
  assert.equal(dailyResult.some((finding)=>
    finding.category==="data-quality" && (finding.outlierDate===spikeDate || finding.title?.includes("Jan 15, 2026"))
  ),false);
});

test("anomaly-grain migration backfills from imports and protects stale clients", async () => {
  const fs=await import("node:fs/promises");
  const sql=await fs.readFile(new URL("../supabase/migrations/20261001_add_anomaly_grain.sql",import.meta.url),"utf8");
  assert.match(sql,/add column if not exists grain text/i);
  assert.match(sql,/set grain = i\.grain/i);
  assert.match(sql,/wnmufm_fill_anomaly_grain/i);
  assert.match(sql,/set grain = o\.grain/i);
  assert.match(sql,/before insert or update of import_id, observation_id, grain/i);
  assert.match(sql,/alter column grain drop default/i);
  assert.match(sql,/check \(grain in \('day','week','month','unknown'\)\)/i);
});


test("anomaly keys differ across report filter scopes but remain stable within one scope", () => {
  const observations=Array.from({length:7},(_,index)=>[
    {grain:"day",period_start:`2026-08-${String(20+index).padStart(2,"0")}`,metric_key:"website.active_users",dimension_type:"",station_value:index===3 ? 10000 : 100},
    {grain:"day",period_start:`2026-08-${String(20+index).padStart(2,"0")}`,metric_key:"website.engaged_seconds_per_user",dimension_type:"",station_value:index===3 ? 1 : 45}
  ]).flat();
  const first=detectAnomalies(observations,REPORT_TYPES.WEBSITE,null,{device:"mobile"})[0];
  const repeat=detectAnomalies(observations,REPORT_TYPES.WEBSITE,null,{device:"mobile"})[0];
  const other=detectAnomalies(observations,REPORT_TYPES.WEBSITE,null,{device:"desktop"})[0];
  assert.equal(first.anomaly_key,repeat.anomaly_key);
  assert.notEqual(first.anomaly_key,other.anomaly_key);
  assert.notEqual(first.evidence.review_scope,other.evidence.review_scope);
});

test("forward anomaly-grain migration removes the live default and supports observation-only rows", async () => {
  const fs=await import("node:fs/promises");
  const sql=await fs.readFile(new URL("../supabase/migrations/20261001_fix_anomaly_grain_derivation.sql",import.meta.url),"utf8");
  assert.match(sql,/alter column grain drop default/i);
  assert.match(sql,/set grain = o\.grain/i);
  assert.match(sql,/observation_id is not null/i);
  assert.match(sql,/before insert or update of import_id, observation_id, grain/i);
});


test("reviewed and excluded anomaly reads are paginated instead of capped at 500 rows", async () => {
  const fs=await import("node:fs/promises");
  const data=await fs.readFile(new URL("../src/data.js",import.meta.url),"utf8");
  assert.match(data,/async function selectPagedRows/);
  assert.match(data,/loadReviewedAnomalies[\s\S]*selectPagedRows/);
  assert.match(data,/status: "eq\.excluded"[\s\S]*selectPagedRows|selectPagedRows[\s\S]*status: "eq\.excluded"/);
});

test("collection checklist requires historical coverage rather than mere grain existence", async () => {
  const fs=await import("node:fs/promises");
  const app=await fs.readFile(new URL("../src/app.js",import.meta.url),"utf8");
  assert.match(app,/span\.start>targetStart/);
  assert.match(app,/missing issues preserved as gaps/i);
  assert.doesNotMatch(app,/Preview newsletter grids are loaded for Sep–Dec 2023/);
});


test("unfiltered anomaly keys retain the legacy identity while filtered reports get scoped identities", () => {
  const observations=Array.from({length:7},(_,index)=>[
    {grain:"day",period_start:`2026-08-${String(20+index).padStart(2,"0")}`,metric_key:"website.active_users",dimension_type:"",station_value:index===3 ? 10000 : 100},
    {grain:"day",period_start:`2026-08-${String(20+index).padStart(2,"0")}`,metric_key:"website.engaged_seconds_per_user",dimension_type:"",station_value:index===3 ? 1 : 45}
  ]).flat();
  const base=detectAnomalies(observations,REPORT_TYPES.WEBSITE)[0];
  const filtered=detectAnomalies(observations,REPORT_TYPES.WEBSITE,null,{device:"mobile"})[0];
  assert.equal(base.anomaly_key,"website_spike_2026-08-23");
  assert.match(filtered.anomaly_key,/^website_spike_2026-08-23_[a-z0-9]+$/);
  assert.equal(base.evidence.review_scope,"station_website|{}");
  assert.notEqual(filtered.evidence.review_scope,base.evidence.review_scope);
});

test("filtered anomaly reviews do not suppress unfiltered Takeaway outliers", () => {
  const spikeDate="2026-01-15";
  const daily=Array.from({length:35},(_,index)=>({
    period_start:addDays("2026-01-01",index),
    period_end:addDays("2026-01-01",index),
    station_value:addDays("2026-01-01",index)===spikeDate ? 1000 : 100,
    unit:"users"
  }));
  const filteredReview=[{
    anomaly_key:`website_spike_${spikeDate}_abc123`,
    grain:"day",
    status:"expected",
    evidence:{date:spikeDate,grain:"day",review_scope:'station_website|{"device":"mobile"}'}
  }];
  const findings=analyzeTakeaways({
    dailyByMetric:{"website.active_users":daily},
    reviewedAnomalies:filteredReview
  });
  assert.ok(findings.some((finding)=>finding.category==="data-quality"));
});

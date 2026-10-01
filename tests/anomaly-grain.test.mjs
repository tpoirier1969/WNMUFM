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
  assert.match(sql,/before insert or update of import_id, grain/i);
  assert.match(sql,/check \(grain in \('day','week','month','unknown'\)\)/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildCoverageRows, intersectRanges } from "../src/coverage-summary.js";

test("coverage summary keeps source families and grains distinct", () => {
  const rows=buildCoverageRows([
    {report_type:"station_streaming",grain:"day",report_start:"2025-09-12",report_end:"2026-09-11"},
    {report_type:"station_streaming",grain:"week",report_start:"2023-09-04",report_end:"2026-07-27"},
    {report_type:"station_streaming",grain:"month",report_start:"2023-09-01",report_end:"2026-07-31"},
    {report_type:"ga4_website",grain:"day",report_start:"2026-07-23",report_end:"2026-09-22"},
    {report_type:"ga4_website",grain:"unknown",report_start:"2026-01-01",report_end:"2026-09-23"}
  ]);
  const streaming=rows.find((row)=>row.key==="station_streaming");
  const google=rows.find((row)=>row.key==="ga4_website");
  assert.deepEqual(streaming.grains.map((grain)=>grain.grain),["day","week","month"]);
  assert.equal(streaming.grains.find((grain)=>grain.grain==="week").startDate,"2023-09-04");
  assert.deepEqual(google.grains.map((grain)=>grain.grain),["day","unknown"]);
  assert.equal(google.label,"Google Analytics 4");
});

test("common comparison windows use the overlap, not the union", () => {
  assert.deepEqual(intersectRanges([
    {startDate:"2025-09-12",endDate:"2026-09-11"},
    {startDate:"2025-09-22",endDate:"2026-09-19"},
    {startDate:"2025-09-22",endDate:"2026-09-20"},
    {startDate:"2025-09-22",endDate:"2026-09-21"}
  ]),{
    startDate:"2025-09-22",
    endDate:"2026-09-11"
  });
});


test("the app shows a compact coverage ribbon and recommended common daily window", async () => {
  const fs=await import("node:fs/promises");
  const [app,html]=await Promise.all([
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../index.html",import.meta.url),"utf8")
  ]);
  assert.match(html,/id="dataAvailability"/);
  assert.match(html,/id="dataAvailabilityRows"/);
  assert.match(app,/Best cross-source daily comparison/);
  assert.match(app,/Use common daily window/);
  assert.match(app,/Google Analytics 4 dated detail/);
});

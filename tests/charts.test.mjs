import test from "node:test";
import assert from "node:assert/strict";
import { selectSpacedLabelIndexes } from "../src/charts.js";

test("chart labels are thinned when projected text would overlap", () => {
  const points=Array.from({length:30},(_,i)=>({label:"Day " + (i+1),shortLabel:"Mon 9/" + (i+1) + "/26"}));
  const indexes=selectSpacedLabelIndexes(points,600,{labelAngle:-48,minLabelGap:8,labelEvery:1});
  assert.ok(indexes.length < points.length);
  for(let i=1;i<indexes.length;i+=1) assert.ok(indexes[i]>indexes[i-1]);
});


test("overview period data is collapsible and Explore avoids duplicate presentations", async () => {
  const fs = await import("node:fs/promises");
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html,/details id="trendDataDetails"/);
  assert.doesNotMatch(html,/id="exploreInsights"/);
  assert.doesNotMatch(html,/id="exploreTable"/);
});

test("website traffic source wording explains Direct and Search without inventing engine detail", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source,/Direct \/ unknown referrer/);
  assert.match(source,/Search engines/);
  assert.match(source,/does not identify Google, Bing, or other engines separately/);
});

test("trend nodes are 50 percent larger than the previous compact markers", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/charts.js", import.meta.url), "utf8");
  assert.match(source,/r:3,class:/);
  assert.match(source,/r:2\.6,class:"chart-secondary-point"/);
  assert.match(source,/r:2\.6,/);
});


test("multi-metric line paths cannot inherit a series fill", async () => {
  const fs = await import("node:fs/promises");
  const css = await fs.readFile(new URL("../styles.css", import.meta.url), "utf8");
  for (let i=0;i<8;i+=1) {
    assert.match(css,new RegExp("\\.chart-metric-line\\.chart-series-" + i + "\\s*\\{[^}]*fill:none;","s"));
    assert.match(css,new RegExp("\\.chart-metric-point\\.chart-series-" + i + "\\s*\\{[^}]*fill:","s"));
  }
});


test("line charts do not render a median reference series", async () => {
  const fs = await import("node:fs/promises");
  const chartSource = await fs.readFile(new URL("../src/charts.js", import.meta.url), "utf8");
  const css = await fs.readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(chartSource,/chart-median-line|Median " \+ compactNumber\(options\.median\)/);
  assert.doesNotMatch(css,/\.chart-median-line|\.chart-median-label/);
  assert.match(css,/\.chart-line \{[^}]*stroke: var\(--brand\)/s);
  assert.match(css,/\.chart-secondary-line \{[^}]*stroke:var\(--accent\)/s);
});


test("NPR benchmark terminology is explicitly qualified", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source,/benchmarkDisplayLabel/);
  assert.match(source,/supplied by NPR/);
  assert.match(source,/does not identify its peer stations/);
  assert.match(source,/household income/);
});


test("daily chart labels target a denser spacing-based cadence", () => {
  const start = new Date("2025-09-12T12:00:00Z");
  const points = Array.from({length:365},(_,index)=>{
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate()+index);
    const iso = date.toISOString().slice(0,10);
    const yy = String(date.getUTCFullYear()).slice(-2);
    return { date:iso, shortLabel:`Mon ${date.getUTCMonth()+1}/${date.getUTCDate()}/${yy}`, label:iso };
  });
  const indexes=selectSpacedLabelIndexes(points,966,{grain:"day"});
  assert.ok(indexes.length >= 24);
  assert.ok(indexes.length < points.length);
  for(let i=1;i<indexes.length;i+=1) assert.ok(indexes[i]>indexes[i-1]);
});

test("trend charts expose horizontal drag zoom without vertical selection", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/charts.js", import.meta.url), "utf8");
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source,/attachHorizontalZoom/);
  assert.match(source,/Drag horizontally across the chart/);
  assert.match(source,/onZoomSelect\(points\[startIndex\],points\[endIndex\]/);
  assert.match(html,/id="trendZoomButton"/);
  assert.match(html,/id="trendZoomReset"/);
});

test("desktop tab strip wraps instead of creating an unnecessary scrollbar", async () => {
  const fs = await import("node:fs/promises");
  const css = await fs.readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css,/\.tab-bar \{[^}]*overflow:\s*visible;[^}]*flex-wrap:\s*wrap;/s);
  assert.doesNotMatch(css,/\.tab-bar \{[^}]*overflow-x:\s*auto;/s);
});

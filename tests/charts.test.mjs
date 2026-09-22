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

test("trend nodes are materially smaller than the original chart markers", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/charts.js", import.meta.url), "utf8");
  assert.match(source,/r:2,class:/);
  assert.match(source,/r:1\.7,class:"chart-secondary-point"/);
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

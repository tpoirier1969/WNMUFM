import test from "node:test";
import assert from "node:assert/strict";
import { selectSpacedLabelIndexes } from "../src/charts.js";

test("chart labels are thinned when projected text would overlap", () => {
  const points=Array.from({length:30},(_,i)=>({label:"Day " + (i+1),shortLabel:"Mon 9/" + (i+1) + "/26"}));
  const indexes=selectSpacedLabelIndexes(points,600,{labelAngle:-48,minLabelGap:8,labelEvery:1});
  assert.ok(indexes.length < points.length);
  for(let i=1;i<indexes.length;i+=1) assert.ok(indexes[i]>indexes[i-1]);
});

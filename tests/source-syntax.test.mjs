import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("all source JavaScript parses before deployment", () => {
  const srcDir=fileURLToPath(new URL("../src/",import.meta.url));
  const files=readdirSync(srcDir).filter((name)=>name.endsWith(".js")).sort();
  assert.ok(files.length>0);
  for(const file of files) {
    execFileSync(process.execPath,["--check",srcDir+file],{stdio:"pipe"});
  }
});

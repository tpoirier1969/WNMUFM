import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

test("Cloudflare build publishes only browser app assets", async () => {
  await rm(dist, { recursive:true, force:true });
  await execFileAsync(process.execPath, ["scripts/build-cloudflare.mjs"], { cwd:root });

  for (const path of ["index.html","styles.css","src/app.js","src/version.js","vendor/jszip.min.js"]) {
    await access(resolve(dist,path));
  }

  for (const internal of ["PROJECT_RULES.md","README.md","tests","supabase","docs","package.json"]) {
    await assert.rejects(access(resolve(dist,internal)));
  }

  const packageJson = JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
  assert.equal(packageJson.scripts["build:cloudflare"], "node scripts/build-cloudflare.mjs");
});

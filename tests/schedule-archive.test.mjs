import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("schedule archive migration stores deduplicated catalog versions and daily capture pointers", async () => {
  const sql=await readFile(new URL("../supabase/migrations/20260924_archive_wnmufm_schedule.sql",import.meta.url),"utf8");
  assert.match(sql,/create table if not exists public\.wnmufm_schedule_catalog_versions/i);
  assert.match(sql,/payload_hash text not null unique/i);
  assert.match(sql,/create table if not exists public\.wnmufm_schedule_daily_archive/i);
  assert.match(sql,/capture_date date primary key/i);
  assert.match(sql,/cron\.schedule\(/i);
  assert.match(sql,/wnmufm_schedule_archive_daily/i);
  assert.match(sql,/wnmufm-composer-schedule/i);
});

test("Composer proxy archives the recurring catalog and can return archived recurrence history", async () => {
  const source=await readFile(new URL("../supabase/functions/wnmufm-composer-schedule/index.ts",import.meta.url),"utf8");
  assert.match(source,/archiveCatalog\(result\.payload,programs\)/);
  assert.match(source,/wnmufm_schedule_catalog_versions/);
  assert.match(source,/wnmufm_schedule_daily_archive/);
  assert.match(source,/archive_recurrences_partial/);
  assert.match(source,/normalizeProgramsForDate/);
  assert.match(source,/ARCHIVE_STALE_DAYS = 7/);
});

test("historical schedule client accepts archived recurrence coverage but marks it as unsuitable for specials", async () => {
  const source=await readFile(new URL("../src/schedule-client.js",import.meta.url),"utf8");
  assert.match(source,/archive_recurrences/);
  assert.match(source,/archive_recurrences_partial/);
  assert.match(source,/supportsSpecials:false/);
  assert.match(source,/coverageStart:result\.archiveStart/);
  assert.match(source,/archive does not yet cover this historical range/i);
});

test("schedule Takeaways disable one-day special inference for archived recurring snapshots", async () => {
  const source=await readFile(new URL("../src/schedule-analysis.js",import.meta.url),"utf8");
  assert.match(source,/supportsSpecials=true/);
  assert.match(source,/supportsSpecials\s*\?\s*detectMajorScheduleChanges/);
});

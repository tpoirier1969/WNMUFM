begin;

-- User-supplied Preview issues close the December 2025 and January 2026
-- monthly-grid gaps. Both grids were transcribed from the complete schedule
-- pages in the uploaded PDFs; evidence remains scoped to the named issue month.

insert into public.wnmufm_schedule_newsletter_sources
  (source_key,issue_month,listings_current_as_of,title,source_type,file_name,file_sha256,file_size_bytes,schedule_page,timezone,notes)
values
  ('preview-2025-12','2025-12-01','2025-11-24','WNMU-FM Preview December 2025','WNMU-FM Preview newsletter',
   '12-25 Preview 11-25-25 FINAL.pdf','8d1d8c391e22926224e0445d683f0a15affabdd5284e4125f6e37907dcfa0a22',7760293,15,'America/Detroit',
   'Complete monthly schedule grid transcribed directly from page 15 of the user-supplied December 2025 Preview. Evidence is scoped to December 2025 only.'),
  ('preview-2026-01','2026-01-01','2025-12-19','WNMU-FM Preview January 2026','WNMU-FM Preview newsletter',
   '01-26 Preview 12.17.25 PROOF 2.pdf','cc365cb659a0de094f0f55ccefb226344e9060248f9907d0cf64eeb398b8dcc7',2835479,8,'America/Detroit',
   'Complete monthly schedule grid transcribed directly from page 8 of the user-supplied January 2026 Preview. Evidence is scoped to January 2026 only.')
on conflict (source_key) do update set
  issue_month=excluded.issue_month,
  listings_current_as_of=excluded.listings_current_as_of,
  title=excluded.title,
  source_type=excluded.source_type,
  file_name=excluded.file_name,
  file_sha256=excluded.file_sha256,
  file_size_bytes=excluded.file_size_bytes,
  schedule_page=excluded.schedule_page,
  timezone=excluded.timezone,
  notes=excluded.notes;

-- These two complete grids match the February 2026 base layout except that
-- the uploaded December/January grids explicitly show WFMT Jazz from Friday
-- midnight through Saturday 6am and use the printed Saturday title
-- "The Shuffle w/ Kurt Hauswirth". The 5am-to-5am grid is normalized to the
-- actual calendar weekday exactly as required by the newsletter schedule schema.
with target(issue_month,source_key,source_page,prefix) as (
  values
    ('2025-12-01'::date,'preview-2025-12',15::smallint,'preview-2025-12:'::text),
    ('2026-01-01'::date,'preview-2026-01',8::smallint,'preview-2026-01:'::text)
),
template as (
  select e.*
  from public.wnmufm_schedule_newsletter_entries e
  where e.issue_month='2026-02-01' and e.entry_type='monthly_grid'
)
insert into public.wnmufm_schedule_newsletter_entries
  (entry_key,source_id,issue_month,entry_type,specific_date,weekday,effective_start,effective_end,
   start_time,end_time,program_title,replaces_program_title,source_page,confidence,notes,
   source_weekday,date_scope,evidence_basis)
select
  t.prefix || split_part(e.entry_key,'preview-2026-02:',2),
  s.id,
  t.issue_month,
  'monthly_grid',
  null,
  e.weekday,
  null,
  null,
  e.start_time,
  e.end_time,
  case
    when e.weekday=6 and e.start_time in ('00:00'::time,'05:00'::time) then 'WFMT Jazz'
    when e.weekday=6 and e.start_time='16:00'::time then 'The Shuffle w/ Kurt Hauswirth'
    else e.program_title
  end,
  null,
  t.source_page,
  'high',
  'Program block represented by the named monthly schedule grid. Evidence is scoped to that issue month only; no exact effective start/end date is asserted.',
  e.source_weekday,
  'issue_month',
  'monthly_schedule_grid'
from target t
join public.wnmufm_schedule_newsletter_sources s on s.source_key=t.source_key
cross join template e
on conflict (entry_key) do update set
  source_id=excluded.source_id,
  issue_month=excluded.issue_month,
  entry_type=excluded.entry_type,
  specific_date=excluded.specific_date,
  weekday=excluded.weekday,
  effective_start=excluded.effective_start,
  effective_end=excluded.effective_end,
  start_time=excluded.start_time,
  end_time=excluded.end_time,
  program_title=excluded.program_title,
  replaces_program_title=excluded.replaces_program_title,
  source_page=excluded.source_page,
  confidence=excluded.confidence,
  notes=excluded.notes,
  source_weekday=excluded.source_weekday,
  date_scope=excluded.date_scope,
  evidence_basis=excluded.evidence_basis;

commit;

begin;

-- User-supplied November 2025 Preview closes the final missing Preview issue
-- in the Sep 2023-Oct 2026 archive. The complete monthly grid is on page 10;
-- explicit one-day schedule changes come from the dated listings on pages 13-15.

insert into public.wnmufm_schedule_newsletter_sources
  (source_key,issue_month,listings_current_as_of,title,source_type,file_name,file_sha256,file_size_bytes,schedule_page,timezone,notes)
values
  ('preview-2025-11','2025-11-01','2025-10-29','WNMU-FM Preview November 2025','WNMU-FM Preview newsletter',
   '11-25 Preview FINAL.pdf','92474826da89608b0c02eb38b838b7b888a3ae8972c5ba036bb1160de3dc542f',4920699,10,'America/Detroit',
   'Complete monthly schedule grid transcribed directly from page 10 of the user-supplied November 2025 Preview. Evidence is scoped to November 2025 only. The issue also contains explicit dated schedule listings used for dated overrides.')
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

-- The November grid is the same complete base grid represented by the
-- immediately following December issue. Clone only the normalized block
-- structure; all November provenance is rewritten to the November source.
with src as (
  select id from public.wnmufm_schedule_newsletter_sources where source_key='preview-2025-11'
),
template as (
  select *
  from public.wnmufm_schedule_newsletter_entries
  where issue_month='2025-12-01' and entry_type='monthly_grid'
)
insert into public.wnmufm_schedule_newsletter_entries
  (entry_key,source_id,issue_month,entry_type,specific_date,weekday,effective_start,effective_end,
   start_time,end_time,program_title,replaces_program_title,source_page,confidence,notes,
   source_weekday,date_scope,evidence_basis)
select
  'preview-2025-11:' || split_part(t.entry_key,'preview-2025-12:',2),
  src.id,
  '2025-11-01',
  'monthly_grid',
  null,
  t.weekday,
  null,
  null,
  t.start_time,
  t.end_time,
  t.program_title,
  null,
  10,
  'high',
  'Program block represented by the complete November 2025 monthly schedule grid on page 10. Evidence is scoped to November 2025 only; no exact effective start/end date is asserted.',
  t.source_weekday,
  'issue_month',
  'monthly_schedule_grid'
from template t cross join src
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

with src as (
  select id from public.wnmufm_schedule_newsletter_sources where source_key='preview-2025-11'
),
overrides(specific_date,start_time,program_title,replaces_program_title,source_page,slug) as (
  values
  ('2025-11-06'::date,'20:00'::time,'Ask The DNR','Ask the Experts',13::smallint,'ask-the-dnr'),
  ('2025-11-07'::date,'21:00'::time,'Gateways Radio','Peninsula Performances',13::smallint,'gateways-radio'),
  ('2025-11-09'::date,'15:00'::time,'Live at the Bop Shop: Norside Organ Trio','Jazz Showcase',13::smallint,'live-at-the-bop-shop-norside-organ-trio'),
  ('2025-11-10'::date,'23:00'::time,'Live at the Bop Shop: Norside Organ Trio','Night Studio',13::smallint,'live-at-the-bop-shop-norside-organ-trio'),
  ('2025-11-11'::date,'15:00'::time,'Conversations with Veterans','Weekday',13::smallint,'conversations-with-veterans'),
  ('2025-11-13'::date,'20:00'::time,'Ask The Doctors: Geriatric Health, Hospice, & Palliative Care','Ask the Experts',14::smallint,'ask-the-doctors-geriatric-health-hospice-palliative-care'),
  ('2025-11-14'::date,'21:00'::time,'Gateways Radio','Peninsula Performances',14::smallint,'gateways-radio'),
  ('2025-11-20'::date,'20:00'::time,'Ask the Experts: Dentists','Ask the Experts',14::smallint,'ask-the-experts-dentists'),
  ('2025-11-21'::date,'15:00'::time,'Feeding the Family','Weekday',14::smallint,'feeding-the-family'),
  ('2025-11-21'::date,'21:00'::time,'Gateways Radio','Peninsula Performances',14::smallint,'gateways-radio'),
  ('2025-11-23'::date,'15:00'::time,'The Club McKenzie - Your Jazz Speakeasy: Horn with Heart','Jazz Showcase',15::smallint,'the-club-mckenzie-your-jazz-speakeasy-horn-with-heart'),
  ('2025-11-24'::date,'23:00'::time,'The Club McKenzie - Your Jazz Speakeasy: Horn with Heart','Night Studio',15::smallint,'the-club-mckenzie-your-jazz-speakeasy-horn-with-heart'),
  ('2025-11-26'::date,'10:00'::time,'Hearing Voices: Let''s Eat','Classiclectic',15::smallint,'hearing-voices-lets-eat'),
  ('2025-11-26'::date,'11:00'::time,'Wind & Rhythm: Family & Friends','Classiclectic',15::smallint,'wind-rhythm-family-friends'),
  ('2025-11-26'::date,'15:00'::time,'Harvest Home','Weekday',15::smallint,'harvest-home'),
  ('2025-11-26'::date,'22:00'::time,'National Writers Series: Kimberly Brubaker Bradley','Stateside',15::smallint,'national-writers-series-kimberly-brubaker-bradley'),
  ('2025-11-27'::date,'05:00'::time,'National Writers Series: Kimberly Brubaker Bradley','Stateside',15::smallint,'national-writers-series-kimberly-brubaker-bradley'),
  ('2025-11-27'::date,'10:00'::time,'Every Good Thing','Classiclectic',15::smallint,'every-good-thing'),
  ('2025-11-27'::date,'11:00'::time,'Songs of Thanks','Classiclectic',15::smallint,'songs-of-thanks'),
  ('2025-11-27'::date,'12:00'::time,'Turkey Confidential','Sounds Choral',15::smallint,'turkey-confidential'),
  ('2025-11-27'::date,'15:00'::time,'Massasoit''s Peace Pact with the Pilgrims','Weekday',15::smallint,'massasoits-peace-pact-with-the-pilgrims'),
  ('2025-11-27'::date,'20:00'::time,'Shadowglow: Thanksgiving with the American Sound','Ask the Experts',15::smallint,'shadowglow-thanksgiving-with-the-american-sound'),
  ('2025-11-27'::date,'22:00'::time,'National Writers Series: Jennifer Weiner','Stateside',15::smallint,'national-writers-series-jennifer-weiner'),
  ('2025-11-28'::date,'05:00'::time,'National Writers Series: Jennifer Weiner','Stateside',15::smallint,'national-writers-series-jennifer-weiner'),
  ('2025-11-28'::date,'10:00'::time,'Wind & Rhythm: Being Thankful','Classiclectic',15::smallint,'wind-rhythm-being-thankful'),
  ('2025-11-28'::date,'11:00'::time,'Feminine Fusion: Autumn Harvest','Classiclectic',15::smallint,'feminine-fusion-autumn-harvest'),
  ('2025-11-28'::date,'15:00'::time,'The Poetry Cafe Live','Weekday',15::smallint,'the-poetry-cafe-live'),
  ('2025-11-28'::date,'21:00'::time,'Gateways Radio','Peninsula Performances',15::smallint,'gateways-radio'),
  ('2025-11-28'::date,'22:00'::time,'National Writers Series: Jeanine Cummins','Stateside',15::smallint,'national-writers-series-jeanine-cummins')
)
insert into public.wnmufm_schedule_newsletter_entries
  (entry_key,source_id,issue_month,entry_type,specific_date,weekday,effective_start,effective_end,
   start_time,end_time,program_title,replaces_program_title,source_page,confidence,notes,
   source_weekday,date_scope,evidence_basis)
select
  'preview-2025-11:dated:' || o.specific_date::text || ':' || to_char(o.start_time,'HH24:MI') || ':' || o.slug,
  src.id,
  '2025-11-01',
  'dated_override',
  o.specific_date,
  extract(dow from o.specific_date)::smallint,
  o.specific_date,
  o.specific_date,
  o.start_time,
  null,
  o.program_title,
  o.replaces_program_title,
  o.source_page,
  'high',
  'Explicit date and start time listed in the November 2025 Preview daily schedule listings. End time is left unset unless explicitly stated; the named recurring block is from the same issue''s complete monthly grid.',
  extract(dow from o.specific_date)::smallint,
  'specific_date',
  'explicit_dated_listing'
from overrides o cross join src
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

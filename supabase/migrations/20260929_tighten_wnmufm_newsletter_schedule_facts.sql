-- WNMU-FM only: tighten Preview newsletter schedule storage to source-supported facts.
-- Monthly schedule grids are evidence for that issue month only. They are not treated as exact
-- effective-date ranges and must never be extrapolated into earlier or later months.

alter table public.wnmufm_schedule_newsletter_entries
  add column if not exists source_weekday smallint,
  add column if not exists date_scope text,
  add column if not exists evidence_basis text;

-- Preserve the weekday column exactly as printed in the 5am-to-5am grid while retaining
-- weekday as the normalized actual calendar weekday used for timestamp joins.
update public.wnmufm_schedule_newsletter_entries
set source_weekday = case
  when start_time < time '05:00' and entry_type = 'recurring'
    then (weekday + 6) % 7
  else weekday
end
where source_weekday is null;

-- "recurring" was too broad a label. These rows state only what the named monthly grid shows.
alter table public.wnmufm_schedule_newsletter_entries
  drop constraint if exists wnmufm_schedule_newsletter_entries_type;

update public.wnmufm_schedule_newsletter_entries
set entry_type = 'monthly_grid'
where entry_type = 'recurring';

alter table public.wnmufm_schedule_newsletter_entries
  add constraint wnmufm_schedule_newsletter_entries_type
  check (entry_type in ('monthly_grid','dated_override','embedded_feature'));

-- Do not manufacture exact effective dates from a monthly grid.
update public.wnmufm_schedule_newsletter_entries
set effective_start = null,
    effective_end = null,
    date_scope = 'issue_month',
    evidence_basis = 'monthly_schedule_grid',
    notes = 'Program block transcribed from the named monthly schedule grid. Evidence is scoped to that issue month only; no exact effective start/end date is asserted.'
where entry_type = 'monthly_grid';

-- Dated overrides retain exact dates only because the newsletter explicitly provides them.
update public.wnmufm_schedule_newsletter_entries
set date_scope = 'specific_date',
    evidence_basis = 'explicit_dated_listing'
where entry_type = 'dated_override';

update public.wnmufm_schedule_newsletter_entries
set date_scope = 'source_stated'
where date_scope is null;

update public.wnmufm_schedule_newsletter_entries
set evidence_basis = 'source_stated'
where evidence_basis is null;

alter table public.wnmufm_schedule_newsletter_entries
  alter column source_weekday set not null,
  alter column date_scope set not null,
  alter column evidence_basis set not null;

alter table public.wnmufm_schedule_newsletter_entries
  drop constraint if exists wnmufm_schedule_newsletter_entries_source_weekday;
alter table public.wnmufm_schedule_newsletter_entries
  add constraint wnmufm_schedule_newsletter_entries_source_weekday
  check (source_weekday between 0 and 6);

alter table public.wnmufm_schedule_newsletter_entries
  drop constraint if exists wnmufm_schedule_newsletter_entries_date_scope;
alter table public.wnmufm_schedule_newsletter_entries
  add constraint wnmufm_schedule_newsletter_entries_date_scope
  check (date_scope in ('issue_month','specific_date','explicit_range','source_stated'));

comment on column public.wnmufm_schedule_newsletter_entries.issue_month is
  'Month named by the newsletter schedule grid. Monthly-grid facts are not extrapolated outside this month.';
comment on column public.wnmufm_schedule_newsletter_entries.source_weekday is
  'Weekday column printed in the newsletter grid, 0=Sunday through 6=Saturday.';
comment on column public.wnmufm_schedule_newsletter_entries.weekday is
  'Actual calendar weekday after normalizing the newsletter 5am-to-5am grid; 0=Sunday through 6=Saturday.';
comment on column public.wnmufm_schedule_newsletter_entries.date_scope is
  'How precisely the source supports the date: issue_month, specific_date, explicit_range, or source_stated.';
comment on column public.wnmufm_schedule_newsletter_entries.evidence_basis is
  'What in the newsletter directly supports the row, such as monthly_schedule_grid or explicit_dated_listing.';
comment on column public.wnmufm_schedule_newsletter_entries.effective_start is
  'Populated only when the source itself supports an exact effective start date; null for monthly schedule-grid rows.';
comment on column public.wnmufm_schedule_newsletter_entries.effective_end is
  'Populated only when the source itself supports an exact effective end date; null for monthly schedule-grid rows.';

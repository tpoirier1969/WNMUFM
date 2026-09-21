-- Preserve the report-run date separately from upload time so analysis can suppress incomplete run-day/current periods.

alter table public.wnmufm_analytics_imports
  add column if not exists report_run_date date not null default current_date;

comment on column public.wnmufm_analytics_imports.report_run_date is
  'Date the NPR report was run/exported. Analysis excludes periods ending on or after this date so incomplete run-day/current periods do not masquerade as complete results.';

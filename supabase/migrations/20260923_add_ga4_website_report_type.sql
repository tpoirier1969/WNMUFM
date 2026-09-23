-- Allow Google Analytics 4 source-period exports as a first-class WNMU-FM analytics source.

alter table public.wnmufm_analytics_imports
  drop constraint if exists wnmufm_analytics_imports_report_type_check;

alter table public.wnmufm_analytics_imports
  add constraint wnmufm_analytics_imports_report_type_check
  check (report_type in (
    'audio_downloads',
    'audio_program_drilldown',
    'station_streaming',
    'station_website',
    'npr_one',
    'audience_leads',
    'ga4_website',
    'unknown'
  ));

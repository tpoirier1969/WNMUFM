create table if not exists public.wnmufm_streamguys_time_alignment (
  id smallint primary key default 1 check (id = 1),
  source_system text not null default 'StreamGuys',
  source_field text not null default 'hour_of_day_local',
  source_timezone_label text not null default 'Central Time (provisional)',
  schedule_timezone text not null default 'America/Detroit',
  offset_hours smallint not null default 1 check (offset_hours between -12 and 14),
  status text not null default 'provisional' check (status in ('provisional','verified','disabled')),
  evidence_note text,
  updated_at timestamptz not null default now()
);

alter table public.wnmufm_streamguys_time_alignment enable row level security;

drop policy if exists "WNMU FM StreamGuys alignment read" on public.wnmufm_streamguys_time_alignment;
create policy "WNMU FM StreamGuys alignment read"
on public.wnmufm_streamguys_time_alignment
for select to authenticated
using (public.wnmufm_has_analytics_role(array['viewer','editor','admin']::text[]));

drop policy if exists "WNMU FM StreamGuys alignment update" on public.wnmufm_streamguys_time_alignment;
create policy "WNMU FM StreamGuys alignment update"
on public.wnmufm_streamguys_time_alignment
for update to authenticated
using (public.wnmufm_has_analytics_role(array['admin']::text[]))
with check (public.wnmufm_has_analytics_role(array['admin']::text[]));

grant select on public.wnmufm_streamguys_time_alignment to authenticated;
grant update on public.wnmufm_streamguys_time_alignment to authenticated;

insert into public.wnmufm_streamguys_time_alignment
  (id, source_timezone_label, schedule_timezone, offset_hours, status, evidence_note)
values
  (1, 'Central Time (provisional)', 'America/Detroit', 1, 'provisional',
   'StreamGuys Hour of Day/TLH pattern aligns with WNMU Eastern schedule after a +1 hour shift: Morning Edition 06:00-09:00 ET maps to source 05:00-08:00 and All Things Considered 16:00-18:30 ET maps to source 15:00-17:30. Raw source hours remain unchanged.')
on conflict (id) do update set
  source_timezone_label = excluded.source_timezone_label,
  schedule_timezone = excluded.schedule_timezone,
  offset_hours = excluded.offset_hours,
  status = excluded.status,
  evidence_note = excluded.evidence_note,
  updated_at = now();

create or replace view public.wnmufm_streamguys_hourly_aligned
with (security_invoker = true)
as
select
  o.id as observation_id,
  o.source_import_id,
  o.source_csv,
  o.source_row,
  o.period_start as source_date,
  o.dimension_value as source_hour,
  a.source_timezone_label,
  a.schedule_timezone,
  a.offset_hours,
  a.status as alignment_status,
  ((o.period_start + o.dimension_value::time) + make_interval(hours => a.offset_hours)) as schedule_local_timestamp,
  (((o.period_start + o.dimension_value::time) + make_interval(hours => a.offset_hours))::date) as schedule_date,
  to_char(((o.period_start + o.dimension_value::time) + make_interval(hours => a.offset_hours)), 'HH24:MI') as schedule_hour,
  o.station_value as tlh_hours,
  o.unit,
  o.quality_flags
from public.wnmufm_analytics_observations o
cross join public.wnmufm_streamguys_time_alignment a
where o.metric_key = 'streamguys.tlh'
  and o.dimension_type = 'hour_of_day_local'
  and a.status <> 'disabled';

grant select on public.wnmufm_streamguys_hourly_aligned to authenticated;

comment on table public.wnmufm_streamguys_time_alignment is
'Single-row provisional mapping from StreamGuys source hour_of_day_local to WNMU schedule time. Change offset_hours or set status=disabled to roll back without altering imported source observations.';

comment on view public.wnmufm_streamguys_hourly_aligned is
'Derived WNMU schedule-aligned StreamGuys hourly TLH. Raw source date/hour remain intact; schedule_date/hour are calculated from the reversible alignment config.';

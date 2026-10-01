alter table public.wnmufm_analytics_anomalies
  alter column grain drop default;

update public.wnmufm_analytics_anomalies a
set grain = i.grain
from public.wnmufm_analytics_imports i
where i.id = a.import_id
  and (a.grain is null or btrim(a.grain) = '' or a.grain = 'unknown');

update public.wnmufm_analytics_anomalies a
set grain = o.grain
from public.wnmufm_analytics_observations o
where o.id = a.observation_id
  and (a.grain is null or btrim(a.grain) = '' or a.grain = 'unknown');

update public.wnmufm_analytics_anomalies
set grain = 'unknown'
where grain is null or btrim(grain) = '';

create or replace function public.wnmufm_fill_anomaly_grain()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.grain is null or btrim(new.grain) = '' or new.grain = 'unknown' then
    if new.import_id is not null then
      select i.grain
        into new.grain
      from public.wnmufm_analytics_imports i
      where i.id = new.import_id;
    end if;

    if (new.grain is null or btrim(new.grain) = '' or new.grain = 'unknown')
       and new.observation_id is not null then
      select o.grain
        into new.grain
      from public.wnmufm_analytics_observations o
      where o.id = new.observation_id;
    end if;
  end if;

  if new.grain is null or btrim(new.grain) = '' then
    new.grain := 'unknown';
  end if;
  return new;
end;
$$;

drop trigger if exists wnmufm_fill_anomaly_grain_trigger
  on public.wnmufm_analytics_anomalies;

create trigger wnmufm_fill_anomaly_grain_trigger
before insert or update of import_id, observation_id, grain
on public.wnmufm_analytics_anomalies
for each row
execute function public.wnmufm_fill_anomaly_grain();

alter table public.wnmufm_analytics_anomalies
  alter column grain set not null;

alter table public.wnmufm_analytics_anomalies
  drop constraint if exists wnmufm_analytics_anomalies_grain_check;

alter table public.wnmufm_analytics_anomalies
  add constraint wnmufm_analytics_anomalies_grain_check
  check (grain in ('day','week','month','unknown'));

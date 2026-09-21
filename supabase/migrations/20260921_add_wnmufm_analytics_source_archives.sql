-- Exact-source provenance for WNMU-FM NPR Analytics ZIP imports.
-- FM-owned objects use the wnmufm_ prefix and must not be reused by WNMU-TV projects.

create table if not exists public.wnmufm_analytics_source_archives (
  import_id bigint primary key references public.wnmufm_analytics_imports(id) on delete cascade,
  source_bytes bytea not null,
  source_mime_type text not null default 'application/zip',
  source_size_bytes integer not null check (source_size_bytes >= 0),
  archived_at timestamptz not null default now()
);

comment on table public.wnmufm_analytics_source_archives is
  'Exact source ZIP bytes for WNMU-FM NPR Analytics imports. FM-only provenance; never used by WNMU-TV projects.';

alter table public.wnmufm_analytics_source_archives enable row level security;

create policy "WNMU FM analytics archives read"
on public.wnmufm_analytics_source_archives for select to authenticated
using (public.wnmufm_has_analytics_role(array['viewer','editor','admin']::text[]));

create policy "WNMU FM analytics archives insert"
on public.wnmufm_analytics_source_archives for insert to authenticated
with check (public.wnmufm_has_analytics_role(array['editor','admin']::text[]));

create policy "WNMU FM analytics archives update"
on public.wnmufm_analytics_source_archives for update to authenticated
using (public.wnmufm_has_analytics_role(array['editor','admin']::text[]))
with check (public.wnmufm_has_analytics_role(array['editor','admin']::text[]));

create policy "WNMU FM analytics archives delete"
on public.wnmufm_analytics_source_archives for delete to authenticated
using (public.wnmufm_has_analytics_role(array['admin']::text[]));

grant select, insert, update, delete on public.wnmufm_analytics_source_archives to authenticated;

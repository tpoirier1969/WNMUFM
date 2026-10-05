create index if not exists wnmufm_obs_dashboard_query_idx
on public.wnmufm_analytics_observations
(metric_key, grain, dimension_type, filter_signature, period_start, period_end);

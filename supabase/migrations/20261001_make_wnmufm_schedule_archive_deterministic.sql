select cron.unschedule('wnmufm_schedule_archive_daily');

select cron.schedule(
  'wnmufm_schedule_archive_daily',
  '5 10 * * *',
  $cron$
    select net.http_get(
      url := 'https://tdepltlnughyfrjqufdg.supabase.co/functions/v1/wnmufm-composer-schedule?start='
        || to_char((now() at time zone 'America/Detroit')::date, 'YYYY-MM-DD')
        || '&end='
        || to_char((now() at time zone 'America/Detroit')::date, 'YYYY-MM-DD')
        || '&archive=1',
      timeout_milliseconds := 15000
    );
  $cron$
);

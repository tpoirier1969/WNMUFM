# WNMU-FM Data Collection Status

Updated: 2026-09-21

This is the working inventory for the WNMU-FM audience analytics project. It records what is actually loaded, what remains short or missing, and what should be collected next. The goal is content-first analysis, not collecting every metric merely because NPR exposes it.

## Current inventory

| Source | Day | Week | Month | Current useful detail |
| --- | --- | --- | --- | --- |
| Station Website Overview | **Year loaded:** 2025-09-22 through 2026-09-19 | Short: 2026-08-23 through 2026-09-19 | No usable dated month series yet | active users, pageviews, engagement, channel trends, DMA/country |
| NPR One Overview | **Year loaded:** 2025-09-22 through 2026-09-21; analysis stops before the 2026-09-21 run day | Short: 2026-08-23 through 2026-09-26 | Short: 2026-08-01 through 2026-09-30 | localized listeners, average minutes, weekday/weekend hour profile, station audio/podcast/client breakdowns |
| Audio Downloads Overview | **Year loaded:** 2025-09-22 through 2026-09-20; WNMU station values are populated through 2026-09-19 | Short: 2026-08-23 through 2026-09-26 | Short: 2026-08-01 through 2026-09-30 | downloads, users, downloads/user, programs, players, player trends, 2,268 episode rows |
| Station Streaming Overview | **Short:** 2026-08-22 through 2026-09-11; the newest supplied export is only a 2026-09-11 snapshot | Short: 2026-08-24 through 2026-09-06 | Missing usable dated month history | listeners, sessions, listener-hours, session duration, device/format |
| Audio Program Drilldowns | Three short Day drilldowns only | Missing | Missing | Classiclectic, Northern Arts & Culture, Station Stories |

All imports remain in FM-owned `wnmufm_analytics_*` tables. Original source ZIPs and raw CSV rows are retained as provenance, while overlapping normalized observations can refresh the canonical chart facts.

## Highest-priority downloads

1. **Station Streaming Overview: full-year Day, Week and Month.** This is the largest core-history gap.
2. **Station Website Overview: full-year Week and Month.** Daily history is now strong, but longer-period unique-user figures should come from NPR rather than summing daily uniques.
3. **Audio Downloads Overview: full-year Week and Month.**
4. **NPR One Overview: full-year Week and Month.**
5. **Audio Program Drilldown: every selectable discrete local program**, using the longest available Day range and Week/Month where available.
6. **Any live-stream hour, half-hour, or daypart export** from NPR or the stream provider. This is the critical missing bridge between live listening and the broadcast schedule.
7. **Website content detail:** page URL/title, landing page and referrer/source-medium exports if NPR/GA makes them available.
8. **Exact historical schedule source or snapshots.** The public recurring NPR Composer schedule can describe the normal weekly lineup, but exact dated history is needed for preemptions and substitutions.

## Content taxonomy needed

The application should classify programs into a small useful editorial taxonomy so the question becomes “what kinds of content work?” rather than “what device did somebody use?” Initial categories should include at least:

- News / current affairs
- Classical
- Jazz
- Folk / roots / Americana
- Specialty music
- Local arts / culture
- Local public affairs / interviews
- National talk / magazine
- Other / mixed

The schedule and WNMU program pages can supply much of this classification. Manual review is preferable to guessing when a program does not fit cleanly.

## Collection rules

- Keep the original NPR ZIP unchanged.
- Prefer the longest unfiltered export available.
- Collect Day, Week and Month as separate source facts. Do not recreate weekly/monthly unique listeners or users by summing daily unique counts.
- The report-run day is preserved as source evidence but excluded from completed-day analysis.
- Missing or blank values remain missing; they are not zero.
- Re-importing an overlapping report may refresh normalized observations, but the original import and raw rows remain preserved.
- FM analytics objects remain under the `wnmufm_` namespace so this project cannot overwrite WNMU-TV project data.

## Lower-priority / supporting data

Device type, player/client, browser/platform and similar technical breakdowns remain useful for diagnosing distribution or suspicious behavior. They should not dominate the default analytics experience unless they answer a specific station question.

Potential later additions include terrestrial ratings, pledge/member response by program or content, newsletter response, and social referral performance if those sources become available and can be tied to programming decisions.

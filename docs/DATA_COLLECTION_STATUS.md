# WNMU-FM Data Collection Status

Updated: 2026-09-23

This is the working inventory for the WNMU-FM audience analytics project. It records what is actually loaded, what remains short or missing, and what should be collected next. The goal is content-first analysis, not collecting every metric merely because NPR exposes it.

## Current inventory

| Source | Day | Week | Month | Current useful detail |
| --- | --- | --- | --- | --- |
| Station Website Overview | **Year loaded:** 2025-09-22 through 2026-09-19 | Short: 2026-08-23 through 2026-09-19 | No usable dated month series yet | active users, pageviews, engagement, channel trends, DMA/country |
| NPR One Overview | **Year loaded:** 2025-09-22 through 2026-09-21; analysis stops before the 2026-09-21 run day | Short: 2026-08-23 through 2026-09-26 | Short: 2026-08-01 through 2026-09-30 | localized listeners, average minutes, weekday/weekend hour profile, station audio/podcast/client breakdowns |
| Audio Downloads Overview | **Year loaded:** 2025-09-22 through 2026-09-20; WNMU station values are populated through 2026-09-19 | Short: 2026-08-23 through 2026-09-26 | Short: 2026-08-01 through 2026-09-30 | downloads, users, downloads/user, programs, players, player trends, 2,268 episode rows |
| Station Streaming Overview | **Year loaded:** 2025-09-12 through 2026-09-11 | Short: 2026-08-24 through 2026-09-06 | Missing usable dated month history | listeners, sessions, listener-hours, session duration, device/format |
| Audio Program Drilldowns | Three short Day drilldowns only | Missing | Missing | Classiclectic, Northern Arts & Culture, Station Stories |

All imports remain in FM-owned `wnmufm_analytics_*` tables. Original source ZIPs and raw CSV rows are retained as provenance, while overlapping normalized observations can refresh the canonical chart facts.

## Google Analytics 4 (GA4) source-period exports

The app now supports direct GA4 CSV imports as a separate source family from NPR Website Analytics. Useful current report families include Pages and Screens, Landing Page, Events, Traffic Acquisition, User Acquisition, Country, Browser details, Tech overview, User Attributes overview, and the manual-source section of Generate Leads overview.

These GA4 exports are whole-period aggregates. They add content, acquisition, geography and traffic-quality detail, but they do not create daily content history. The highest-value next GA4 source is **Date + Page Path** (or an equivalent dated content export). Detailed parameters for `audio_action` and `player_interactions` are also valuable if GA4 exposes them.

Very large GA4 dimensions are normalized only to the highest-activity rows needed for interactive analysis while the complete original CSV is preserved losslessly as source evidence.

## Highest-priority downloads

1. **Station Streaming Overview: full-year Day, Week and Month.** This is the largest core-history gap.
2. **Station Website Overview: full-year Week and Month.** Daily history is now strong, but longer-period unique-user figures should come from NPR rather than summing daily uniques.
3. **Audio Downloads Overview: full-year Week and Month.**
4. **NPR One Overview: full-year Week and Month.**
5. **Audio Program Drilldown: every selectable discrete local program**, using the longest available Day range and Week/Month where available.
6. **Any live-stream hour, half-hour, or daypart export** from NPR or the stream provider. This is the critical missing bridge between live listening and the broadcast schedule.
7. **Dated GA4 website content:** Date + Page Path (or equivalent) so content can enter Trend Explorer and daily drilldowns; current GA4 page/landing/acquisition reports are aggregate source-period facts.
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


## Filter requirements

As the history grows, analysis filters must include:

- custom start and end dates;
- Mon–Fri;
- weekend;
- each individual day of the week;
- all days.

Week-part filters should apply to daily observations without changing or re-aggregating the source facts.

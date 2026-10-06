# WNMU-FM Data Collection Status

Updated: 2026-10-06

This is the working inventory for the WNMU-FM audience analytics project. It records what is actually loaded, what remains short or missing, and what should be collected next. The goal is content-first analysis, not collecting every metric merely because NPR exposes it.

## Current inventory

| Source | Day | Week | Month | Current useful detail |
| --- | --- | --- | --- | --- |
| Station Website Overview | **Year loaded:** 2025-09-22 through 2026-09-19 | **Extended history loaded:** 2025-01-05 through 2026-09-19 | **Extended history loaded:** 2025-01-01 through 2026-08-31 | active users, pageviews, engagement, channel trends, DMA/country |
| NPR One Overview | **Year loaded:** 2025-09-22 through 2026-09-21 | **Extended history loaded:** 2024-12-29 through 2026-09-26 | **Extended history loaded:** 2025-01-01 through 2026-09-30 | localized listeners, average minutes, weekday/weekend hour profile, station audio/podcast/client breakdowns |
| Audio Downloads Overview | **Year loaded:** 2025-09-22 through 2026-09-20 | **Extended history loaded:** 2024-12-29 through 2026-09-26 | **Extended history loaded:** 2025-01-01 through 2026-09-30 | downloads, users, downloads/user, programs, players and episode detail |
| Station Streaming Overview | **Year loaded:** 2025-09-12 through 2026-09-11 | **Historical series loaded:** 2023-09-04 through 2026-09-06 | **Historical series loaded:** 2023-09-01 through 2026-07-31 | listeners, sessions, listener-hours, session duration, device/format |
| Audio Program Drilldowns | Three programs have extended Day/Week/Month history | Classiclectic and Station Stories reach 2024-12-29; Northern Arts & Culture reaches 2025-01-30 | All three reach 2025-01 through 2026-09 | Classiclectic, Northern Arts & Culture, Station Stories |
| Google Analytics 4 dated exports | **Loaded:** 2026-07-23 through 2026-09-22 | Not currently supplied as a separate dated week source | Not currently supplied as a separate dated month source | dated site page views/sessions plus dated page, landing-page and event detail |
| Preview newsletter schedules | **75 explicitly dated listings loaded** | n/a | **33 issue months have recurring-grid evidence** | 37 source issues span Sep 2023-Oct 2026; 4,162 recurring grid rows; July-Oct 2026 are preserved as source-only/dated evidence because the newer partial “Schedule at a Glance” layout is not treated as a complete grid |
| Composer recurring archive | Daily captures begin 2026-09-24 and continue forward | n/a | n/a | recurring-catalog snapshots for future schedule-change reconstruction; not exact episode logs |

All imports remain in FM-owned `wnmufm_analytics_*` tables. Original source ZIPs and raw CSV rows are retained as provenance, while overlapping normalized observations can refresh the canonical chart facts.

Historical schedule evidence is deliberately source-bounded. A Preview monthly grid describes only its named month. Composer recurrence snapshots describe the recurring catalog captured on or after the archive date. Neither source is silently extended into periods it does not document.

Current Preview archive gap is **November 2025**. The December 2025 and January 2026 complete grids are now loaded from user-supplied Preview issues. July-October 2026 use a newer partial “Schedule at a Glance” format. Those PDFs are preserved as source records and their explicitly dated broadcasts are normalized, but omitted hours are not converted into empty schedule blocks or assumed cancellations.

## Google Analytics 4 (GA4) source-period exports

The app now supports direct GA4 CSV imports as a separate source family from NPR Website Analytics. Useful current report families include Pages and Screens, Landing Page, Events, Traffic Acquisition, User Acquisition, Country, Browser details, Tech overview, User Attributes overview, and the manual-source section of Generate Leads overview.

These GA4 exports are whole-period aggregates. They add content, acquisition, geography and traffic-quality detail, but they do not create daily content history. The highest-value next GA4 source is **Date + Page Path** (or an equivalent dated content export). Detailed parameters for `audio_action` and `player_interactions` are also valuable if GA4 exposes them.

Very large GA4 dimensions are normalized only to the highest-activity rows needed for interactive analysis while the complete original CSV is preserved losslessly as source evidence.

## Highest-priority downloads

1. **Maintain and verify live-stream time-of-day detail.** StreamGuys hourly TLH from June 2024 forward is loaded and provisionally aligned from the source Central-time clock to WNMU Eastern schedule time without changing the raw hours. The app now accepts StreamGuys `TLH by Day` Raw CSV exports directly when they contain `Day`, `TLH`, and `hour_of_day_local`. Routine refreshes should use the most recent 12 complete months. Next priority remains confirming the timezone interpretation and obtaining half-hour/session-level detail if StreamGuys exposes it.
2. **The remaining missing WNMU-FM Preview issue: November 2025**, plus any stronger dated schedule source for that month. December 2025 and January 2026 are now loaded from complete user-supplied Preview grids. Do not interpolate across the remaining November gap.
3. **Audio Program Drilldown for additional discrete local programs**, using the longest available Day range and Week/Month where available. The three currently loaded programs already have substantially longer coverage than the original September audit.
4. **Additional dated Google Analytics 4 content history** when useful, especially Date + Page Path / Landing Page / event detail beyond the currently loaded 2026-07-23 through 2026-09-22 window.
5. **Exact historical episode schedules or station logs** if they become available. Exact dated episode evidence remains stronger than recurring newsletter grids or Composer recurrence snapshots for preemptions and one-day specials.

The previously listed need for full-year Week/Month Station Streaming, Station Website, Audio Downloads, and NPR One overviews has been satisfied by later imports. Continue refreshing those report families as new completed periods become available rather than treating them as missing historical sources.

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


## Routine staff source locations

- NPR Studio: `https://studio.npr.org/`
- StreamGuys Portal: `https://portal.streamguys.com/home/users`
- Google Analytics 4: `https://analytics.google.com/`
- WNMU-FM Analytics import screen: `https://wnmufm.pages.dev/`

Routine imports use a rolling 12 complete months. This gives overlap for corrected or missed reports without repeatedly downloading the entire historical archive.

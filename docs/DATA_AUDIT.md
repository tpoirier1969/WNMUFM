# WNMU-FM NPR Analytics Data Audit

This document records the first-pass evaluation of the NPR Analytics exports supplied for the WNMU-FM proof of concept.

## Collection principle

Keep NPR's Day, Week, and Month exports as distinct source facts. Additive metrics can be rolled up, but unique people/listeners generally cannot be reconstructed safely by summing daily values because the same person may appear on multiple days.

For the historical load, collect the longest available **unfiltered** Day / Week / Month exports for the four core dashboards first.

## Core reports

### Station Streaming

**Value: very high.** This is the strongest source for live digital listening health.

Keep:
- listeners
- sessions
- sessions per listener
- minutes per session
- listener-hours
- device share
- stream-format sessions

Useful questions:
- Is live streaming audience growing?
- Are listeners staying longer?
- Are weekdays and weekends behaving differently?
- How much listening is mobile, smart-speaker, or desktop/other?

Important limitation:
- the supplied dashboard has no hourly or sub-hourly live-stream dimension.
- therefore the current export cannot honestly measure individual scheduled program performance.

Needed drilldown/source:
- hourly or finer live-stream measurements, if NPR or another stream provider exposes them.

### Station Website

**Value: high**, especially for reach, acquisition, engagement, geography, and explaining unusual traffic.

Keep:
- active users
- pageviews
- views per user
- engaged hours / engaged seconds per user
- traffic channel sessions and channel trends
- DMA and country sessions

Likely redundant/derived:
- traffic-channel-share-only tables when the richer channel table supplies sessions plus share.
- scalar "versus previous period" cards once the site has historical observations.

Important anomaly already found:
- the late-August traffic burst had extremely high active users and pageviews with extremely low engagement and unusual geography/direct traffic. It must be flagged for review rather than automatically interpreted as audience growth.

Needed drilldowns:
- page / content URL
- landing page
- referrer or source/medium
- browser/OS when investigating suspicious traffic
- device-specific history only if station decisions actually require it

### Audio Downloads

**Value: very high.** This is the strongest program/content dataset in the supplied exports.

Keep:
- downloads
- users
- downloads per user
- program totals
- player/client totals and player trends
- program drilldowns
- episode/segment totals

Program drilldowns add:
- dated program downloads/users
- player
- episode/segment

Important interpretation:
- **Station Stories** behaves more like a broad station-content/archive bucket than a comparable single program.
- do not rank it naively against a discrete program such as Classiclectic.

Important anomaly already found:
- Station Stories produced very large download bursts from only a handful of users, mostly via web browser, while touching hundreds of archive files across many years.
- this resembles bulk archive retrieval/crawling and should remain visible as an anomaly, not be silently deleted.

Drill deeper:
- obtain Day / Week / Month program drilldowns for real programs when practical, especially when unique-user comparisons matter.
- preserve player and episode detail to distinguish broad audience changes from a single client or archive event.

### NPR One

**Value: high, but it describes NPR One/mobile listening rather than the live WNMU stream.**

Keep:
- localized listeners
- average minutes
- hour-of-day / weekday-weekend behavior
- station audio types
- station podcasts
- client/platform breakdowns

Important limitation:
- do not equate NPR One hour-of-day behavior with WNMU live-stream program audience.
- an "Average Station" benchmark that exactly mirrors WNMU across every row is not useful as an independent comparator until its meaning is clarified.

## Duplicate or secondary information

These fields can remain available as source evidence but do not need to drive the main dashboard:

- "versus previous period" scalar cards, once history is stored
- ratios that are exactly derivable from stored base metrics, such as views per user or sessions per listener
- aggregate player/channel shares when a richer trend/detail table covers the same period

Derived values are still useful as validation checks and for presentation.

## Missing data

The following gaps matter more than collecting many additional filter permutations:

1. **Live-stream hour/sub-hour data** for schedule/program cross-reference.
2. **Website page/landing/referrer detail** to explain what content drives visits.
3. **Audience Leads inventory** to determine whether NPR exposes useful cross-product listener context.
4. **Historical schedule snapshots** if later program attribution becomes possible.
5. **Website device history** only if the staff has a real decision that needs it.

Blank or absent exports remain missing. The application must not treat them as zero.

## Recommended long-term collection order

1. Longest available unfiltered Streaming Day / Week / Month.
2. Longest available unfiltered Website Day / Week / Month.
3. Longest available unfiltered Audio Downloads Day / Week / Month.
4. Longest available unfiltered NPR One Day / Week / Month.
5. Program drilldowns for discrete local programs, Day / Week / Month.
6. Investigate finer-grained stream analytics.
7. Add filtered/device exports only when they answer an actual station question.

This ordering maximizes long-term usefulness while minimizing CSV confetti.

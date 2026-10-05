# WNMU-FM Analytics

Proof-of-concept analytics application for WNMU-FM.

The application imports NPR Analytics ZIP exports and Google Analytics 4 CSV exports, preserves original source evidence, normalizes useful metrics into FM-specific Supabase tables, and presents station-focused trends, deterministic evidence-backed takeaways including actionability ordering, period-specific NPR benchmark trend comparisons, reviewed-anomaly context, and dated schedule-change context, including persistent recurring FM schedule changes and one-day special-programming effects inferred from daily same-weekday comparisons. StreamGuys Tier 1 hourly TLH exports are also preserved as raw hour-filtered observations and exposed through a reversible schedule-alignment layer so hourly listening can be compared with WNMU's Eastern-time program schedule without rewriting the source facts. A Schedule Explorer provides Month, Week, and Day views using the strongest defensible evidence available for each date: exact Composer episodes, WNMU-FM Preview evidence for its named month/date, then archived Composer recurrence snapshots. When Composer historical episodes are unavailable, the app preserves the recurring catalog in a daily WNMU-FM archive so recurring schedule history accumulates locally over time. The app also includes content/acquisition breakdowns, compact source coverage guidance, and grain-aware anomaly review so Day, Week, and Month flags remain distinct.

## Project governance

This project is governed by the Universal Web Application Project Rules:

https://github.com/tpoirier1969/Web-App-Standards/blob/main/UNIVERSAL_PROJECT_RULES.md

Read `PROJECT_RULES.md` before modifying the application.

## Current status

- Canonical repository: `tpoirier1969/WNMUFM`
- Canonical branch: `main`
- Status: active development / proof of concept
- Hosting/deployment: GitHub Pages remains available; Cloudflare Pages is also live from canonical `main` at `https://wnmufm.pages.dev/`
- Persistent storage: existing Supabase project `WNMUProgramming data`
- FM database ownership: every FM analytics database object uses the `wnmufm_` prefix
- StreamGuys hourly alignment: raw `hour_of_day_local` values are preserved; `wnmufm_streamguys_time_alignment` currently applies a provisional +1 hour Central-to-Eastern schedule mapping, and `wnmufm_streamguys_hourly_aligned` exposes the derived schedule date/hour. Changing the single alignment row or disabling it rolls the interpretation back without changing imported observations.
- Trend Explorer time-of-day analysis: the `Time of day` view profiles average TLH across the 24-hour WNMU Eastern clock for the selected Analysis Range, and its Hour focus can trace any one Eastern hour across dates while retaining raw StreamGuys-hour provenance.
- Trend Explorer controls: Analysis Period now owns both manual dates and presets; View by is ordered Day / Week / Month / Time of day, followed by Days included and Special dates. Inapplicable controls stay visible but disabled rather than disappearing.
- Time-of-day profile comparison: the 24-hour StreamGuys TLH profile can be overlaid by Day, Week, Month, or Quarter. Day is limited to 31-day analysis periods and Week to roughly six months to avoid unreadable spaghetti charts. Normal filter/date changes rerender automatically; manual Reload data lives in Data info.
- Time-of-day drilldown: Days Included can be shown as multiple fixed-color series. Hovered hourly points add concise schedule context only when one or two programs clearly describe the slot, and profile points are clickable to narrow directly into that period and clock hour. On-demand audio also exposes an episode-level Explore view beneath the All on-demand audio aggregate.
- Authentication/authorization: Supabase Auth via GitHub OAuth or email/password, plus `wnmu_app_user_roles` with app key `wnmufm_analytics`
- Google Analytics 4 import: source-period CSV exports for pages, landing pages, events, acquisition, geography and technical diagnostics; Google Analytics 4 aggregate reports remain separate from dated NPR website metrics
- Authoritative application version: `src/version.js`

## Run locally

Serve the repository with any static HTTP server. For example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080/`.

Directly opening `index.html` with a `file://` URL is not supported because the app uses ES modules.

## Test

```bash
npm test
```

The current test suite focuses on deterministic NPR CSV parsing, report recognition, granularity inference, and normalization helpers.

## Data model

See:

- `docs/DATA_AUDIT.md` for the initial audit of the supplied NPR reports and the recommended long-term collection plan.
- `docs/DATA_COLLECTION_STATUS.md` for the current inventory, coverage ranges, and exact reports still needed.
- `supabase/migrations/20260921_create_wnmufm_analytics_foundation.sql` for the FM-isolated Supabase schema.

The application deliberately preserves both:

1. raw imported CSV rows, for provenance and future parser improvements; and
2. normalized observations, for charting and long-term analysis.

Overlapping imports update canonical normalized observations while retaining each original import as source evidence.

## Deployment

GitHub Pages remains the verified owner-test deployment path and continues to publish from canonical `main` through the repository Pages build/deployment workflow.

Cloudflare Pages is live at `https://wnmufm.pages.dev/` without replacing GitHub Pages. Cloudflare builds with `npm run build:cloudflare` and publishes the `dist` directory. See `docs/CLOUDFLARE_PAGES.md` for deployment and Supabase redirect details.


Preview newsletter schedule evidence now feeds Scheduling Takeaways directly. Consecutive known monthly grids surface program/slot changes with monthly streaming movement as context, while explicitly dated newsletter listings can use daily same-weekday streaming context when that grain exists. The integration queries WNMU-FM schedule tables dynamically, so additional newsletter months participate without code changes.
- Performance and UI cleanup: analytics queries are cached per range until data changes, expensive modules load only when their tab is active, Trend Explorer renders before secondary overview cards, and Time-of-Day comparison checkboxes/series colors are rendered explicitly for reliable weekday/weekend comparisons.
- Focused-hour day comparison: checking multiple Days Included groups now produces one fixed-color line per group even when Hour focus is set to a single clock hour. Day-series checkbox indicators are rendered at a fixed size instead of relying on browser-native checkbox sizing.

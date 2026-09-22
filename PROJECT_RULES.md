# Project Rules

This project is governed by the Universal Web Application Project Rules:
https://github.com/tpoirier1969/Web-App-Standards/blob/main/UNIVERSAL_PROJECT_RULES.md

## Non-negotiable universal rules

- `main` is the canonical application unless this project explicitly documents another production branch.
- Fix canonical source. Do not create patch, correction, override, hotfix, or runtime-repair layers as permanent fixes.
- Maintain exactly one authoritative application version source; all displays and release checks derive from it.
- Preserve existing user data and stable identifiers.
- Read the universal rules before modifying this project.

## Project-specific rules

1. The canonical repository is `tpoirier1969/WNMUFM`; the canonical branch is `main`.
2. The authoritative application version source is `src/version.js`.
3. Canonical owner testing is performed from the GitHub Pages deployment produced from `main`. The repository Pages build/deployment workflow is the verified deployment path. Do not use branch previews as alternate owner-test applications.
4. The app uses the existing Supabase project named `WNMUProgramming data`, but every WNMU-FM analytics database object owned by this app must use the `wnmufm_` prefix.
5. Do not modify, rename, repurpose, delete, or overload WNMU-TV tables for FM analytics. Shared infrastructure may be used only when its responsibility is explicitly shared, such as `wnmu_app_user_roles` for authentication/authorization.
6. The authorization app key is `wnmufm_analytics`. Browser access must be protected by Supabase Auth and RLS. A publishable key is not authorization.
7. Preserve every imported NPR Analytics export as provenance. Normalized observations may be refreshed by overlapping imports, but raw imported rows must not be silently discarded or rewritten.
8. Day, week, and month observations are distinct source facts when NPR reports unique users/listeners. Do not manufacture weekly or monthly unique counts by summing daily unique counts.
9. Anomaly detection must flag questionable data without silently deleting it. Staff must be able to distinguish raw/all traffic from observations marked expected, excluded, or resolved.
10. Missing or blank NPR report data remains missing. Do not fill blank monthly exports, missing filters, unknown programs, or unavailable hourly streaming detail with estimates presented as measurements.
11. A program drilldown may infer its selected program only when the sum of its dated download rows uniquely matches exactly one program row in the same export. Ambiguous inference must remain unresolved and be surfaced to the user.
12. Schedule integration is a later module. Do not attribute day-level streaming data to individual programs unless a source with sufficiently fine time resolution is available.
13. NPR export parsers are regression-sensitive and require automated tests for report recognition, CSV parsing, granularity detection, deduplication identity, and normalization rules.
14. The app must remain usable on normal desktop displays and practical on phone/tablet widths. Import controls, data tables, and charts must remain keyboard accessible.
15. Every user-visible date label must include a year. Compact chart-axis date labels use a two-digit year; fuller prose or table dates may use a four-digit year when that is clearer. Do not omit the year merely because the surrounding view seems to imply it. When an airing is identified, show the day/date and time together when those source facts are available.

16. Overview print/PDF reports must be designed not to exceed 20 pages. For long selected ranges, prioritize charts and summary statistics and omit dense row-by-row tables rather than printing hundreds of observations. When detailed trend rows are included, print the chart at full width and split the row detail into two side-by-side columns where practical. Dashboard cards must size to their own content rather than stretching to match taller neighboring cards.
17. Calendar context is broader than holidays. The app should flag analytically relevant holidays, federal Election Day, major civic addresses such as the State of the Union and Michigan State of the State, and other verified special-programming dates when known. These tags are context for schedule/audience review and must not claim that WNMU-FM preempted normal programming unless schedule evidence confirms it.
18. Browser refreshes must preserve the active application module and analysis-range UI state for the current browser session. When a valid stored Supabase session is being restored, show a loading/session-restoration state rather than flashing the sign-in form.

# WNMU-FM Analytics

Proof-of-concept analytics application for WNMU-FM.

The application imports NPR Analytics ZIP exports and Google Analytics 4 CSV exports, preserves original source evidence, normalizes useful metrics into FM-specific Supabase tables, and presents station-focused trends, deterministic evidence-backed takeaways including actionability ordering, period-specific NPR benchmark trend comparisons, reviewed-anomaly context, and dated schedule-change context, including persistent recurring FM schedule changes and one-day special-programming effects inferred from daily same-weekday comparisons. When Composer historical episodes are unavailable, the app now preserves the recurring catalog in a daily WNMU-FM archive so recurring schedule history accumulates locally over time, content/acquisition breakdowns, compact source coverage guidance, and anomaly warnings.

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

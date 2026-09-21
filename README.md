# WNMU-FM Analytics

Proof-of-concept analytics application for WNMU-FM.

The application imports NPR Analytics ZIP exports, preserves raw source rows for provenance, normalizes useful metrics into FM-specific Supabase tables, and presents station-focused trends, breakdowns, data coverage, and anomaly warnings.

## Project governance

This project is governed by the Universal Web Application Project Rules:

https://github.com/tpoirier1969/Web-App-Standards/blob/main/UNIVERSAL_PROJECT_RULES.md

Read `PROJECT_RULES.md` before modifying the application.

## Current status

- Canonical repository: `tpoirier1969/WNMUFM`
- Canonical branch: `main`
- Status: active development / proof of concept
- Production URL: not established yet
- Persistent storage: existing Supabase project `WNMUProgramming data`
- FM database ownership: every FM analytics database object uses the `wnmufm_` prefix
- Authentication/authorization: Supabase Auth via GitHub OAuth or email/password, plus `wnmu_app_user_roles` with app key `wnmufm_analytics`
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
- `supabase/migrations/20260921_create_wnmufm_analytics_foundation.sql` for the FM-isolated Supabase schema.

The application deliberately preserves both:

1. raw imported CSV rows, for provenance and future parser improvements; and
2. normalized observations, for charting and long-term analysis.

Overlapping imports update canonical normalized observations while retaining each original import as source evidence.

## Deployment

No production host has been selected yet. Do not add a guessed deployment target or production URL. Once hosting is deliberately chosen and verified, update this README, the project rules if necessary, and the canonical application registry.

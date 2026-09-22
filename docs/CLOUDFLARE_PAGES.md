# Cloudflare Pages deployment

This repository supports Cloudflare Pages **in parallel with** the existing GitHub Pages deployment. Do not disable or delete the GitHub Pages workflow.

## Recommended Cloudflare project

Use Cloudflare Pages with the GitHub integration so production deploys automatically from canonical `main`.

Recommended project name: `wnmufm-analytics`  
If that Pages subdomain is unavailable, use a close variant such as `wnmufm-fm-analytics`.

## Cloudflare setup

In the Cloudflare dashboard:

1. Go to **Workers & Pages**.
2. Choose **Create application > Pages > Connect to Git**.
3. Authorize the Cloudflare Workers & Pages GitHub App for **only** the `tpoirier1969/WNMUFM` repository if possible.
4. Select repository `tpoirier1969/WNMUFM`.
5. Set:
   - **Production branch:** `main`
   - **Framework preset:** None
   - **Build command:** `npm run build:cloudflare`
   - **Build output directory:** `dist`
   - **Root directory:** leave blank / repository root
6. Save and deploy.

The build command deliberately publishes only:

- `index.html`
- `styles.css`
- `src/`
- `vendor/`

It does **not** publish tests, Supabase migrations, project rules, or internal documentation.

## Supabase Auth requirement

The application computes its GitHub OAuth return URL from the browser's current origin, so the same code works on GitHub Pages, `pages.dev`, and a future custom domain.

However, Supabase Auth will only honor a `redirect_to` URL that is on the project's redirect allow list.

After Cloudflare creates the production Pages URL:

1. Open Supabase project **WNMUProgramming data**.
2. Go to **Authentication > URL Configuration**.
3. Keep the existing GitHub Pages production URL.
4. Add the exact Cloudflare production URL, for example:
   - `https://wnmufm-analytics.pages.dev/`
5. If a custom domain is added later, add that exact production URL as well.

Do not broadly replace the existing Site URL merely to make Cloudflare work; the two deployments are intentionally supported in parallel.

## Custom domain later

The first staff-shareable deployment can use the generated `*.pages.dev` address. A branded custom domain can be attached later from the Pages project's **Custom domains** section without changing application code.

## Local verification

Run:

```bash
npm test
npm run build:cloudflare
```

Then serve `dist/` with any static HTTP server and verify sign-in, Overview, Explore, Imports, and version checking.

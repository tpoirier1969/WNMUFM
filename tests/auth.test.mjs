import test from "node:test";
import assert from "node:assert/strict";
import { hasOAuthCallback, oauthRedirectUrl, parseOAuthFragment } from "../src/oauth.js";

test("OAuth callback parser reads Supabase implicit-flow tokens", () => {
  const parsed = parseOAuthFragment("#access_token=abc123&refresh_token=def456&token_type=bearer&expires_in=3600");
  assert.equal(parsed.accessToken, "abc123");
  assert.equal(parsed.refreshToken, "def456");
  assert.equal(parsed.tokenType, "bearer");
  assert.equal(parsed.expiresIn, 3600);
  assert.equal(hasOAuthCallback("#access_token=abc123"), true);
});

test("OAuth callback parser preserves provider errors", () => {
  const parsed = parseOAuthFragment("#error=access_denied&error_description=Not%20authorized");
  assert.equal(parsed.error, "access_denied");
  assert.equal(parsed.errorDescription, "Not authorized");
  assert.equal(hasOAuthCallback("#error=access_denied"), true);
});

test("OAuth redirect URL keeps the current app path and query but not a fragment", () => {
  assert.equal(
    oauthRedirectUrl({ origin:"https://example.com", pathname:"/WNMUFM/", search:"?mode=test", hash:"#ignore" }),
    "https://example.com/WNMUFM/?mode=test"
  );
});


test("session restoration has a timeout fail-safe", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source,/withTimeout\(/);
  assert.match(source,/Session restoration timed out/);
  assert.match(source,/setAuthenticated\(false\)/);
});


test("hidden state always wins over component display styles", async () => {
  const fs = await import("node:fs/promises");
  const css = await fs.readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css,/\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

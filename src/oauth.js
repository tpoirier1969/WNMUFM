export function parseOAuthFragment(fragment = "") {
  const source = String(fragment || "").replace(/^#/, "");
  const params = new URLSearchParams(source);
  const value = (key) => params.get(key) || "";

  return {
    accessToken: value("access_token"),
    refreshToken: value("refresh_token"),
    tokenType: value("token_type"),
    expiresIn: Number(value("expires_in") || 0),
    expiresAt: Number(value("expires_at") || 0),
    error: value("error"),
    errorCode: value("error_code"),
    errorDescription: value("error_description")
  };
}

export function hasOAuthCallback(fragment = "") {
  const parsed = parseOAuthFragment(fragment);
  return Boolean(parsed.accessToken || parsed.error || parsed.errorDescription);
}

export function oauthRedirectUrl(locationLike) {
  const origin = String(locationLike?.origin || "");
  const pathname = String(locationLike?.pathname || "/");
  return `${origin}${pathname}`;
}

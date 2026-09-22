import { CONFIG } from "./config.js";
import { hasOAuthCallback, oauthRedirectUrl, parseOAuthFragment } from "./oauth.js";

const SESSION_KEY = "wnmufm.analytics.supabase.session";
let cachedSession = loadStoredSession();
let sessionGeneration = 0;

function loadStoredSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return parsed && parsed.access_token ? parsed : null;
  } catch {
    return null;
  }
}

function storeSession(session) {
  sessionGeneration += 1;
  cachedSession = session || null;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal:controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Network request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function authRequest(path, body) {
  const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: CONFIG.supabasePublishableKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, 8000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.msg || data?.message || `Authentication failed (${response.status}).`);
  return data;
}

export async function signIn(email, password) {
  const data = await authRequest("token?grant_type=password", { email, password });
  const expiresAt = Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
  const session = { ...data, expires_at: expiresAt };
  storeSession(session);
  return session;
}

export function signInWithGitHub() {
  const redirectTo = oauthRedirectUrl(window.location);
  const url = new URL(`${CONFIG.supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set("provider", "github");
  url.searchParams.set("redirect_to", redirectTo);
  window.location.assign(url.toString());
}

export async function consumeOAuthCallback() {
  if (!hasOAuthCallback(window.location.hash)) return null;

  const callback = parseOAuthFragment(window.location.hash);
  const cleanUrl = oauthRedirectUrl(window.location);
  window.history.replaceState(null, document.title, cleanUrl);

  if (callback.error || callback.errorDescription) {
    throw new Error(callback.errorDescription || callback.error || "GitHub sign in failed.");
  }
  if (!callback.accessToken) return null;

  const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: CONFIG.supabasePublishableKey,
      Authorization: `Bearer ${callback.accessToken}`
    }
  }, 8000);
  const user = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(user?.msg || user?.message || `Could not finish GitHub sign in (${response.status}).`);

  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: callback.accessToken,
    refresh_token: callback.refreshToken,
    token_type: callback.tokenType || "bearer",
    expires_in: callback.expiresIn || 3600,
    expires_at: callback.expiresAt || now + (callback.expiresIn || 3600),
    user
  };
  storeSession(session);
  return session;
}

export async function signOut() {
  const session = cachedSession;
  storeSession(null);
  if (session?.access_token) {
    await fetchWithTimeout(`${CONFIG.supabaseUrl}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: CONFIG.supabasePublishableKey,
        Authorization: `Bearer ${session.access_token}`
      }
    }, 5000).catch(() => null);
  }
}

async function refreshSession() {
  if (!cachedSession?.refresh_token) {
    storeSession(null);
    return null;
  }
  const refreshToken = cachedSession.refresh_token;
  const generationAtStart = sessionGeneration;
  try {
    const data = await authRequest("token?grant_type=refresh_token", { refresh_token: refreshToken });
    if (generationAtStart !== sessionGeneration) return cachedSession;
    const expiresAt = Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
    const session = { ...data, expires_at: expiresAt };
    storeSession(session);
    return session;
  } catch (error) {
    if (generationAtStart === sessionGeneration) storeSession(null);
    throw error;
  }
}

export async function getSession() {
  if (!cachedSession?.access_token) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Number(cachedSession.expires_at || 0) <= now + 60) return refreshSession();
  return cachedSession;
}

export function currentUser() {
  return cachedSession?.user || null;
}

async function restRequest(table, { method = "GET", query = "", body = null, prefer = "" } = {}) {
  const session = await getSession();
  if (!session?.access_token) throw new Error("Sign in is required.");
  const url = `${CONFIG.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const headers = {
    apikey: CONFIG.supabasePublishableKey,
    Authorization: `Bearer ${session.access_token}`,
    Accept: "application/json"
  };
  if (body !== null) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const response = await fetchWithTimeout(url, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  }, 30000);
  if (response.status === 204) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.hint || data?.details || `${method} ${table} failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

export async function selectRows(table, query) {
  return restRequest(table, { query });
}

export async function insertRows(table, rows, { returnRows = false } = {}) {
  if (!rows?.length) return [];
  return restRequest(table, {
    method: "POST",
    body: rows,
    prefer: returnRows ? "return=representation" : "return=minimal"
  });
}

export async function upsertRows(table, rows, conflictColumns) {
  if (!rows?.length) return [];
  const onConflict = encodeURIComponent(conflictColumns.join(","));
  return restRequest(table, {
    method: "POST",
    query: `on_conflict=${onConflict}`,
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal"
  });
}

export async function updateRows(table, query, values) {
  return restRequest(table, {
    method: "PATCH",
    query,
    body: values,
    prefer: "return=minimal"
  });
}

export async function fetchRole() {
  const user = currentUser();
  if (!user?.email) return null;
  const query = new URLSearchParams({
    select: "email,app_key,role,is_active,display_name",
    app_key: `eq.${CONFIG.appKey}`,
    email: `ilike.${user.email}`,
    is_active: "eq.true",
    limit: "1"
  }).toString();
  const rows = await selectRows("wnmu_app_user_roles", query);
  return rows?.[0] || null;
}

export async function batchInsert(table, rows, options = {}) {
  const size = options.batchSize || 200;
  for (let i = 0; i < rows.length; i += size) {
    await insertRows(table, rows.slice(i, i + size), { returnRows: false });
  }
}

export async function batchUpsert(table, rows, conflictColumns, batchSize = 200) {
  for (let i = 0; i < rows.length; i += batchSize) {
    await upsertRows(table, rows.slice(i, i + batchSize), conflictColumns);
  }
}

import { CONFIG } from "./config.js";
import { getSession } from "./api.js";
import { normalizeComposerEpisodes } from "./schedule.js";

async function fetchComposerJson(url) {
  const response = await fetch(url.toString(), { mode: "cors", cache: "no-store" });
  if (!response.ok) throw new Error(`Composer schedule lookup failed (${response.status}).`);
  return response.json();
}

async function fetchComposerViaWnmuProxy(startDate, endDate) {
  const session = await getSession();
  if (!session?.access_token) throw new Error("Sign in is required for schedule cross-reference.");
  const url = new URL(`${CONFIG.supabaseUrl}/functions/v1/wnmufm-composer-schedule`);
  url.searchParams.set("start", startDate);
  url.searchParams.set("end", endDate);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      apikey: CONFIG.supabasePublishableKey,
      Authorization: `Bearer ${session.access_token}`
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `WNMU schedule proxy failed (${response.status}).`);
  const entries = normalizeComposerEpisodes(body?.payload);
  if (!entries.length) throw new Error("Composer returned no usable schedule entries for this period.");
  return entries;
}

export async function fetchComposerSchedule(startDate, endDate) {
  let proxyError = null;
  try {
    return await fetchComposerViaWnmuProxy(startDate, endDate);
  } catch (error) {
    proxyError = error;
  }

  const attempts = [
    new URL(`${CONFIG.composerApiBase}/ucs/${CONFIG.composerUcs}/${startDate},${endDate}/episodes`),
    (() => {
      const url = new URL(`${CONFIG.composerApiBase}/episode/search`);
      url.searchParams.set("ucs", CONFIG.composerUcs);
      url.searchParams.set("start", startDate);
      url.searchParams.set("end", endDate);
      url.searchParams.set("limit", "1000");
      url.searchParams.set("order", "asc");
      return url;
    })()
  ];

  let lastError = proxyError;
  for (const url of attempts) {
    try {
      const payload = await fetchComposerJson(url);
      const entries = normalizeComposerEpisodes(payload);
      if (entries.length) return entries;
      lastError = new Error("Composer returned no usable schedule entries for this period.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Composer schedule lookup failed.");
}

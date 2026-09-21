import { CONFIG } from "./config.js";
import { getSession } from "./api.js";
import { normalizeComposerEpisodes, normalizeComposerPrograms } from "./schedule.js";

async function fetchComposerJson(url) {
  const response = await fetch(url.toString(), { mode: "cors", cache: "no-store" });
  if (!response.ok) throw new Error(`Composer schedule lookup failed (${response.status}).`);
  return response.json();
}

function normalizePayload(body, startDate, endDate) {
  const sourceType = body?.source_type || "episodes";
  const payload = body?.payload;
  const entries = sourceType === "recurrences"
    ? normalizeComposerPrograms(payload, startDate, endDate)
    : normalizeComposerEpisodes(payload);
  return { entries, sourceType };
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
  const normalized = normalizePayload(body, startDate, endDate);
  if (!normalized.entries.length) throw new Error("Composer returned schedule data, but no usable airtimes were found.");
  return normalized;
}

export async function fetchComposerSchedule(startDate, endDate) {
  let proxyError = null;
  try {
    return await fetchComposerViaWnmuProxy(startDate, endDate);
  } catch (error) {
    proxyError = error;
  }

  const attempts = [
    { type:"episodes", url:new URL(`${CONFIG.composerApiBase}/ucs/${CONFIG.composerUcs}/${startDate},${endDate}/episodes`) },
    { type:"recurrences", url:new URL(`${CONFIG.composerApiBase}/ucs/${CONFIG.composerUcs}/programs`) }
  ];

  let lastError = proxyError;
  for (const attempt of attempts) {
    try {
      const payload = await fetchComposerJson(attempt.url);
      const entries = attempt.type === "recurrences"
        ? normalizeComposerPrograms(payload, startDate, endDate)
        : normalizeComposerEpisodes(payload);
      if (entries.length) return { entries, sourceType:attempt.type };
      lastError = new Error("Composer returned schedule data, but no usable airtimes were found.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Composer schedule lookup failed.");
}

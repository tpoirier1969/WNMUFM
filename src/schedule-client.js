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
  return {
    entries,
    sourceType,
    note:body?.note || "",
    archiveStart:body?.archive_start || "",
    archiveEnd:body?.archive_end || "",
    archiveMissingDates:Number(body?.archive_missing_dates || 0),
    archiveStaleDates:Number(body?.archive_stale_dates || 0)
  };
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

function dateValue(value) {
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(value,days) {
  const date=dateValue(value);
  if(!date) return "";
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function rangeDays(startDate,endDate) {
  const start=dateValue(startDate), end=dateValue(endDate);
  if(!start || !end || end<start) return null;
  return Math.floor((end-start)/86400000)+1;
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


export async function fetchExactComposerScheduleRange(startDate,endDate,{maxDays=400}={}) {
  const totalDays=rangeDays(startDate,endDate);
  if(!totalDays) {
    return { entries:[], sourceType:"none", complete:false, reason:"Invalid schedule-analysis date range." };
  }
  if(totalDays>maxDays) {
    return { entries:[], sourceType:"none", complete:false, reason:`Schedule analysis is limited to ${maxDays} days at a time.` };
  }

  try {
    const result=await fetchComposerViaWnmuProxy(startDate,endDate);
    if(result.sourceType==="episodes") {
      return {
        ...result,
        complete:Boolean(result.entries.length),
        supportsSpecials:true,
        coverageStart:startDate,
        coverageEnd:endDate,
        reason:result.entries.length ? "" : "Composer returned no usable exact dated schedule entries for this window."
      };
    }
    if(["archive_recurrences","archive_recurrences_partial"].includes(result.sourceType)) {
      return {
        ...result,
        complete:Boolean(result.entries.length),
        supportsSpecials:false,
        coverageStart:result.archiveStart || startDate,
        coverageEnd:result.archiveEnd || endDate,
        reason:result.entries.length ? "" : "The WNMU-FM schedule archive has no usable entries for this window."
      };
    }
    return {
      entries:[],
      sourceType:result.sourceType,
      complete:false,
      supportsSpecials:false,
      coverageStart:"",
      coverageEnd:"",
      reason:"Composer did not return exact dated episodes and the WNMU-FM archive does not yet cover this historical range."
    };
  } catch(error) {
    return {
      entries:[],
      sourceType:"error",
      complete:false,
      supportsSpecials:false,
      coverageStart:"",
      coverageEnd:"",
      reason:error instanceof Error ? error.message : String(error)
    };
  }
}

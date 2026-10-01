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

async function fetchArchiveRangeViaWnmuProxy(startDate,endDate) {
  const session=await getSession();
  if(!session?.access_token) throw new Error("Sign in is required for schedule cross-reference.");
  const url=new URL(`${CONFIG.supabaseUrl}/functions/v1/wnmufm-composer-schedule`);
  url.searchParams.set("start",startDate);
  url.searchParams.set("end",endDate);
  url.searchParams.set("archive_range","1");
  const response=await fetch(url.toString(),{
    cache:"no-store",
    headers:{
      apikey:CONFIG.supabasePublishableKey,
      Authorization:`Bearer ${session.access_token}`
    }
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body?.error || `WNMU schedule archive lookup failed (${response.status}).`);
  const normalized=normalizePayload(body,startDate,endDate);
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

export function exactEpisodeCoverage(entries,startDate,endDate) {
  const requestedDays=rangeDays(startDate,endDate) || 0;
  const dates=new Set((entries || []).map((entry)=>String(entry?.date || "")).filter(Boolean));
  const missingDates=[];
  for(let date=startDate;date && date<=endDate;date=addDays(date,1)) {
    if(!dates.has(date)) missingDates.push(date);
  }
  const covered=[...dates].filter((date)=>date>=startDate && date<=endDate).sort();
  return {
    complete:requestedDays>0 && missingDates.length===0,
    coverageStart:covered[0] || "",
    coverageEnd:covered.at(-1) || "",
    coveredDays:requestedDays-missingDates.length,
    requestedDays,
    missingDates
  };
}

function exactEpisodeResult(result,startDate,endDate) {
  const coverage=exactEpisodeCoverage(result.entries,startDate,endDate);
  return {
    ...result,
    complete:coverage.complete,
    supportsSpecials:coverage.complete,
    coverageStart:coverage.coverageStart,
    coverageEnd:coverage.coverageEnd,
    reason:coverage.complete
      ? ""
      : coverage.coveredDays
        ? `Composer returned exact dated schedule entries for ${coverage.coveredDays} of ${coverage.requestedDays} requested days; ${coverage.missingDates.length} days are missing, so the range is not treated as complete.`
        : "Composer returned no usable exact dated schedule entries for this window."
  };
}

async function fetchDirectComposerEpisodes(startDate,endDate) {
  const url=new URL(`${CONFIG.composerApiBase}/ucs/${CONFIG.composerUcs}/${startDate},${endDate}/episodes`);
  const payload=await fetchComposerJson(url);
  const entries=normalizeComposerEpisodes(payload);
  if(!entries.length) throw new Error("Composer returned no usable exact dated schedule entries for this window.");
  return {entries,sourceType:"episodes",note:"Direct Composer episode fallback."};
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

  let proxyResult=null;
  let proxyError=null;
  try {
    proxyResult=await fetchComposerViaWnmuProxy(startDate,endDate);
  } catch(error) {
    proxyError=error;
  }

  if(proxyResult?.sourceType==="episodes") {
    const exact=exactEpisodeResult(proxyResult,startDate,endDate);
    if(exact.complete) return exact;
    try {
      const archive=await fetchArchiveRangeViaWnmuProxy(startDate,endDate);
      return {
        ...exact,
        archiveEntries:archive.entries || [],
        archiveStart:archive.archiveStart || "",
        archiveEnd:archive.archiveEnd || "",
        archiveMissingDates:archive.archiveMissingDates,
        archiveStaleDates:archive.archiveStaleDates
      };
    } catch {
      return exact;
    }
  }

  if(["archive_recurrences","archive_recurrences_partial"].includes(proxyResult?.sourceType)) {
    const complete=proxyResult.sourceType==="archive_recurrences" &&
      proxyResult.archiveMissingDates===0 &&
      Boolean(proxyResult.entries.length);
    return {
      ...proxyResult,
      complete,
      supportsSpecials:false,
      coverageStart:proxyResult.archiveStart || "",
      coverageEnd:proxyResult.archiveEnd || "",
      reason:complete
        ? ""
        : proxyResult.entries.length
          ? "The WNMU-FM schedule archive covers only part of this requested window, so it is not treated as complete."
          : "The WNMU-FM schedule archive has no usable entries for this window."
    };
  }

  try {
    const direct=await fetchDirectComposerEpisodes(startDate,endDate);
    return exactEpisodeResult(direct,startDate,endDate);
  } catch(directError) {
    const reason=proxyResult
      ? "Composer did not return exact dated episodes and the WNMU-FM archive does not yet cover this historical range."
      : [proxyError,directError].filter(Boolean).map((error)=>error instanceof Error ? error.message : String(error)).join(" ");
    return {
      entries:[],
      sourceType:proxyResult?.sourceType || "error",
      complete:false,
      supportsSpecials:false,
      coverageStart:"",
      coverageEnd:"",
      reason
    };
  }
}

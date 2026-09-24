import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const COMPOSER_BASE = "https://api.composer.nprstations.org/v1";
const WNMU_UCS = "53a98614e1c8aea6a62c55eb";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ARCHIVE_STALE_DAYS = 7;

const DAY_LOOKUP = new Map([
  ["sun",0],["sunday",0],["0",0],["7",0],
  ["mon",1],["monday",1],["1",1],
  ["tue",2],["tues",2],["tuesday",2],["2",2],
  ["wed",3],["wednesday",3],["3",3],
  ["thu",4],["thur",4],["thurs",4],["thursday",4],["4",4],
  ["fri",5],["friday",5],["5",5],
  ["sat",6],["saturday",6],["6",6]
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function dateValue(value: string) {
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(value: string,days: number) {
  const date=dateValue(value);
  if(!date) return "";
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function dayDistance(a: string,b: string) {
  const first=dateValue(a), second=dateValue(b);
  if(!first || !second) return Infinity;
  return Math.round(Math.abs(Number(second)-Number(first))/86400000);
}

function detroitDate() {
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Detroit",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(new Date());
  const values=Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function composerJson(target: string) {
  const response = await fetch(target, { headers: { Accept: "application/json" } });
  if (!response.ok) return { ok:false, status:response.status, payload:null };
  return { ok:true, status:response.status, payload:await response.json() };
}

function dbHeaders(extra: Record<string,string> = {}) {
  return {
    apikey:SERVICE_ROLE_KEY,
    Authorization:`Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":"application/json",
    ...extra
  };
}

async function dbRequest(path: string, init: RequestInit = {}) {
  if(!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Schedule archive database credentials are unavailable.");
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    ...init,
    headers:{...dbHeaders(),...(init.headers || {})}
  });
  const text=await response.text();
  if(!response.ok) throw new Error(`Schedule archive database request failed (${response.status}): ${text.slice(0,300)}`);
  if(!text) return null;
  return JSON.parse(text);
}

async function sha256(value: unknown) {
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}

async function archiveCatalog(payload: unknown, sourceUrl: string) {
  try {
    const capturedAt=new Date().toISOString();
    const captureDate=detroitDate();
    const payloadHash=await sha256(payload);
    const existing=await dbRequest(
      `wnmufm_schedule_catalog_versions?select=id,payload_hash&payload_hash=eq.${payloadHash}&limit=1`
    ) as Array<{id:number,payload_hash:string}>;
    let version=existing?.[0];

    if(version?.id) {
      await dbRequest(
        `wnmufm_schedule_catalog_versions?id=eq.${version.id}`,
        {
          method:"PATCH",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify({
            source_url:sourceUrl,
            last_seen_at:capturedAt
          })
        }
      );
    } else {
      const inserted=await dbRequest(
        "wnmufm_schedule_catalog_versions?select=id,payload_hash",
        {
          method:"POST",
          headers:{Prefer:"return=representation"},
          body:JSON.stringify({
            payload_hash:payloadHash,
            payload,
            source_url:sourceUrl,
            first_seen_at:capturedAt,
            last_seen_at:capturedAt
          })
        }
      ) as Array<{id:number,payload_hash:string}>;
      version=inserted?.[0];
    }

    if(!version?.id) throw new Error("Schedule catalog archive did not return a version id.");

    await dbRequest(
      "wnmufm_schedule_daily_archive?on_conflict=capture_date",
      {
        method:"POST",
        headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
        body:JSON.stringify({
          capture_date:captureDate,
          captured_at:capturedAt,
          catalog_version_id:version.id
        })
      }
    );
    return { archived:true, captureDate, payloadHash, versionId:version.id };
  } catch(error) {
    console.error("WNMU-FM schedule archive write failed",error);
    return { archived:false, error:error instanceof Error ? error.message : String(error) };
  }
}

function timePart(value: unknown) {
  if (!value) return null;
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2,"0")}:${match[2]}`;
}

function datePart(value: unknown) {
  if(!value) return null;
  const match=String(value).match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function truthy(value: unknown) {
  if(value===true || value===1) return true;
  return ["true","1","yes"].includes(String(value || "").trim().toLowerCase());
}

function recurrenceDateBounds(recurrence: Record<string,unknown>) {
  const start=datePart(recurrence.start_date || recurrence._start_date || recurrence.startDate);
  const noEnd=truthy(recurrence.no_end_date || recurrence.noEndDate);
  const end=noEnd ? null : datePart(recurrence.end_date || recurrence._end_date || recurrence.endDate);
  return {start,end};
}

function parseRecurrence(value: unknown): Record<string,unknown> | null {
  if (!value) return null;
  if (typeof value === "object") return value as Record<string,unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed=JSON.parse(value);
    return parsed && typeof parsed==="object" ? parsed as Record<string,unknown> : null;
  } catch {
    return null;
  }
}

function parseDays(value: unknown): Set<number> {
  if(Array.isArray(value)) {
    return new Set(value.flatMap((item)=>[...parseDays(item)]));
  }
  if(value===null || value===undefined) return new Set();
  if(typeof value==="number") {
    if(value>=0 && value<=7) return new Set([value===7 ? 0 : value]);
    return new Set();
  }
  const text=String(value).trim().toLowerCase();
  if(!text) return new Set();
  if(text.includes("weekday")) return new Set([1,2,3,4,5]);
  if(text.includes("weekend")) return new Set([0,6]);

  const found=new Set<number>();
  text.split(/[\s,;|/]+/).filter(Boolean).forEach((token)=>{
    const cleaned=token.replace(/[^a-z0-9]/g,"");
    if(DAY_LOOKUP.has(cleaned)) found.add(DAY_LOOKUP.get(cleaned)!);
  });
  return found;
}

function recurrenceDays(recurrence: Record<string,unknown>) {
  const candidates=[
    recurrence.days,
    recurrence.day,
    recurrence.weekdays,
    recurrence.weekday,
    recurrence.dow,
    recurrence._days,
    recurrence.day_of_week
  ];
  for(const candidate of candidates) {
    const days=parseDays(candidate);
    if(days.size) return days;
  }
  return new Set<number>();
}

function textValue(value: unknown): string {
  if(Array.isArray(value)) {
    return value.map(textValue).find(Boolean) || "";
  }
  if(value && typeof value==="object") {
    const item=value as Record<string,unknown>;
    return String(item.name || item.title || item.label || item.value || "").trim();
  }
  return typeof value==="string" ? value.trim() : "";
}

function programGenre(program: Record<string,unknown>) {
  const candidates=[
    program.genre,
    program.genres,
    program.category,
    program.categories,
    program.format,
    program.program_type,
    program.content_type
  ];
  return candidates.map(textValue).find(Boolean) || "";
}

function normalizeProgramsForDate(payload: unknown,dateText: string) {
  const body=payload as Record<string,unknown> | null;
  const programs=Array.isArray(payload) ? payload
    : Array.isArray(body?.programs) ? body!.programs as unknown[]
    : Array.isArray(body?.results) ? body!.results as unknown[]
    : [];
  const date=dateValue(dateText);
  if(!date) return [];
  const day=date.getUTCDay();
  const output:Array<{date:string,start:string,end:string,program:string,genre:string}>=[];

  programs.forEach((rawProgram)=>{
    if(!rawProgram || typeof rawProgram!=="object") return;
    const program=rawProgram as Record<string,unknown>;
    const recurrences=Array.isArray(program.recurrences) ? program.recurrences : [];
    recurrences.forEach((rawRecurrence)=>{
      const recurrence=parseRecurrence(rawRecurrence);
      if(!recurrence) return;
      const start=timePart(recurrence.start || recurrence._start || recurrence.start_time || recurrence.time);
      const end=timePart(recurrence.end || recurrence._end || recurrence.end_time);
      const days=recurrenceDays(recurrence);
      const bounds=recurrenceDateBounds(recurrence);
      if(!start || !end || !days.has(day)) return;
      if(bounds.start && dateText<bounds.start) return;
      if(bounds.end && dateText>bounds.end) return;
      output.push({
        date:dateText,
        start,
        end,
        program:String(program.name || program.title || "Unknown program"),
        genre:programGenre(program)
      });
    });
  });

  output.sort((a,b)=>a.start.localeCompare(b.start) || a.program.localeCompare(b.program));
  return output;
}

async function loadArchiveRange(start: string,end: string) {
  try {
    const captures=await dbRequest(
      "wnmufm_schedule_daily_archive?select=capture_date,catalog_version_id&order=capture_date.asc&limit=1000"
    ) as Array<{capture_date:string,catalog_version_id:number}>;
    if(!captures?.length) return null;

    const versionIds=[...new Set(captures.map((item)=>Number(item.catalog_version_id)).filter(Number.isFinite))];
    if(!versionIds.length) return null;
    const versions=await dbRequest(
      `wnmufm_schedule_catalog_versions?select=id,payload,payload_hash&id=in.(${versionIds.join(",")})`
    ) as Array<{id:number,payload:unknown,payload_hash:string}>;
    const versionById=new Map(versions.map((item)=>[Number(item.id),item]));
    const sortedCaptures=[...captures].sort((a,b)=>a.capture_date.localeCompare(b.capture_date));

    const entries:Array<{date:string,start:string,end:string,program:string,genre:string}>=[];
    const missingDates:string[]=[];
    const staleDates:string[]=[];
    const preCaptureDates:string[]=[];
    let coverageStart="";
    let coverageEnd="";
    const firstCapture=sortedCaptures[0] || null;

    for(let dateText=start;dateText<=end;dateText=addDays(dateText,1)) {
      const candidates=sortedCaptures.filter((capture)=>capture.capture_date<=dateText);
      let capture=candidates.at(-1);
      if(!capture && firstCapture && dateText<firstCapture.capture_date) {
        capture=firstCapture;
        preCaptureDates.push(dateText);
      }
      if(!capture) {
        missingDates.push(dateText);
        continue;
      }
      if(dateText>=capture.capture_date && dayDistance(capture.capture_date,dateText)>ARCHIVE_STALE_DAYS) {
        missingDates.push(dateText);
        continue;
      }
      const version=versionById.get(Number(capture.catalog_version_id));
      if(!version) {
        missingDates.push(dateText);
        continue;
      }
      if(capture.capture_date!==dateText) staleDates.push(dateText);
      entries.push(...normalizeProgramsForDate(version.payload,dateText));
      if(!coverageStart) coverageStart=dateText;
      coverageEnd=dateText;
    }

    if(!entries.length || !coverageStart || !coverageEnd) return null;
    return {
      entries,
      coverageStart,
      coverageEnd,
      missingDates,
      staleDates,
      preCaptureDates,
      complete:missingDates.length===0
    };
  } catch(error) {
    console.error("WNMU-FM schedule archive read failed",error);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "GET required" }, 405);

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!validDate(start) || !validDate(end)) return json({ error: "start and end must be YYYY-MM-DD" }, 400);

  const historical = `${COMPOSER_BASE}/ucs/${WNMU_UCS}/${start},${end}/episodes`;
  try {
    const result = await composerJson(historical);
    if (result.ok) return json({ source: historical, source_type:"episodes", payload:result.payload });
  } catch {
    // Fall through to the recurring catalog and our own archive.
  }

  const programs = `${COMPOSER_BASE}/ucs/${WNMU_UCS}/programs`;
  try {
    const result = await composerJson(programs);
    if (!result.ok) return json({ error:`Composer program schedule returned HTTP ${result.status}.` }, result.status);

    const archiveWrite=await archiveCatalog(result.payload,programs);
    const archived=await loadArchiveRange(start!,end!);
    if(archived?.entries.length) {
      return json({
        source:"WNMU-FM archived Composer recurring schedule",
        source_type:archived.complete ? "archive_recurrences" : "archive_recurrences_partial",
        note:archived.complete
          ? "Composer historical episodes were unavailable; reconstructing the recurring schedule from WNMU-FM's archived Composer recurrence definitions and their effective dates."
          : "Composer historical episodes were unavailable; reconstructing the covered portion of the recurring schedule from WNMU-FM's archived Composer recurrence definitions and their effective dates.",
        archive_start:archived.coverageStart,
        archive_end:archived.coverageEnd,
        archive_missing_dates:archived.missingDates.length,
        archive_stale_dates:archived.staleDates.length,
        archive_pre_capture_dates:archived.preCaptureDates.length,
        archive_write:archiveWrite.archived,
        payload:archived.entries
      });
    }

    return json({
      source: programs,
      source_type:"recurrences",
      note:"Historical episode access was unavailable and WNMU-FM has not yet archived this historical range; using Composer's current recurring program schedule only as a present-day reference.",
      archive_write:archiveWrite.archived,
      payload:result.payload
    });
  } catch (error) {
    return json({ error:error instanceof Error ? error.message : String(error) }, 502);
  }
});

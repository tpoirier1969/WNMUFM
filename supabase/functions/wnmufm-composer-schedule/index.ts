import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const COMPOSER_BASE = "https://api.composer.nprstations.org/v1";
const WNMU_UCS = "53a98614e1c8aea6a62c55eb";
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

async function composerJson(target: string) {
  const response = await fetch(target, { headers: { Accept: "application/json" } });
  if (!response.ok) return { ok:false, status:response.status, payload:null };
  return { ok:true, status:response.status, payload:await response.json() };
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
    // Fall through to the public recurring schedule.
  }

  const programs = `${COMPOSER_BASE}/ucs/${WNMU_UCS}/programs`;
  try {
    const result = await composerJson(programs);
    if (result.ok) return json({
      source: programs,
      source_type:"recurrences",
      note:"Historical episode access was unavailable; using Composer's public recurring program schedule.",
      payload:result.payload
    });
    return json({ error:`Composer program schedule returned HTTP ${result.status}.` }, result.status);
  } catch (error) {
    return json({ error:error instanceof Error ? error.message : String(error) }, 502);
  }
});

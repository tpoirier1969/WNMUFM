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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "GET required" }, 405);

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!validDate(start) || !validDate(end)) return json({ error: "start and end must be YYYY-MM-DD" }, 400);

  const targets = [
    `${COMPOSER_BASE}/ucs/${WNMU_UCS}/${start},${end}/episodes`,
    `${COMPOSER_BASE}/episode/search?ucs=${encodeURIComponent(WNMU_UCS)}&start=${encodeURIComponent(start!)}&end=${encodeURIComponent(end!)}&limit=1000&order=asc`
  ];

  let lastStatus = 502;
  let lastMessage = "Composer schedule lookup failed.";

  for (const target of targets) {
    try {
      const response = await fetch(target, { headers: { Accept: "application/json" } });
      lastStatus = response.status;
      if (!response.ok) {
        lastMessage = `Composer returned HTTP ${response.status}.`;
        continue;
      }
      const payload = await response.json();
      return json({ source: target, payload });
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }
  }

  return json({ error: lastMessage }, lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502);
});

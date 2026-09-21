import { CONFIG } from "./config.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function datePart(value) {
  if (!value) return null;
  const match = String(value).match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function timePart(value) {
  if (!value) return null;
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function minutes(value) {
  const time = timePart(value);
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function programName(episode) {
  if (episode?.program && typeof episode.program === "object") {
    return episode.program.name || episode.program.title || episode.program.program_name || "Unknown program";
  }
  if (typeof episode?.program === "string" && episode.program.trim()) {
    try {
      const parsed = JSON.parse(episode.program);
      return parsed?.name || parsed?.title || episode.program;
    } catch {
      return episode.program;
    }
  }
  return episode?.program_name || episode?.name || "Unknown program";
}

function airtimeObjects(episode) {
  const candidates = [];
  const value = episode?.airtime;

  if (Array.isArray(value)) candidates.push(...value);
  else if (value && typeof value === "object") candidates.push(value);
  else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) candidates.push(...parsed);
      else if (parsed && typeof parsed === "object") candidates.push(parsed);
    } catch {
      candidates.push({ raw: value });
    }
  }

  if (!candidates.length && (episode?.date || episode?.start || episode?.end)) {
    candidates.push({ date: episode.date, start: episode.start, end: episode.end });
  }
  return candidates;
}

function normalizeAirtime(episode, airtime) {
  const raw = airtime?.raw || "";
  const date = datePart(airtime?.date || airtime?._date || airtime?.start || raw);
  const start = timePart(airtime?.start || airtime?._start || airtime?.start_time || raw);
  const end = timePart(airtime?.end || airtime?._end || airtime?.end_time);
  if (!date || !start) return null;
  return {
    date,
    start,
    end: end || start,
    program: programName(episode)
  };
}

export function normalizeComposerEpisodes(payload) {
  const episodes = Array.isArray(payload) ? payload
    : Array.isArray(payload?.episodes) ? payload.episodes
    : Array.isArray(payload?.results) ? payload.results
    : [];
  const output = [];
  episodes.forEach((episode) => {
    airtimeObjects(episode).forEach((airtime) => {
      const normalized = normalizeAirtime(episode, airtime);
      if (normalized) output.push(normalized);
    });
  });
  return output;
}

function compactDays(daySet) {
  const days = [...daySet].sort((a, b) => a - b);
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Mon–Fri";
  if (key === "0,6") return "Sat–Sun";
  if (key === "1,2,3,4") return "Mon–Thu";
  return days.map((day) => DAY_NAMES[day]).join(", ");
}

export function buildHourSchedule(entries) {
  const buckets = new Map();
  for (let hour = 0; hour < 24; hour += 1) {
    buckets.set(`weekday|${String(hour).padStart(2, "0")}`, new Map());
    buckets.set(`weekend|${String(hour).padStart(2, "0")}`, new Map());
  }

  entries.forEach((entry) => {
    const date = new Date(`${entry.date}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return;
    const day = date.getUTCDay();
    const weekpart = day === 0 || day === 6 ? "weekend" : "weekday";
    const start = minutes(entry.start);
    let end = minutes(entry.end);
    if (start === null || end === null) return;
    if (end <= start) end += 24 * 60;

    for (let hour = 0; hour < 24; hour += 1) {
      const hourStart = hour * 60;
      const hourEnd = hourStart + 60;
      const overlaps = start < hourEnd && end > hourStart;
      const wrapsOverlap = end > 24 * 60 && (hourStart + 24 * 60) < end && (hourEnd + 24 * 60) > start;
      if (!overlaps && !wrapsOverlap) continue;
      const key = `${weekpart}|${String(hour).padStart(2, "0")}`;
      const programs = buckets.get(key);
      if (!programs.has(entry.program)) programs.set(entry.program, new Set());
      programs.get(entry.program).add(day);
    }
  });

  const result = new Map();
  buckets.forEach((programs, key) => {
    const labels = [...programs.entries()]
      .map(([name, days]) => `${name} (${compactDays(days)})`)
      .sort((a, b) => a.localeCompare(b));
    result.set(key, labels.join("; "));
  });
  return result;
}

async function fetchComposerJson(url) {
  const response = await fetch(url.toString(), { mode: "cors", cache: "no-store" });
  if (!response.ok) throw new Error(`Composer schedule lookup failed (${response.status}).`);
  return response.json();
}

export async function fetchComposerSchedule(startDate, endDate) {
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

  let lastError = null;
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

export function hourLabel(hour) {
  const number = Number(hour);
  const suffix = number < 12 ? "a.m." : "p.m.";
  const display = number % 12 || 12;
  return `${display} ${suffix}`;
}

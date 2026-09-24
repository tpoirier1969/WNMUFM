const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LOOKUP = new Map([
  ["sun",0],["sunday",0],["0",0],["7",0],
  ["mon",1],["monday",1],["1",1],
  ["tue",2],["tues",2],["tuesday",2],["2",2],
  ["wed",3],["wednesday",3],["3",3],
  ["thu",4],["thur",4],["thurs",4],["thursday",4],["4",4],
  ["fri",5],["friday",5],["5",5],
  ["sat",6],["saturday",6],["6",6]
]);

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

function textValue(value) {
  if (Array.isArray(value)) {
    const first=value.map(textValue).find(Boolean);
    return first || "";
  }
  if (value && typeof value === "object") {
    return String(value.name || value.title || value.label || value.value || "").trim();
  }
  return typeof value === "string" ? value.trim() : "";
}

function programGenre(source) {
  let program = source?.program;
  if (typeof program === "string" && program.trim()) {
    try {
      const parsed=JSON.parse(program);
      program=parsed && typeof parsed === "object" ? parsed : source;
    } catch {
      program=source;
    }
  } else if (!program || typeof program !== "object") {
    program=source;
  }
  const candidates = [
    program?.genre,
    program?.genres,
    program?.category,
    program?.categories,
    program?.format,
    program?.program_type,
    program?.content_type,
    source?.genre,
    source?.category
  ];
  return candidates.map(textValue).find(Boolean) || "";
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
    program: programName(episode),
    genre: programGenre(episode)
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

function parseRecurrence(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function parseDays(value) {
  if (Array.isArray(value)) {
    return new Set(value.flatMap((item) => [...parseDays(item)]));
  }
  if (value === null || value === undefined) return new Set();
  if (typeof value === "number") {
    if (value >= 0 && value <= 7) return new Set([value === 7 ? 0 : value]);
    return new Set();
  }

  const text = String(value).trim().toLowerCase();
  if (!text) return new Set();
  if (text.includes("weekday")) return new Set([1,2,3,4,5]);
  if (text.includes("weekend")) return new Set([0,6]);

  const found = new Set();
  text.split(/[\s,;|/]+/).filter(Boolean).forEach((token) => {
    const cleaned = token.replace(/[^a-z0-9]/g, "");
    if (DAY_LOOKUP.has(cleaned)) found.add(DAY_LOOKUP.get(cleaned));
  });
  return found;
}

function recurrenceDays(recurrence) {
  const candidates = [
    recurrence?.days,
    recurrence?.day,
    recurrence?.weekdays,
    recurrence?.weekday,
    recurrence?.dow,
    recurrence?._days,
    recurrence?.day_of_week
  ];
  for (const candidate of candidates) {
    const days = parseDays(candidate);
    if (days.size) return days;
  }
  return new Set();
}

function truthy(value) {
  if(value===true || value===1) return true;
  return ["true","1","yes"].includes(String(value || "").trim().toLowerCase());
}

function recurrenceDateBounds(recurrence) {
  const start=datePart(recurrence?.start_date || recurrence?._start_date || recurrence?.startDate);
  const noEnd=truthy(recurrence?.no_end_date || recurrence?.noEndDate);
  const end=noEnd ? null : datePart(recurrence?.end_date || recurrence?._end_date || recurrence?.endDate);
  return {start,end};
}

function addDays(dateText, amount) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0,10);
}

export function normalizeComposerPrograms(payload, startDate, endDate) {
  const programs = Array.isArray(payload) ? payload
    : Array.isArray(payload?.programs) ? payload.programs
    : Array.isArray(payload?.results) ? payload.results
    : [];
  const output = [];

  programs.forEach((program) => {
    const recurrences = Array.isArray(program?.recurrences) ? program.recurrences : [];
    recurrences.forEach((rawRecurrence) => {
      const recurrence = parseRecurrence(rawRecurrence);
      if (!recurrence) return;
      const start = timePart(recurrence.start || recurrence._start || recurrence.start_time || recurrence.time);
      const end = timePart(recurrence.end || recurrence._end || recurrence.end_time);
      const days = recurrenceDays(recurrence);
      if (!start || !end || !days.size) return;

      const bounds=recurrenceDateBounds(recurrence);
      const effectiveStart=bounds.start && bounds.start>startDate ? bounds.start : startDate;
      const effectiveEnd=bounds.end && bounds.end<endDate ? bounds.end : endDate;
      if(effectiveStart>effectiveEnd) return;

      for (let dateText = effectiveStart; dateText <= effectiveEnd; dateText = addDays(dateText, 1)) {
        const date = new Date(`${dateText}T12:00:00Z`);
        if (!days.has(date.getUTCDay())) continue;
        output.push({
          date: dateText,
          start,
          end,
          program: program?.name || program?.title || "Unknown program",
          genre: programGenre(program)
        });
      }
    });
  });

  output.sort((a,b) =>
    String(a.date).localeCompare(String(b.date)) ||
    String(a.start).localeCompare(String(b.start)) ||
    String(a.program).localeCompare(String(b.program))
  );
  return output;
}

export function entryHourDayOffset(entry, hour) {
  const start = minutes(entry.start);
  const rawEnd = minutes(entry.end);
  if (start === null || rawEnd === null || rawEnd === start) return null;
  const wraps = rawEnd < start;
  const end = wraps ? rawEnd + 24 * 60 : rawEnd;
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;
  if (start < hourEnd && end > hourStart) return 0;
  if (wraps) {
    const shiftedStart=hourStart + 24 * 60;
    const shiftedEnd=hourEnd + 24 * 60;
    if (start < shiftedEnd && end > shiftedStart) return 1;
  }
  return null;
}

function dominantLabel(values, total, threshold) {
  if (!values.length || !total) return null;
  const counts=new Map();
  values.forEach((value)=>counts.set(value,(counts.get(value)||0)+1));
  const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
  const [label,count]=ranked[0] || [];
  if(!label || count/total < threshold) return null;
  return { label, count, share:count/total };
}

export function buildTypicalHourContext(entries, { titleThreshold = 0.7, genreThreshold = 0.75, minimumSamples = 4 } = {}) {
  const result=new Map();
  for(const weekpart of ["weekday","weekend"]) {
    for(let hour=0;hour<24;hour+=1) {
      const matches=(entries || []).filter((entry)=>{
        const dayOffset=entryHourDayOffset(entry,hour);
        if(dayOffset===null) return false;
        const date=new Date(`${entry.date}T12:00:00Z`);
        if(Number.isNaN(date.getTime())) return false;
        date.setUTCDate(date.getUTCDate()+dayOffset);
        const day=date.getUTCDay();
        const isWeekend=day===0 || day===6;
        return (weekpart==="weekend") === isWeekend;
      });
      if(matches.length < minimumSamples) continue;

      const titles=matches
        .map((entry)=>String(entry.program || "").trim())
        .filter((value)=>value && value.toLowerCase() !== "unknown program");
      const title=dominantLabel(titles,matches.length,titleThreshold);
      if(title) {
        result.set(`${weekpart}|${String(hour).padStart(2,"0")}`,{
          type:"program",
          label:title.label,
          share:title.share,
          samples:matches.length
        });
        continue;
      }

      const genres=matches.map((entry)=>String(entry.genre || "").trim()).filter(Boolean);
      const genre=dominantLabel(genres,matches.length,genreThreshold);
      if(genre) {
        result.set(`${weekpart}|${String(hour).padStart(2,"0")}`,{
          type:"genre",
          label:genre.label,
          share:genre.share,
          samples:matches.length
        });
      }
    }
  }
  return result;
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
    for (let hour = 0; hour < 24; hour += 1) {
      const dayOffset=entryHourDayOffset(entry,hour);
      if(dayOffset===null) continue;
      const date = new Date(`${entry.date}T12:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      date.setUTCDate(date.getUTCDate()+dayOffset);
      const day = date.getUTCDay();
      const weekpart = day === 0 || day === 6 ? "weekend" : "weekday";
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

export function hourLabel(hour) {
  const number = Number(hour);
  const suffix = number < 12 ? "a.m." : "p.m.";
  const display = number % 12 || 12;
  return `${display} ${suffix}`;
}

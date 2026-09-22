// Calendar context that can plausibly change listening behavior or normal programming.
// Curated civic-address dates are source facts, not political judgments.
// Tags provide context only; they do not prove WNMU-FM changed its schedule on that date.

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month, day, 12));
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(year, month, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayOfMonth(year, month, weekday) {
  const last = utcDate(year, month + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utcDate(year, month, last.getUTCDate() - offset);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function federalElectionDay(year) {
  const firstMonday = nthWeekdayOfMonth(year, 10, 1, 1);
  return utcDate(year, 10, firstMonday.getUTCDate() + 1);
}

const CURATED_CIVIC_DATES = [
  { date:"2025-02-26", name:"Michigan State of the State", kind:"civic-address", windowDays:0 },
  { date:"2025-11-04", name:"Michigan local election day", kind:"election", windowDays:1 },
  { date:"2026-02-24", name:"State of the Union", kind:"civic-address", windowDays:0 },
  { date:"2026-02-25", name:"Michigan State of the State", kind:"civic-address", windowDays:0 },
  { date:"2026-08-04", name:"Michigan primary election", kind:"election", windowDays:1 }
];

export function notableDatesForYear(year) {
  const dates = [
    { name:"New Year\'s Day", date:utcDate(year,0,1), kind:"holiday", windowDays:3 },
    { name:"Easter", date:easterSunday(year), kind:"holiday", windowDays:3 },
    { name:"Memorial Day", date:lastWeekdayOfMonth(year,4,1), kind:"holiday", windowDays:3 },
    { name:"Independence Day", date:utcDate(year,6,4), kind:"holiday", windowDays:3 },
    { name:"Labor Day", date:nthWeekdayOfMonth(year,8,1,1), kind:"holiday", windowDays:3 },
    { name:"Thanksgiving", date:nthWeekdayOfMonth(year,10,4,4), kind:"holiday", windowDays:3 },
    { name:"Christmas Day", date:utcDate(year,11,25), kind:"holiday", windowDays:3 }
  ];
  if (year % 2 === 0) dates.push({ name:"Federal Election Day", date:federalElectionDay(year), kind:"election", windowDays:1 });
  CURATED_CIVIC_DATES.filter((item) => item.date.startsWith(String(year) + "-")).forEach((item) => {
    dates.push({ ...item, date:new Date(item.date + "T12:00:00Z") });
  });
  return dates.sort((a,b) => a.date - b.date);
}

export function notableDateContext(value) {
  if (!value) return null;
  const date = new Date(String(value) + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return null;
  let nearest = null;
  for (const year of [date.getUTCFullYear() - 1, date.getUTCFullYear(), date.getUTCFullYear() + 1]) {
    for (const item of notableDatesForYear(year)) {
      const delta = Math.round((date - item.date) / 86400000);
      if (Math.abs(delta) > Number(item.windowDays ?? 0)) continue;
      if (!nearest || Math.abs(delta) < Math.abs(nearest.delta) || (Math.abs(delta) === Math.abs(nearest.delta) && item.kind !== "holiday")) {
        nearest = { name:item.name, kind:item.kind, delta, date:item.date.toISOString().slice(0,10) };
      }
    }
  }
  return nearest;
}

export function matchesNotableDateMode(value, mode = "all") {
  if (mode === "all") return true;
  const notable = Boolean(notableDateContext(value));
  if (mode === "exclude") return !notable;
  if (mode === "only") return notable;
  return true;
}

export function notableContextLabel(context) {
  if (!context) return "";
  if (context.delta === 0) return context.name;
  const count = Math.abs(context.delta);
  return count + " day" + (count === 1 ? "" : "s") + " " + (context.delta < 0 ? "before" : "after") + " " + context.name;
}

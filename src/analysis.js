export function isWeekendDate(value) {
  if (!value) return false;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function periodIsComplete(periodEnd, reportRunDate) {
  if (!periodEnd || !reportRunDate) return true;
  return String(periodEnd) < String(reportRunDate);
}

export function formatDayDate(value, { year = true } = {}) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC"
  });
}

export function formatMonth(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 7)}-01T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatPeriod(row, grain = row?.grain) {
  if (!row?.period_start) return "No dated data";
  if (grain === "month") return formatMonth(row.period_start);
  if (grain === "week") {
    return `Week of ${formatDayDate(row.period_start)} – ${formatDayDate(row.period_end)}`;
  }
  if (row.period_start === row.period_end) return formatDayDate(row.period_start);
  return `${formatDayDate(row.period_start)} – ${formatDayDate(row.period_end)}`;
}

export function shortDayLabel(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  const weekday = date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}


export function matchesWeekpart(value, filter = "all") {
  if (!value || filter === "all") return true;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getUTCDay();
  if (filter === "weekday") return day >= 1 && day <= 5;
  if (filter === "weekend") return day === 0 || day === 6;
  const named = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
  return named[filter] === day;
}


export function median(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

export function percentFromMedian(value, medianValue) {
  const number = Number(value);
  const baseline = Number(medianValue);
  if (!Number.isFinite(number) || !Number.isFinite(baseline) || baseline === 0) return null;
  return ((number - baseline) / baseline) * 100;
}

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

function holidayDates(year) {
  return [
    ["New Year's Day", utcDate(year, 0, 1)],
    ["Easter", easterSunday(year)],
    ["Memorial Day", lastWeekdayOfMonth(year, 4, 1)],
    ["Independence Day", utcDate(year, 6, 4)],
    ["Labor Day", nthWeekdayOfMonth(year, 8, 1, 1)],
    ["Thanksgiving", nthWeekdayOfMonth(year, 10, 4, 4)],
    ["Christmas", utcDate(year, 11, 25)]
  ];
}

export function holidayContext(value, windowDays = 3) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  let nearest = null;
  for (const year of [date.getUTCFullYear() - 1, date.getUTCFullYear(), date.getUTCFullYear() + 1]) {
    for (const [name, holiday] of holidayDates(year)) {
      const delta = Math.round((date - holiday) / 86400000);
      if (Math.abs(delta) <= windowDays && (!nearest || Math.abs(delta) < Math.abs(nearest.delta))) {
        nearest = { name, delta, holiday: holiday.toISOString().slice(0,10) };
      }
    }
  }
  return nearest;
}

export function matchesHolidayMode(value, mode = "all") {
  if (mode === "all") return true;
  const nearby = Boolean(holidayContext(value));
  if (mode === "exclude") return !nearby;
  if (mode === "only") return nearby;
  return true;
}

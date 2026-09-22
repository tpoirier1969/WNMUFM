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
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${weekday} ${date.getUTCMonth() + 1}/${date.getUTCDate()}/${year}`;
}

export function shortMonthLabel(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 7)}-01T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  const month = date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  return `${month} '${String(date.getUTCFullYear()).slice(-2)}`;
}

export function periodWithinRange(row, startDate = "", endDate = "") {
  if (!row?.period_start || !row?.period_end) return false;
  if (startDate && String(row.period_start) < String(startDate)) return false;
  if (endDate && String(row.period_end) > String(endDate)) return false;
  return true;
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

export function indexToMedian(value, medianValue) {
  const number = Number(value);
  const baseline = Number(medianValue);
  if (!Number.isFinite(number) || !Number.isFinite(baseline) || baseline === 0) return null;
  return (number / baseline) * 100;
}


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

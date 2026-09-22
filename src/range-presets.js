function parseIso(value) {
  const date = new Date(String(value || "") + "T12:00:00Z");
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(date) {
  return date.toISOString().slice(0,10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonthsClamped(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day,lastDay));
  return target;
}

function clampRange(startDate, endDate, available) {
  const start = startDate < available.startDate ? available.startDate : startDate;
  const end = endDate > available.endDate ? available.endDate : endDate;
  if (!start || !end || start > end) return null;
  return { startDate:start, endDate:end };
}

function yearRange(year) {
  return { startDate:`${year}-01-01`, endDate:`${year}-12-31` };
}

function seasonRanges(year) {
  const previous = year - 1;
  const next = year + 1;
  return [
    { key:"winter", label:`Winter ${previous}–${String(year).slice(-2)}`, startDate:`${previous}-12-01`, endDate:`${year}-02-${new Date(Date.UTC(year,2,0,12)).getUTCDate()}` },
    { key:"spring", label:`Spring ${year}`, startDate:`${year}-03-01`, endDate:`${year}-05-31` },
    { key:"summer", label:`Summer ${year}`, startDate:`${year}-06-01`, endDate:`${year}-08-31` },
    { key:"fall", label:`Fall ${year}`, startDate:`${year}-09-01`, endDate:`${year}-11-30` },
    { key:"winter-next", label:`Winter ${year}–${String(next).slice(-2)}`, startDate:`${year}-12-01`, endDate:`${next}-02-${new Date(Date.UTC(next,2,0,12)).getUTCDate()}` }
  ];
}

export function buildRangePresets(available) {
  if (!available?.startDate || !available?.endDate) return [];
  const end = parseIso(available.endDate);
  if (!end) return [];
  const year = end.getUTCFullYear();

  const rolling = [3,6,9].map((months) => {
    const start = addDays(addMonthsClamped(end,-months),1);
    return {
      key:`last-${months}m`,
      label:`Last ${months} months`,
      ...clampRange(iso(start),available.endDate,available)
    };
  }).filter((item)=>item.startDate && item.endDate);

  const thisYear = clampRange(yearRange(year).startDate,yearRange(year).endDate,available);
  const lastYear = clampRange(yearRange(year-1).startDate,yearRange(year-1).endDate,available);

  const calendar = [
    { key:"this-year", label:`This year (${year})`, ...thisYear },
    ...(lastYear ? [{ key:"last-year", label:`Last year (${year-1})`, ...lastYear }] : [])
  ].filter((item)=>item.startDate && item.endDate);

  const seasons = seasonRanges(year)
    .map((season) => {
      const clipped = clampRange(season.startDate,season.endDate,available);
      return clipped ? { ...season, ...clipped } : null;
    })
    .filter(Boolean);

  return [
    { key:"full", label:"Full range", startDate:available.startDate, endDate:available.endDate },
    ...rolling,
    ...calendar,
    ...seasons
  ];
}

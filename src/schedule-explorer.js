const SHORT_DAY_NAMES=Object.freeze(["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]);

function dateValue(value) {
  const date=new Date(`${String(value || "")}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addScheduleDays(value,days) {
  const date=dateValue(value);
  if(!date) return "";
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function weekday(value) {
  const date=dateValue(value);
  return date ? date.getUTCDay() : null;
}

function monthKey(value) {
  return /^\d{4}-\d{2}/.test(String(value || "")) ? String(value).slice(0,7) : "";
}

function monthStart(value) {
  const key=monthKey(value);
  return key ? `${key}-01` : "";
}

function monthEnd(value) {
  const start=dateValue(monthStart(value));
  if(!start) return "";
  start.setUTCMonth(start.getUTCMonth()+1);
  start.setUTCDate(0);
  return start.toISOString().slice(0,10);
}

function weekStart(value) {
  const date=dateValue(value);
  if(!date) return "";
  date.setUTCDate(date.getUTCDate()-date.getUTCDay());
  return date.toISOString().slice(0,10);
}

export function scheduleViewRange(view,date) {
  if(!dateValue(date)) return {startDate:"",endDate:"",displayStart:"",displayEnd:""};
  if(view==="day") return {startDate:date,endDate:date,displayStart:date,displayEnd:date};
  if(view==="week") {
    const start=weekStart(date);
    return {startDate:start,endDate:addScheduleDays(start,6),displayStart:start,displayEnd:addScheduleDays(start,6)};
  }
  const first=monthStart(date);
  const last=monthEnd(date);
  const start=weekStart(first);
  const lastDate=dateValue(last);
  const end=lastDate ? addScheduleDays(last,6-lastDate.getUTCDay()) : last;
  return {startDate:start,endDate:end,displayStart:first,displayEnd:last};
}

function timeMinutes(value) {
  const match=String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if(!match) return null;
  const hour=Number(match[1]), minute=Number(match[2]);
  if(hour<0 || hour>23 || minute<0 || minute>59) return null;
  return hour*60+minute;
}

function entryInterval(entry) {
  const start=timeMinutes(entry?.start);
  const rawEnd=timeMinutes(entry?.end);
  if(start===null || rawEnd===null) return null;
  if(rawEnd===start) return null;
  const end=rawEnd<start ? rawEnd+1440 : rawEnd;
  return {start,end};
}

function overlaps(first,second) {
  const a=entryInterval(first), b=entryInterval(second);
  if(!a || !b) return false;
  return a.start<b.end && b.start<a.end;
}

function normalizeEntry(row,{date,evidenceKind,sourceLabel,exact=false}={}) {
  return {
    date,
    start:String(row?.start ?? row?.start_time ?? "").slice(0,5),
    end:String(row?.end ?? row?.end_time ?? "").slice(0,5),
    program:String(row?.program ?? row?.program_title ?? "Unknown program"),
    genre:String(row?.genre || ""),
    evidenceKind,
    sourceLabel,
    exact,
    sourcePage:row?.source_page ?? null
  };
}

export function newsletterScheduleForDate(schedule,date) {
  const sources=schedule?.sources || [];
  const entries=schedule?.entries || [];
  const source=sources.find((item)=>monthKey(item.issue_month)===monthKey(date));
  const day=weekday(date);
  let base=[];
  if(source && day!==null) {
    base=entries
      .filter((row)=>row.entry_type==="monthly_grid" && Number(row.source_id)===Number(source.id) && Number(row.weekday)===day)
      .map((row)=>normalizeEntry(row,{
        date,
        evidenceKind:"newsletter-grid",
        sourceLabel:"Preview monthly grid",
        exact:false
      }));
  }

  const overrides=entries
    .filter((row)=>row.entry_type==="dated_override" && row.specific_date===date)
    .map((row)=>normalizeEntry(row,{
      date,
      evidenceKind:"newsletter-dated",
      sourceLabel:"Preview dated listing",
      exact:true
    }));

  if(!overrides.length) return base.sort(entrySort);
  const filteredBase=base.filter((item)=>!overrides.some((override)=>overlaps(item,override)));
  return [...filteredBase,...overrides].sort(entrySort);
}

function entrySort(a,b) {
  return String(a.start).localeCompare(String(b.start)) ||
    String(a.end).localeCompare(String(b.end)) ||
    String(a.program).localeCompare(String(b.program));
}

function composerEntriesForDate(composer,date,evidenceKind,sourceLabel,exact) {
  return (composer?.entries || [])
    .filter((row)=>row?.date===date)
    .map((row)=>normalizeEntry(row,{date,evidenceKind,sourceLabel,exact}))
    .sort(entrySort);
}

export function buildScheduleDay({date,newsletter,composer}={}) {
  if(!date) return {date:"",entries:[],sourceKind:"none",sourceLabel:"No schedule evidence"};
  if(composer?.sourceType==="episodes") {
    const exact=composerEntriesForDate(composer,date,"composer-exact","Exact Composer episodes",true);
    if(exact.length) return {date,entries:exact,sourceKind:"composer-exact",sourceLabel:"Exact Composer episodes"};
  }

  const preview=newsletterScheduleForDate(newsletter,date);
  if(preview.length) {
    const hasDated=preview.some((entry)=>entry.evidenceKind==="newsletter-dated");
    const hasGrid=preview.some((entry)=>entry.evidenceKind==="newsletter-grid");
    return {
      date,
      entries:preview,
      sourceKind:hasDated && hasGrid ? "newsletter-mixed" : hasDated ? "newsletter-dated" : "newsletter-grid",
      sourceLabel:hasDated && hasGrid ? "Preview grid + dated listing" : hasDated ? "Preview dated listing" : "Preview monthly grid"
    };
  }

  const archiveEntries=Array.isArray(composer?.archiveEntries)
    ? composer.archiveEntries
    : ["archive_recurrences","archive_recurrences_partial"].includes(composer?.sourceType) ? composer.entries : [];
  const archived=composerEntriesForDate({entries:archiveEntries},date,"composer-archive","Archived Composer recurrence",false);
  if(archived.length) return {date,entries:archived,sourceKind:"composer-archive",sourceLabel:"Archived Composer recurrence"};

  return {date,entries:[],sourceKind:"none",sourceLabel:"No schedule evidence"};
}

export function buildScheduleDays({startDate,endDate,newsletter,composer}={}) {
  if(!dateValue(startDate) || !dateValue(endDate) || startDate>endDate) return [];
  const days=[];
  for(let date=startDate;date<=endDate;date=addScheduleDays(date,1)) {
    days.push(buildScheduleDay({date,newsletter,composer}));
  }
  return days;
}

export function entriesAtTime(entries,time) {
  const minute=timeMinutes(time);
  if(minute===null) return [];
  return (entries || []).filter((entry)=>{
    const interval=entryInterval(entry);
    return interval && minute>=interval.start && minute<interval.end;
  });
}

function spilloverEntriesAtTime(previousEntries,time) {
  const minute=timeMinutes(time);
  if(minute===null) return [];
  const nextDayMinute=minute+1440;
  return (previousEntries || []).filter((entry)=>{
    const interval=entryInterval(entry);
    return interval && interval.end>1440 && nextDayMinute>=interval.start && nextDayMinute<interval.end;
  });
}

export function entriesAtTimeForDay(days,index,time,carryInEntries=[]) {
  const day=days?.[index];
  if(!day) return [];
  const current=entriesAtTime(day.entries,time);
  const previous=index>0
    ? spilloverEntriesAtTime(days[index-1]?.entries,time)
    : spilloverEntriesAtTime(carryInEntries,time);
  const seen=new Set();
  return [...previous,...current].filter((entry)=>{
    const key=[entry.date || "",entry.start || "",entry.end || "",entry.program || ""].join("|");
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

function formatDate(value,{weekdayName=false}={}) {
  const date=dateValue(value);
  if(!date) return String(value || "");
  return date.toLocaleDateString(undefined,{
    weekday:weekdayName ? "short" : undefined,
    month:"short",
    day:"numeric",
    year:"numeric",
    timeZone:"UTC"
  });
}

function formatMonth(value) {
  const date=dateValue(monthStart(value));
  return date ? date.toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"}) : String(value || "");
}

function formatTime(value) {
  const minutes=timeMinutes(value);
  if(minutes===null) return String(value || "");
  const hour24=Math.floor(minutes/60);
  const minute=minutes%60;
  const suffix=hour24<12 ? "AM" : "PM";
  return `${hour24%12 || 12}${minute ? `:${String(minute).padStart(2,"0")}` : ""} ${suffix}`;
}

function dateWithinAvailable(date,startDate,endDate) {
  if(startDate && date<startDate) return false;
  if(endDate && date>endDate) return false;
  return true;
}

function sourceBadge(entryOrDay) {
  const kind=entryOrDay?.evidenceKind || entryOrDay?.sourceKind || "none";
  const labels={
    "composer-exact":"Exact",
    "newsletter-dated":"Preview dated",
    "newsletter-mixed":"Preview",
    "newsletter-grid":"Preview",
    "composer-archive":"Archive",
    "none":"No source"
  };
  return `<span class="schedule-source-badge schedule-source-${escapeHtml(kind)}">${escapeHtml(labels[kind] || "Source")}</span>`;
}

export function renderScheduleMonth(days,{anchorDate,time="12:00",carryInDay=null,availableStart="",availableEnd=""}={}) {
  const month=monthKey(anchorDate);
  return `
    <div class="schedule-view-heading">
      <div><span>Month</span><strong>${escapeHtml(formatMonth(anchorDate))}</strong></div>
      <div><span>Snapshot time</span><strong>${escapeHtml(formatTime(time))}</strong></div>
    </div>
    <div class="schedule-month-grid" role="grid" aria-label="${escapeHtml(formatMonth(anchorDate))} schedule at ${escapeHtml(formatTime(time))}">
      ${SHORT_DAY_NAMES.map((name)=>`<div class="schedule-month-weekday" role="columnheader">${escapeHtml(name)}</div>`).join("")}
      ${(days || []).map((day,index)=>{
        if(!dateWithinAvailable(day.date,availableStart,availableEnd)) {
          return '<div class="schedule-month-day outside-evidence" role="gridcell" aria-hidden="true"></div>';
        }
        const programs=entriesAtTimeForDay(days,index,time,carryInDay?.entries || []);
        const inMonth=monthKey(day.date)===month;
        const source=programs[0] || day;
        return `<button type="button" class="schedule-month-day${inMonth ? "" : " outside-month"}" role="gridcell" data-schedule-date="${escapeHtml(day.date)}" aria-label="Open ${escapeHtml(formatDate(day.date))} day schedule">
          <div class="schedule-month-date"><strong>${escapeHtml(formatDate(day.date))}</strong>${sourceBadge(source)}</div>
          <div class="schedule-month-program">${programs.length ? programs.map((item)=>`<span>${escapeHtml(item.program)}</span>`).join("") : '<span class="schedule-empty">No known program at this time</span>'}</div>
        </button>`;
      }).join("")}
    </div>`;
}

export function renderScheduleWeek(days,{windowStart=6,carryInDay=null,availableStart="",availableEnd=""}={}) {
  const startHour=Math.max(0,Math.min(18,Number(windowStart) || 0));
  const rows=Array.from({length:12},(_,index)=>startHour*60+index*30);
  const timeText=(minutes)=>`${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;
  return `
    <div class="schedule-view-heading">
      <div><span>Week</span><strong>${days.length ? `${escapeHtml(formatDate(days[0].date))} – ${escapeHtml(formatDate(days.at(-1).date))}` : ""}</strong></div>
      <div><span>Window</span><strong>${escapeHtml(formatTime(timeText(startHour*60)))} – ${escapeHtml(formatTime(timeText((startHour+6)*60%1440)))}</strong></div>
    </div>
    <div class="table-wrap schedule-week-wrap">
      <table class="schedule-week-table">
        <thead><tr><th>Time</th>${days.map((day)=>dateWithinAvailable(day.date,availableStart,availableEnd) ? `<th>${escapeHtml(formatDate(day.date,{weekdayName:true}))}<br>${sourceBadge(day)}</th>` : '<th class="outside-evidence" aria-hidden="true"></th>').join("")}</tr></thead>
        <tbody>
          ${rows.map((minutes)=>{
            const clock=timeText(minutes);
            return `<tr><th>${escapeHtml(formatTime(clock))}</th>${days.map((day,index)=>{
              if(!dateWithinAvailable(day.date,availableStart,availableEnd)) return '<td class="outside-evidence" aria-hidden="true"></td>';
              const programs=entriesAtTimeForDay(days,index,clock,carryInDay?.entries || []);
              return `<td>${programs.length ? programs.map((item)=>`<span class="schedule-week-program">${escapeHtml(item.program)}</span>`).join("") : '<span class="schedule-empty">—</span>'}</td>`;
            }).join("")}</tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

export function renderScheduleDay(day) {
  if(!day) return '<p class="empty-state">No schedule date selected.</p>';
  return `
    <div class="schedule-view-heading">
      <div><span>Day</span><strong>${escapeHtml(formatDate(day.date,{weekdayName:true}))}</strong></div>
      <div><span>Best available source</span><strong>${escapeHtml(day.sourceLabel)}</strong></div>
    </div>
    ${day.entries.length ? `<div class="schedule-day-list">${day.entries.map((entry)=>`
      <article class="schedule-day-row">
        <div class="schedule-day-time">${escapeHtml(formatTime(entry.start))}<span>to ${escapeHtml(formatTime(entry.end))}</span></div>
        <div class="schedule-day-program"><strong>${escapeHtml(entry.program)}</strong>${entry.genre ? `<span>${escapeHtml(entry.genre)}</span>` : ""}</div>
        <div class="schedule-day-source">${sourceBadge(entry)}<span>${escapeHtml(entry.sourceLabel)}${entry.sourcePage ? ` · p. ${escapeHtml(entry.sourcePage)}` : ""}</span></div>
      </article>`).join("")}</div>`
      : '<p class="empty-state">No defensible schedule evidence is available for this date.</p>'}`;
}

export function scheduleSourceSummary(days) {
  const counts=new Map();
  (days || []).forEach((day)=>{
    const key=day.sourceLabel || "No schedule evidence";
    counts.set(key,(counts.get(key)||0)+1);
  });
  return [...counts.entries()].map(([label,count])=>`${label}: ${count} ${count===1 ? "day" : "days"}`).join(" · ");
}

export function shiftScheduleDate(date,view,direction) {
  const step=view==="day" ? 1 : view==="week" ? 7 : 1;
  if(view==="month") {
    const parsed=dateValue(date);
    if(!parsed) return date;
    const originalDay=parsed.getUTCDate();
    parsed.setUTCDate(1);
    parsed.setUTCMonth(parsed.getUTCMonth()+Number(direction || 0));
    const last=new Date(Date.UTC(parsed.getUTCFullYear(),parsed.getUTCMonth()+1,0,12)).getUTCDate();
    parsed.setUTCDate(Math.min(originalDay,last));
    return parsed.toISOString().slice(0,10);
  }
  return addScheduleDays(date,step*Number(direction || 0));
}

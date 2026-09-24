const SLOT_MINUTES=30;
const SLOTS_PER_DAY=24*60/SLOT_MINUTES;

const SCHEDULE_CORRELATION_METRICS=Object.freeze([
  { key:"streaming.listeners", label:"Live-stream listeners", importance:96 },
  { key:"streaming.listener_hours", label:"Live-stream listener hours", importance:92 },
  { key:"website.active_users", label:"NPR website active users", importance:76 },
  { key:"website.pageviews", label:"NPR website pageviews", importance:74 },
  { key:"audio.downloads", label:"On-demand audio downloads", importance:78 },
  { key:"npr_one.localized_listeners", label:"NPR One localized listeners", importance:82 },
  { key:"ga4.site_sessions", label:"GA4 sessions", importance:68 },
  { key:"ga4.site_page_views", label:"GA4 page views", importance:66 }
]);

function parseTime(value) {
  const match=String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if(!match) return null;
  const hour=Number(match[1]), minute=Number(match[2]);
  if(!Number.isFinite(hour) || !Number.isFinite(minute) || hour<0 || hour>23 || minute<0 || minute>59) return null;
  return hour*60+minute;
}

function toDate(value) {
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(value,days) {
  const date=toDate(value);
  if(!date) return "";
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function dayDistance(a,b) {
  const first=toDate(a), second=toDate(b);
  if(!first || !second) return Infinity;
  return Math.round(Math.abs(second-first)/86400000);
}

function weekday(value) {
  const date=toDate(value);
  return date ? date.getUTCDay() : null;
}

function cleanProgram(value) {
  const text=String(value || "").trim();
  return text && text.toLowerCase()!=="unknown program" ? text : "";
}

function mode(values,{minimum=3,dominance=.6}={}) {
  const clean=values.filter(Boolean);
  if(clean.length<minimum) return "";
  const counts=new Map();
  clean.forEach((value)=>counts.set(value,(counts.get(value)||0)+1));
  const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
  const [value,count]=ranked[0] || [];
  return value && count/clean.length>=dominance ? value : "";
}

function emptySlots() {
  return Array.from({length:SLOTS_PER_DAY},()=>new Set());
}

function scheduleSlots(entries=[]) {
  const byDate=new Map();
  const ensure=(date)=>{
    if(!byDate.has(date)) byDate.set(date,emptySlots());
    return byDate.get(date);
  };

  entries.forEach((entry)=>{
    const date=String(entry?.date || "");
    const program=cleanProgram(entry?.program);
    const start=parseTime(entry?.start);
    const rawEnd=parseTime(entry?.end);
    if(!date || !program || start===null || rawEnd===null || rawEnd===start) return;
    const end=rawEnd<start ? rawEnd+1440 : rawEnd;
    const firstSlot=Math.floor(start/SLOT_MINUTES);
    const lastSlot=Math.ceil(end/SLOT_MINUTES)-1;
    for(let slot=firstSlot;slot<=lastSlot;slot+=1) {
      const targetDate=slot<SLOTS_PER_DAY ? date : addDays(date,1);
      const targetSlot=((slot%SLOTS_PER_DAY)+SLOTS_PER_DAY)%SLOTS_PER_DAY;
      ensure(targetDate)[targetSlot].add(program);
    }
  });

  const normalized=new Map();
  byDate.forEach((slots,date)=>{
    normalized.set(date,slots.map((programs)=>[...programs].sort((a,b)=>a.localeCompare(b)).join(" + ")));
  });
  return normalized;
}

function peerDates(date,dates,{maxPeers=8,maxDistanceDays=70}={}) {
  const targetWeekday=weekday(date);
  return dates
    .filter((candidate)=>candidate!==date && weekday(candidate)===targetWeekday && dayDistance(date,candidate)<=maxDistanceDays)
    .sort((a,b)=>dayDistance(date,a)-dayDistance(date,b) || a.localeCompare(b))
    .slice(0,maxPeers);
}

function expectedSlotsForDate(date,slotMap,allDates) {
  const peers=peerDates(date,allDates);
  if(peers.length<4) return null;
  const expected=Array.from({length:SLOTS_PER_DAY},(_,slot)=>
    mode(peers.map((peer)=>slotMap.get(peer)?.[slot] || ""),{minimum:4,dominance:.6})
  );
  return { expected, peers };
}

function compressMismatchWindows(mismatches,actual,expected) {
  const windows=[];
  let start=null;
  let previous=null;
  for(const slot of mismatches) {
    if(start===null || previous===null || slot!==previous+1) {
      if(start!==null) windows.push({start, end:previous});
      start=slot;
    }
    previous=slot;
  }
  if(start!==null) windows.push({start,end:previous});

  const timeLabel=(slot)=>{
    const minutes=slot*SLOT_MINUTES;
    const hour=Math.floor(minutes/60)%24;
    const minute=minutes%60;
    return `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
  };

  return windows.map((window)=>{
    const actualPrograms=[...new Set(actual.slice(window.start,window.end+1).filter(Boolean))];
    const expectedPrograms=[...new Set(expected.slice(window.start,window.end+1).filter(Boolean))];
    return {
      start:timeLabel(window.start),
      end:timeLabel(window.end+1),
      actual:actualPrograms,
      expected:expectedPrograms
    };
  });
}

export function detectMajorScheduleChanges(entries=[],{
  minimumChangedHours=4,
  minimumChangedFraction=.2,
  minimumComparableHours=12
}={}) {
  const slots=scheduleSlots(entries);
  const dates=[...slots.keys()].sort();
  const changes=[];

  dates.forEach((date)=>{
    const actual=slots.get(date);
    const profile=expectedSlotsForDate(date,slots,dates);
    if(!actual || !profile) return;
    const comparable=[];
    const mismatches=[];
    for(let slot=0;slot<SLOTS_PER_DAY;slot+=1) {
      const expected=profile.expected[slot];
      if(!expected) continue;
      const actualValue=actual[slot] || "";
      comparable.push(slot);
      if(actualValue!==expected) mismatches.push(slot);
    }
    const comparableHours=comparable.length*SLOT_MINUTES/60;
    const changedHours=mismatches.length*SLOT_MINUTES/60;
    const changedFraction=comparable.length ? mismatches.length/comparable.length : 0;
    if(comparableHours<minimumComparableHours || changedHours<minimumChangedHours || changedFraction<minimumChangedFraction) return;
    changes.push({
      date,
      changedHours,
      comparableHours,
      changedFraction,
      peerDates:profile.peers,
      windows:compressMismatchWindows(mismatches,actual,profile.expected)
    });
  });

  return {
    changes,
    coverage:dates.length ? { startDate:dates[0], endDate:dates[dates.length-1], dates:dates.length } : { startDate:"", endDate:"", dates:0 }
  };
}

function median(values) {
  const clean=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length) return null;
  const middle=Math.floor(clean.length/2);
  return clean.length%2 ? clean[middle] : (clean[middle-1]+clean[middle])/2;
}

function percentChange(current,baseline) {
  const a=Number(current), b=Number(baseline);
  if(!Number.isFinite(a) || !Number.isFinite(b) || b===0) return null;
  return ((a-b)/Math.abs(b))*100;
}

function formatPercent(value) {
  const number=Number(value);
  if(!Number.isFinite(number)) return "—";
  return `${number>0?"+":""}${number.toFixed(1)}%`;
}

function formatDate(value) {
  const date=toDate(value);
  if(!date) return String(value || "");
  return date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
}

function formatHours(value) {
  const number=Number(value);
  return Number.isFinite(number) ? `${number.toFixed(number%1 ? 1 : 0)} hours` : "—";
}

function normalSameWeekdayMedian(rows,date,majorDates,scheduleDates) {
  const target=weekday(date);
  const values=(rows || [])
    .filter((row)=>scheduleDates.has(row.period_start) && !majorDates.has(row.period_start) && weekday(row.period_start)===target)
    .map((row)=>Number(row.station_value))
    .filter(Number.isFinite);
  return values.length>=4 ? median(values) : null;
}

function scheduleChangeFinding(profile) {
  if(!profile.changes.length) return null;
  const changedHours=profile.changes.map((change)=>change.changedHours);
  const largest=[...profile.changes].sort((a,b)=>b.changedHours-a.changedHours || a.date.localeCompare(b.date))[0];
  return {
    id:"schedule:major-days",
    kind:"schedule-change-days",
    category:"scheduling",
    importance:118,
    title:`${profile.changes.length} dates show major departures from the normal FM schedule`,
    summary:`The app found dated schedules that differed substantially from nearby same-weekday schedules. The median major change affected ${formatHours(median(changedHours))}; the largest detected change was ${formatHours(largest.changedHours)} on ${formatDate(largest.date)}. These are schedule differences, not audience conclusions by themselves.`,
    evidence:[
      { label:"Major-change dates", value:String(profile.changes.length) },
      { label:"Median changed airtime", value:formatHours(median(changedHours)) },
      { label:"Largest changed airtime", value:`${formatHours(largest.changedHours)} · ${formatDate(largest.date)}` }
    ],
    sourceStart:profile.coverage.startDate,
    sourceEnd:profile.coverage.endDate,
    sampleSize:profile.coverage.dates,
    grain:"day"
  };
}

function correlationFinding(metric,rows,profile) {
  if(!rows?.length || profile.changes.length<2) return null;
  const byDate=new Map(rows
    .filter((row)=>row?.period_start && row.station_value!==null && Number.isFinite(Number(row.station_value)))
    .map((row)=>[row.period_start,{...row,station_value:Number(row.station_value)}]));
  const majorDates=new Set(profile.changes.map((change)=>change.date));
  const scheduleDates=new Set();
  for(let date=profile.coverage.startDate;date && date<=profile.coverage.endDate;date=addDays(date,1)) scheduleDates.add(date);

  const comparisons=[];
  profile.changes.forEach((change)=>{
    const row=byDate.get(change.date);
    if(!row) return;
    const baseline=normalSameWeekdayMedian([...byDate.values()],change.date,majorDates,scheduleDates);
    const delta=percentChange(row.station_value,baseline);
    if(delta===null) return;
    comparisons.push({date:change.date,delta,changedHours:change.changedHours});
  });
  if(comparisons.length<2) return null;
  const effect=median(comparisons.map((item)=>item.delta));
  if(effect===null || Math.abs(effect)<10) return null;
  const direction=effect<0 ? "lower" : "higher";
  const changedHoursMedian=median(comparisons.map((item)=>item.changedHours));
  return {
    id:`schedule-effect:${metric.key}`,
    kind:"schedule-correlation",
    category:"scheduling",
    metricKey:metric.key,
    metricLabel:metric.label,
    importance:metric.importance+Math.min(14,Math.abs(effect)/4),
    title:`Major schedule-change days coincide with ${direction} ${metric.label.toLowerCase()}`,
    summary:`Across ${comparisons.length} major schedule-change dates with matching daily data, the median value was ${formatPercent(effect)} versus the normal same-weekday baseline. This is an association, not proof that the schedule change caused the audience difference.`,
    evidence:[
      { label:"Matched change dates", value:String(comparisons.length) },
      { label:"Median audience difference", value:formatPercent(effect) },
      { label:"Median changed airtime", value:formatHours(changedHoursMedian) }
    ],
    sourceStart:profile.coverage.startDate,
    sourceEnd:profile.coverage.endDate,
    sampleSize:comparisons.length,
    grain:"day",
    deltaPct:effect
  };
}

function conciseProgramList(values=[]) {
  return [...new Set(values.filter(Boolean))].slice(0,3).join(", ");
}

export function addScheduleContextToTrendFindings(findings=[],profile={changes:[]}) {
  if(!Array.isArray(profile?.changes) || !profile.changes.length) return findings;
  return findings.map((finding)=>{
    if(!["benchmark-trend","benchmark-trend-group"].includes(finding?.kind)) return finding;
    if(finding.sourceFamily!=="streaming") return finding;
    if(!finding.periodStart || !finding.periodEnd) return finding;
    const changes=profile.changes.filter((change)=>change.date>=finding.periodStart && change.date<=finding.periodEnd);
    if(!changes.length) return finding;

    const largest=[...changes].sort((a,b)=>b.changedHours-a.changedHours || a.date.localeCompare(b.date))[0];
    const window=largest?.windows?.[0] || null;
    const actual=conciseProgramList(window?.actual || []);
    const expected=conciseProgramList(window?.expected || []);
    let detail=` FM schedule context: ${changes.length} major schedule-change ${changes.length===1 ? "date was" : "dates were"} detected during this month; the largest affected ${formatHours(largest.changedHours)} on ${formatDate(largest.date)}.`;
    if(actual || expected) {
      detail += ` The largest changed block included ${actual || "different programming"}${expected ? ` where ${expected} was typical` : ""}.`;
    }
    detail += " This is context for investigation, not evidence that the schedule caused the audience movement.";
    return {
      ...finding,
      summary:`${finding.summary}${detail}`,
      scheduleContext:{
        changeCount:changes.length,
        largestDate:largest.date,
        largestChangedHours:largest.changedHours,
        actualPrograms:actual,
        expectedPrograms:expected
      }
    };
  });
}

export function analyzeScheduleTakeaways({entries=[],dailyByMetric={}}={}) {
  const profile=detectMajorScheduleChanges(entries);
  if(!profile.coverage.dates) return { findings:[], profile };
  const findings=[];
  const scheduleFinding=scheduleChangeFinding(profile);
  if(scheduleFinding) findings.push(scheduleFinding);
  SCHEDULE_CORRELATION_METRICS.forEach((metric)=>{
    const finding=correlationFinding(metric,dailyByMetric[metric.key] || [],profile);
    if(finding) findings.push(finding);
  });
  findings.sort((a,b)=>Number(b.importance||0)-Number(a.importance||0) || String(a.title).localeCompare(String(b.title)));
  return { findings, profile };
}

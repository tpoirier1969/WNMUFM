const SLOT_MINUTES=30;
const SLOTS_PER_DAY=24*60/SLOT_MINUTES;
const DAY_NAMES=Object.freeze(["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]);

const SCHEDULE_EFFECT_METRICS=Object.freeze([
  { key:"streaming.listeners", label:"live-stream listeners", importance:104 },
  { key:"streaming.listener_hours", label:"live-stream listener hours", importance:100 }
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

function slotTimeLabel(slot) {
  const totalMinutes=((slot*SLOT_MINUTES)%(24*60)+(24*60))%(24*60);
  const hour24=Math.floor(totalMinutes/60);
  const minute=totalMinutes%60;
  const hour12=hour24%12 || 12;
  const suffix=hour24<12 ? "AM" : "PM";
  return `${hour12}:${String(minute).padStart(2,"0")} ${suffix}`;
}

function sameWeekdayDates(dates,targetWeekday) {
  return dates.filter((date)=>weekday(date)===targetWeekday).sort();
}

function dominantProgramForDates(slotMap,dates,slot,{minimum=4,dominance=.67}={}) {
  return mode(dates.map((date)=>slotMap.get(date)?.[slot] || ""),{minimum,dominance});
}

function compressPersistentSlotChanges(slotChanges,{minimumHours=1}={}) {
  const sorted=[...slotChanges].sort((a,b)=>
    a.weekday-b.weekday ||
    a.effectiveDate.localeCompare(b.effectiveDate) ||
    a.fromProgram.localeCompare(b.fromProgram) ||
    a.toProgram.localeCompare(b.toProgram) ||
    a.slot-b.slot
  );
  const groups=[];
  sorted.forEach((change)=>{
    const previous=groups.at(-1);
    if(previous &&
      previous.weekday===change.weekday &&
      previous.effectiveDate===change.effectiveDate &&
      previous.fromProgram===change.fromProgram &&
      previous.toProgram===change.toProgram &&
      previous.endSlot+1===change.slot) {
      previous.endSlot=change.slot;
      return;
    }
    groups.push({
      weekday:change.weekday,
      effectiveDate:change.effectiveDate,
      fromProgram:change.fromProgram,
      toProgram:change.toProgram,
      startSlot:change.slot,
      endSlot:change.slot
    });
  });

  return groups
    .map((group)=>({
      ...group,
      changedHours:(group.endSlot-group.startSlot+1)*SLOT_MINUTES/60,
      startTime:slotTimeLabel(group.startSlot),
      endTime:slotTimeLabel(group.endSlot+1)
    }))
    .filter((group)=>group.changedHours>=minimumHours);
}

export function detectPersistentScheduleChanges(entries=[],{
  windowOccurrences=6,
  minimumOccurrences=4,
  dominance=.67,
  minimumHours=1
}={}) {
  const slotMap=scheduleSlots(entries);
  const dates=[...slotMap.keys()].sort();
  const slotChanges=[];

  for(let targetWeekday=0;targetWeekday<7;targetWeekday+=1) {
    const weekdayDates=sameWeekdayDates(dates,targetWeekday);
    if(weekdayDates.length<minimumOccurrences*2) continue;
    for(let slot=0;slot<SLOTS_PER_DAY;slot+=1) {
      for(let index=minimumOccurrences;index<=weekdayDates.length-minimumOccurrences;index+=1) {
        const effectiveDate=weekdayDates[index];
        const previousDate=weekdayDates[index-1];
        const beforeDates=weekdayDates.slice(Math.max(0,index-windowOccurrences),index);
        const afterDates=weekdayDates.slice(index,Math.min(weekdayDates.length,index+windowOccurrences));
        if(beforeDates.length<minimumOccurrences || afterDates.length<minimumOccurrences) continue;
        const fromProgram=dominantProgramForDates(slotMap,beforeDates,slot,{minimum:minimumOccurrences,dominance});
        const toProgram=dominantProgramForDates(slotMap,afterDates,slot,{minimum:minimumOccurrences,dominance});
        if(!fromProgram || !toProgram || fromProgram===toProgram) continue;
        if((slotMap.get(previousDate)?.[slot] || "")!==fromProgram) continue;
        if((slotMap.get(effectiveDate)?.[slot] || "")!==toProgram) continue;
        slotChanges.push({weekday:targetWeekday,effectiveDate,fromProgram,toProgram,slot});
      }
    }
  }

  const changes=compressPersistentSlotChanges(slotChanges,{minimumHours});
  return {
    changes,
    coverage:dates.length ? {startDate:dates[0],endDate:dates.at(-1),dates:dates.length} : {startDate:"",endDate:"",dates:0}
  };
}

function groupPersistentChangesByDate(changes=[]) {
  const groups=new Map();
  changes.forEach((change)=>{
    const key=`${change.weekday}|${change.effectiveDate}`;
    if(!groups.has(key)) groups.set(key,{
      weekday:change.weekday,
      effectiveDate:change.effectiveDate,
      changes:[],
      changedHours:0
    });
    const group=groups.get(key);
    group.changes.push(change);
    group.changedHours+=change.changedHours;
  });
  return [...groups.values()].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate) || a.weekday-b.weekday);
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

function usableMetricRows(rows=[]) {
  return rows
    .filter((row)=>row?.period_start && row.station_value!==null && row.station_value!==undefined && Number.isFinite(Number(row.station_value)))
    .map((row)=>({...row,station_value:Number(row.station_value)}))
    .sort((a,b)=>String(a.period_start).localeCompare(String(b.period_start)));
}

function comparisonWindows(rows,effectiveDate,{occurrences=6,minimum=4}={}) {
  const targetWeekday=weekday(effectiveDate);
  const sameDay=usableMetricRows(rows).filter((row)=>weekday(row.period_start)===targetWeekday);
  const before=sameDay.filter((row)=>row.period_start<effectiveDate).slice(-occurrences);
  const after=sameDay.filter((row)=>row.period_start>=effectiveDate).slice(0,occurrences);
  if(before.length<minimum || after.length<minimum) return null;
  return {before,after};
}

function benchmarkMedian(rows) {
  const values=rows
    .map((row)=>Number(row.benchmark_value))
    .filter(Number.isFinite);
  return values.length>=4 ? median(values) : null;
}

function benchmarkLabelForRows(rows) {
  const counts=new Map();
  rows.forEach((row)=>{
    const label=String(row.benchmark_label || "").trim();
    if(label) counts.set(label,(counts.get(label)||0)+1);
  });
  return [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
}

function beforeAfterMetricEffect(metric,rows,effectiveDate) {
  const windows=comparisonWindows(rows,effectiveDate);
  if(!windows) return null;
  const beforeMedian=median(windows.before.map((row)=>row.station_value));
  const afterMedian=median(windows.after.map((row)=>row.station_value));
  const delta=percentChange(afterMedian,beforeMedian);
  if(delta===null) return null;

  const benchmarkBefore=benchmarkMedian(windows.before);
  const benchmarkAfter=benchmarkMedian(windows.after);
  const benchmarkDelta=benchmarkBefore!==null && benchmarkAfter!==null ? percentChange(benchmarkAfter,benchmarkBefore) : null;
  const relativeGap=benchmarkDelta===null ? null : delta-benchmarkDelta;
  const material=Math.abs(delta)>=12 || (relativeGap!==null && Math.abs(delta)>=6 && Math.abs(relativeGap)>=12);
  if(!material) return null;

  return {
    metricKey:metric.key,
    label:metric.label,
    importance:metric.importance,
    beforeMedian,
    afterMedian,
    delta,
    benchmarkDelta,
    benchmarkLabel:benchmarkLabelForRows([...windows.before,...windows.after]),
    relativeGap,
    beforeCount:windows.before.length,
    afterCount:windows.after.length,
    sourceStart:windows.before[0].period_start,
    sourceEnd:windows.after.at(-1).period_end || windows.after.at(-1).period_start
  };
}

function formatScheduleWindow(change) {
  return `${change.fromProgram} → ${change.toProgram}, ${change.startTime}–${change.endTime}`;
}

function persistentScheduleEffectFinding(group,dailyByMetric) {
  const effects=SCHEDULE_EFFECT_METRICS
    .map((metric)=>beforeAfterMetricEffect(metric,dailyByMetric[metric.key] || [],group.effectiveDate))
    .filter(Boolean);
  if(!effects.length) return null;

  const primary=effects.find((effect)=>effect.metricKey==="streaming.listeners") ||
    [...effects].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0];
  const dayName=DAY_NAMES[group.weekday] || "Same weekday";
  const pluralDay=`${dayName}s`;
  const direction=primary.delta<0 ? "fell" : "rose";
  const primaryChange=group.changes
    .slice()
    .sort((a,b)=>b.changedHours-a.changedHours || a.startSlot-b.startSlot)[0];
  const scheduleTitle=group.changes.length===1
    ? `${primaryChange.fromProgram} was replaced by ${primaryChange.toProgram} on ${pluralDay} at ${primaryChange.startTime}`
    : `the ${pluralDay} schedule changed in ${group.changes.length} recurring blocks`;

  const effectParts=effects.map((effect)=>
    `${effect.label} ${effect.delta<0 ? "fell" : "rose"} ${Math.abs(effect.delta).toFixed(1)}%`
  );
  const listenerEffect=effects.find((effect)=>effect.metricKey==="streaming.listeners");
  let benchmarkContext="";
  if(listenerEffect?.benchmarkDelta!==null && listenerEffect?.benchmarkLabel) {
    benchmarkContext=` NPR ${listenerEffect.benchmarkLabel} ${pluralDay} changed ${formatPercent(listenerEffect.benchmarkDelta)}, so WNMU-FM moved ${Math.abs(listenerEffect.relativeGap).toFixed(1)} percentage points ${listenerEffect.relativeGap<0 ? "more negatively" : "more positively"}.`;
  }

  const scheduleDetails=group.changes
    .slice()
    .sort((a,b)=>a.startSlot-b.startSlot)
    .slice(0,3)
    .map(formatScheduleWindow)
    .join("; ");

  return {
    id:`schedule-regime:${group.weekday}:${group.effectiveDate}`,
    kind:"schedule-regime-effect",
    category:"scheduling",
    actionability:98,
    importance:Math.max(...effects.map((effect)=>effect.importance+Math.min(20,Math.abs(effect.delta)/2))),
    title:`After ${scheduleTitle}, ${pluralDay} ${primary.label} ${direction} ${Math.abs(primary.delta).toFixed(1)}%`,
    summary:`Comparing the ${primary.beforeCount} ${pluralDay} before ${formatDate(group.effectiveDate)} with the ${primary.afterCount} after, ${effectParts.join(" and ")}.${benchmarkContext} Recurring schedule change: ${scheduleDetails}. This is an association in daily totals, not proof that the changed program caused the audience movement.`,
    evidence:effects.flatMap((effect)=>[
      {label:`${effect.label} before/after`,value:`${formatPercent(effect.delta)}`},
      ...(effect.benchmarkDelta!==null ? [{label:`NPR ${effect.benchmarkLabel || "benchmark"} trend`,value:formatPercent(effect.benchmarkDelta)}] : [])
    ]),
    sourceStart:effects.map((effect)=>effect.sourceStart).sort()[0] || "",
    sourceEnd:effects.map((effect)=>effect.sourceEnd).sort().at(-1) || "",
    sampleSize:primary.beforeCount+primary.afterCount,
    grain:"day",
    metricKeys:effects.map((effect)=>effect.metricKey),
    scheduleChange:{
      effectiveDate:group.effectiveDate,
      weekday:group.weekday,
      changedHours:group.changedHours,
      changes:group.changes
    },
    deltaPct:primary.delta
  };
}

function nearbyNormalRows(rows,date,majorDates,coverage,{maxDistanceDays=70}={}) {
  const targetWeekday=weekday(date);
  return usableMetricRows(rows)
    .filter((row)=>
      row.period_start!==date &&
      weekday(row.period_start)===targetWeekday &&
      !majorDates.has(row.period_start) &&
      row.period_start>=coverage.startDate &&
      row.period_start<=coverage.endDate &&
      dayDistance(row.period_start,date)<=maxDistanceDays
    );
}

function specialDayMetricEffect(metric,rows,change,profile) {
  const usable=usableMetricRows(rows);
  const current=usable.find((row)=>row.period_start===change.date);
  if(!current) return null;
  const majorDates=new Set(profile.changes.map((item)=>item.date));
  const baselineRows=nearbyNormalRows(usable,change.date,majorDates,profile.coverage);
  if(baselineRows.length<4) return null;
  const baseline=median(baselineRows.map((row)=>row.station_value));
  const delta=percentChange(current.station_value,baseline);
  if(delta===null) return null;

  const benchmarkBaseline=benchmarkMedian(baselineRows);
  const benchmarkCurrent=Number(current.benchmark_value);
  const benchmarkDelta=Number.isFinite(benchmarkCurrent) && benchmarkBaseline!==null
    ? percentChange(benchmarkCurrent,benchmarkBaseline)
    : null;
  const relativeGap=benchmarkDelta===null ? null : delta-benchmarkDelta;
  const material=Math.abs(delta)>=15 || (relativeGap!==null && Math.abs(delta)>=8 && Math.abs(relativeGap)>=15);
  if(!material) return null;

  return {
    metricKey:metric.key,
    label:metric.label,
    delta,
    benchmarkDelta,
    benchmarkLabel:benchmarkLabelForRows([current,...baselineRows]),
    relativeGap,
    baselineCount:baselineRows.length,
    importance:metric.importance
  };
}

function clockLabel(value) {
  const minutes=parseTime(value);
  if(minutes===null) return String(value || "");
  const slot=minutes/SLOT_MINUTES;
  return slotTimeLabel(slot);
}

function largestChangedWindow(change) {
  return [...(change.windows || [])].sort((a,b)=>{
    const aStart=parseTime(a.start), aEnd=parseTime(a.end);
    const bStart=parseTime(b.start), bEnd=parseTime(b.end);
    const aMinutes=aStart===null || aEnd===null ? 0 : (aEnd>=aStart ? aEnd-aStart : aEnd+1440-aStart);
    const bMinutes=bStart===null || bEnd===null ? 0 : (bEnd>=bStart ? bEnd-bStart : bEnd+1440-bStart);
    return bMinutes-aMinutes;
  })[0] || null;
}

function specialProgrammingFinding(change,dailyByMetric,profile) {
  const effects=SCHEDULE_EFFECT_METRICS
    .map((metric)=>specialDayMetricEffect(metric,dailyByMetric[metric.key] || [],change,profile))
    .filter(Boolean);
  if(!effects.length) return null;

  const primary=effects.find((effect)=>effect.metricKey==="streaming.listeners") ||
    [...effects].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0];
  const dayName=DAY_NAMES[weekday(change.date)] || "day";
  const direction=primary.delta<0 ? "lower" : "higher";
  const largestWindow=largestChangedWindow(change);
  const actual=conciseProgramList(largestWindow?.actual || []);
  const expected=conciseProgramList(largestWindow?.expected || []);
  let scheduleDetail=`${formatHours(change.changedHours)} of the FM schedule differed from nearby ${dayName}s`;
  if(largestWindow) {
    scheduleDetail += `; the largest changed block ran ${clockLabel(largestWindow.start)}–${clockLabel(largestWindow.end)}`;
    if(actual || expected) scheduleDetail += ` with ${actual || "different programming"}${expected ? ` instead of ${expected}` : ""}`;
  }
  const metricParts=effects.map((effect)=>`${effect.label} ${effect.delta<0 ? "were" : "were"} ${Math.abs(effect.delta).toFixed(1)}% ${effect.delta<0 ? "below" : "above"} nearby normal ${dayName}s`);
  let benchmarkContext="";
  if(primary.benchmarkDelta!==null && primary.benchmarkLabel) {
    benchmarkContext=` NPR ${primary.benchmarkLabel} was ${formatPercent(primary.benchmarkDelta)} versus its nearby ${dayName} baseline, leaving a ${Math.abs(primary.relativeGap).toFixed(1)}-point WNMU-FM divergence.`;
  }

  return {
    id:`schedule-special:${change.date}`,
    kind:"schedule-special-day",
    category:"scheduling",
    actionability:94,
    importance:primary.importance+Math.min(20,Math.abs(primary.delta)/2),
    title:`Special programming on ${dayName}, ${formatDate(change.date)} coincided with ${Math.abs(primary.delta).toFixed(1)}% ${direction} ${primary.label}`,
    summary:`${metricParts.join(" and ")}.${benchmarkContext} Schedule context: ${scheduleDetail}. This is an association in the full day's totals, not an hourly measurement.`,
    evidence:effects.map((effect)=>({label:effect.label,value:formatPercent(effect.delta)})),
    sourceStart:profile.coverage.startDate,
    sourceEnd:profile.coverage.endDate,
    sampleSize:primary.baselineCount+1,
    grain:"day",
    metricKeys:effects.map((effect)=>effect.metricKey),
    scheduleChange:change,
    deltaPct:primary.delta
  };
}

function conciseProgramList(values=[]) {
  return [...new Set(values.filter(Boolean))].slice(0,3).join(", ");
}

export function addScheduleContextToTrendFindings(findings=[],profile={changes:[],regimeChanges:[]}) {
  const oneOffChanges=Array.isArray(profile?.changes) ? profile.changes : [];
  const regimeChanges=Array.isArray(profile?.regimeChanges) ? profile.regimeChanges : [];
  if(!oneOffChanges.length && !regimeChanges.length) return findings;
  return findings.map((finding)=>{
    if(!["benchmark-trend","benchmark-trend-group"].includes(finding?.kind)) return finding;
    if(finding.sourceFamily!=="streaming") return finding;
    if(!finding.periodStart || !finding.periodEnd) return finding;

    const monthRegimes=regimeChanges.filter((change)=>change.effectiveDate>=finding.periodStart && change.effectiveDate<=finding.periodEnd);
    const monthSpecials=oneOffChanges.filter((change)=>change.date>=finding.periodStart && change.date<=finding.periodEnd);
    if(!monthRegimes.length && !monthSpecials.length) return finding;

    let detail=" FM schedule context:";
    if(monthRegimes.length) {
      const primary=[...monthRegimes].sort((a,b)=>b.changedHours-a.changedHours || a.startSlot-b.startSlot)[0];
      detail += ` a recurring ${DAY_NAMES[primary.weekday]} change began ${formatDate(primary.effectiveDate)} when ${primary.fromProgram} was replaced by ${primary.toProgram} from ${primary.startTime}–${primary.endTime}.`;
    }
    if(monthSpecials.length) {
      const largest=[...monthSpecials].sort((a,b)=>b.changedHours-a.changedHours || a.date.localeCompare(b.date))[0];
      const window=largestChangedWindow(largest);
      const actual=conciseProgramList(window?.actual || []);
      const expected=conciseProgramList(window?.expected || []);
      detail += ` ${monthSpecials.length} major one-day schedule departure${monthSpecials.length===1 ? "" : "s"} also occurred; the largest affected ${formatHours(largest.changedHours)} on ${formatDate(largest.date)}`;
      if(actual || expected) detail += ` with ${actual || "different programming"}${expected ? ` instead of ${expected}` : ""}`;
      detail += ".";
    }
    detail += " This is context for investigation, not evidence that the schedule caused the audience movement.";

    return {
      ...finding,
      summary:`${finding.summary}${detail}`,
      scheduleContext:{
        regimeChangeCount:monthRegimes.length,
        specialDateCount:monthSpecials.length
      }
    };
  });
}

export function analyzeScheduleTakeaways({entries=[],dailyByMetric={}}={}) {
  const oneOffProfile=detectMajorScheduleChanges(entries);
  const persistentProfile=detectPersistentScheduleChanges(entries);
  const profile={
    ...oneOffProfile,
    regimeChanges:persistentProfile.changes
  };
  if(!profile.coverage.dates) return {findings:[],profile};

  const regimeGroups=groupPersistentChangesByDate(profile.regimeChanges);
  const regimeFindings=regimeGroups
    .map((group)=>persistentScheduleEffectFinding(group,dailyByMetric))
    .filter(Boolean);

  const regimeDates=new Set(regimeGroups.map((group)=>group.effectiveDate));
  const specialFindings=profile.changes
    .filter((change)=>!regimeDates.has(change.date))
    .map((change)=>specialProgrammingFinding(change,dailyByMetric,profile))
    .filter(Boolean)
    .sort((a,b)=>Number(b.importance||0)-Number(a.importance||0))
    .slice(0,5);

  const findings=[...regimeFindings,...specialFindings]
    .sort((a,b)=>
      Number(b.actionability||0)-Number(a.actionability||0) ||
      Number(b.importance||0)-Number(a.importance||0) ||
      String(a.title).localeCompare(String(b.title))
    );
  return {findings,profile};
}


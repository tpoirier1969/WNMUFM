const DAY_NAMES=Object.freeze(["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]);

const MONTHLY_STREAMING_METRICS=Object.freeze([
  {key:"streaming.listeners",label:"live-stream listeners"},
  {key:"streaming.listener_hours",label:"live-stream listener hours"}
]);
const SLOT_MINUTES=30;
const SLOTS_PER_DAY=24*60/SLOT_MINUTES;
const ZERO_DELTA_TOLERANCE=.05;

function dateFromIso(value) {
  const date=new Date(`${String(value || "").slice(0,10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMonth(value) {
  const date=dateFromIso(value);
  return date ? date.toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"}) : String(value || "");
}

function formatDate(value) {
  const date=dateFromIso(value);
  return date ? date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}) : String(value || "");
}

function formatClock(value) {
  const match=String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if(!match) return String(value || "");
  const hour=Number(match[1]), minute=Number(match[2]);
  const suffix=hour<12 ? "AM" : "PM";
  const display=hour%12 || 12;
  return minute ? `${display}:${String(minute).padStart(2,"0")} ${suffix}` : `${display} ${suffix}`;
}

function monthKey(value) {
  return /^\d{4}-\d{2}/.test(String(value || "")) ? String(value).slice(0,7) : "";
}

function monthEnd(value) {
  const date=dateFromIso(`${monthKey(value)}-01`);
  if(!date) return String(value || "");
  date.setUTCMonth(date.getUTCMonth()+1);
  date.setUTCDate(0);
  return date.toISOString().slice(0,10);
}

function consecutiveMonths(a,b) {
  const first=dateFromIso(`${monthKey(a)}-01`);
  const second=dateFromIso(`${monthKey(b)}-01`);
  if(!first || !second) return false;
  const test=new Date(first);
  test.setUTCMonth(test.getUTCMonth()+1);
  return test.toISOString().slice(0,7)===second.toISOString().slice(0,7);
}

function numeric(value) {
  if(value===null || value===undefined || value==="") return null;
  const number=Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentChange(current,previous) {
  const a=numeric(current), b=numeric(previous);
  if(a===null || b===null || b===0) return null;
  return ((a-b)/Math.abs(b))*100;
}

function formatPercent(value) {
  const number=numeric(value);
  if(number===null) return "—";
  return `${number>0 ? "+" : ""}${number.toFixed(1)}%`;
}

function parseClockMinutes(value) {
  const match=String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if(!match) return null;
  const hour=Number(match[1]), minute=Number(match[2]);
  if(hour<0 || hour>23 || minute<0 || minute>59) return null;
  return hour*60+minute;
}

function slotClock(slot) {
  const minutes=((slot*SLOT_MINUTES)%(24*60)+(24*60))%(24*60);
  return `${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}:00`;
}

function gridSlotMap(rows) {
  const days=Array.from({length:7},()=>Array.from({length:SLOTS_PER_DAY},()=>({programs:new Set(),pages:new Set()})));
  (rows || []).forEach((row)=>{
    const weekday=Number(row.weekday);
    const start=parseClockMinutes(row.start_time);
    const rawEnd=parseClockMinutes(row.end_time);
    const program=String(row.program_title || "").trim();
    if(!Number.isInteger(weekday) || weekday<0 || weekday>6 || start===null || rawEnd===null || !program || start===rawEnd) return;
    const end=rawEnd<start ? rawEnd+24*60 : rawEnd;
    const first=Math.floor(start/SLOT_MINUTES);
    const last=Math.ceil(end/SLOT_MINUTES)-1;
    for(let slot=first;slot<=last;slot+=1) {
      const targetWeekday=(weekday+Math.floor(slot/SLOTS_PER_DAY))%7;
      const targetSlot=((slot%SLOTS_PER_DAY)+SLOTS_PER_DAY)%SLOTS_PER_DAY;
      days[targetWeekday][targetSlot].programs.add(program);
      if(row.source_page!==null && row.source_page!==undefined) days[targetWeekday][targetSlot].pages.add(row.source_page);
    }
  });
  return days.map((slots)=>slots.map((slot)=>({
    program:[...slot.programs].sort((a,b)=>a.localeCompare(b)).join(" + "),
    page:[...slot.pages][0] ?? null
  })));
}

function compareGridCoverage(previousRows,currentRows) {
  const previous=gridSlotMap(previousRows);
  const current=gridSlotMap(currentRows);
  const changes=[];
  for(let weekday=0;weekday<7;weekday+=1) {
    for(let slot=0;slot<SLOTS_PER_DAY;slot+=1) {
      const before=previous[weekday][slot];
      const after=current[weekday][slot];
      if(before.program===after.program) continue;
      const fromProgram=before.program || "No listed program";
      const toProgram=after.program || "No listed program";
      const prior=changes.at(-1);
      if(prior &&
        prior.weekday===weekday &&
        prior.endSlot+1===slot &&
        prior.fromProgram===fromProgram &&
        prior.toProgram===toProgram) {
        prior.endSlot=slot;
        prior.end_time=slotClock(slot+1);
        if(prior.previousPage===null) prior.previousPage=before.page;
        if(prior.currentPage===null) prior.currentPage=after.page;
        continue;
      }
      changes.push({
        weekday,
        startSlot:slot,
        endSlot:slot,
        start_time:slotClock(slot),
        end_time:slotClock(slot+1),
        fromProgram,
        toProgram,
        previousPage:before.page,
        currentPage:after.page
      });
    }
  }
  return changes;
}

function monthlyRow(rows,month) {
  return (rows || []).find((row)=>monthKey(row.period_start)===monthKey(month)) || null;
}

function monthlyAudienceContext(monthlyByMetric,fromMonth,toMonth) {
  const effects=[];
  MONTHLY_STREAMING_METRICS.forEach((metric)=>{
    const previous=monthlyRow(monthlyByMetric?.[metric.key],fromMonth);
    const current=monthlyRow(monthlyByMetric?.[metric.key],toMonth);
    if(!previous || !current) return;
    const delta=percentChange(current.station_value,previous.station_value);
    if(delta===null) return;
    const effect={metricKey:metric.key,label:metric.label,delta};
    if(metric.key==="streaming.listeners") {
      const benchmarkDelta=percentChange(current.benchmark_value,previous.benchmark_value);
      if(benchmarkDelta!==null) {
        effect.benchmarkDelta=benchmarkDelta;
        effect.benchmarkLabel=current.benchmark_label || previous.benchmark_label || "NPR benchmark";
      }
    }
    effects.push(effect);
  });
  return effects;
}

function audienceSentence(effects) {
  if(!effects.length) return "No source-valid monthly streaming comparison is available for these two newsletter months.";
  const parts=effects.map((effect)=>
    Math.abs(effect.delta)<ZERO_DELTA_TOLERANCE
      ? `${effect.label} were unchanged (0.0%)`
      : `${effect.label} ${effect.delta<0 ? "fell" : "rose"} ${Math.abs(effect.delta).toFixed(1)}%`
  );
  const listener=effects.find((effect)=>effect.metricKey==="streaming.listeners" && numeric(effect.benchmarkDelta)!==null);
  const benchmark=listener
    ? Math.abs(listener.benchmarkDelta)<ZERO_DELTA_TOLERANCE
      ? ` NPR ${listener.benchmarkLabel} listeners were unchanged (0.0%) over the same two months.`
      : ` NPR ${listener.benchmarkLabel} listeners changed ${formatPercent(listener.benchmarkDelta)} over the same two months.`
    : "";
  return `Across the same monthly reporting periods, ${parts.join(" and ")}.${benchmark}`;
}

function scheduleSlotLabel(change) {
  const day=DAY_NAMES[Number(change.weekday)] || "Unknown day";
  return `${day}s at ${formatClock(change.start_time)}`;
}

function groupChanges(changes) {
  const groups=new Map();
  changes.forEach((change)=>{
    const key=`${change.fromProgram}|${change.toProgram}`;
    if(!groups.has(key)) groups.set(key,{fromProgram:change.fromProgram,toProgram:change.toProgram,slots:[]});
    groups.get(key).slots.push(change);
  });
  return [...groups.values()];
}

function monthlyGridFindings(sources,entries,monthlyByMetric) {
  const bySource=new Map();
  entries.filter((row)=>row.entry_type==="monthly_grid").forEach((row)=>{
    if(!bySource.has(Number(row.source_id))) bySource.set(Number(row.source_id),[]);
    bySource.get(Number(row.source_id)).push(row);
  });
  const ordered=[...sources].sort((a,b)=>String(a.issue_month).localeCompare(String(b.issue_month)));
  const findings=[];

  for(let index=1;index<ordered.length;index+=1) {
    const previousSource=ordered[index-1], currentSource=ordered[index];
    if(!consecutiveMonths(previousSource.issue_month,currentSource.issue_month)) continue;
    const previousRows=bySource.get(Number(previousSource.id)) || [];
    const currentRows=bySource.get(Number(currentSource.id)) || [];
    if(!previousRows.length || !currentRows.length) continue;

    const changes=compareGridCoverage(previousRows,currentRows);
    if(!changes.length) continue;

    const effects=monthlyAudienceContext(monthlyByMetric,previousSource.issue_month,currentSource.issue_month);
    groupChanges(changes).forEach((group)=>{
      const slots=group.slots.sort((a,b)=>a.weekday-b.weekday || String(a.start_time).localeCompare(String(b.start_time)));
      const slotText=slots.length===1
        ? scheduleSlotLabel(slots[0])
        : slots.map(scheduleSlotLabel).join(" and ");
      const title=`${formatMonth(currentSource.issue_month)} grid: ${group.fromProgram} → ${group.toProgram} on ${slotText}`;
      const summary=`The ${formatMonth(previousSource.issue_month)} newsletter grid shows ${group.fromProgram}, while the next consecutive newsletter grid shows ${group.toProgram} in ${slots.length===1 ? "that slot" : "those slots"}. The newsletters establish a month-to-month schedule difference, not an exact change date. ${audienceSentence(effects)} This is month-level context, not program-level attribution.`;
      findings.push({
        id:`newsletter-grid-change:${monthKey(currentSource.issue_month)}:${group.fromProgram}:${group.toProgram}:${slots.map((slot)=>`${slot.weekday}-${slot.start_time}`).join(",")}`,
        kind:"newsletter-grid-change",
        category:"scheduling",
        actionability:86,
        importance:84,
        title,
        summary,
        grain:"month",
        sourceStart:previousSource.issue_month,
        sourceEnd:monthEnd(currentSource.issue_month),
        sampleSize:2,
        metricKeys:effects.map((effect)=>effect.metricKey),
        newsletterEvidence:{
          previousSourceKey:previousSource.source_key,
          currentSourceKey:currentSource.source_key,
          previousPage:previousSource.schedule_page,
          currentPage:currentSource.schedule_page,
          dateScope:"issue_month",
          changes:slots
        }
      });
    });
  }
  return findings;
}

function weekday(value) {
  const date=dateFromIso(value);
  return date ? date.getUTCDay() : null;
}

function median(values) {
  const clean=values.map(numeric).filter((value)=>value!==null).sort((a,b)=>a-b);
  if(!clean.length) return null;
  const middle=Math.floor(clean.length/2);
  return clean.length%2 ? clean[middle] : (clean[middle-1]+clean[middle])/2;
}

function datedAudienceContext(dailyByMetric,date) {
  const effects=[];
  MONTHLY_STREAMING_METRICS.forEach((metric)=>{
    const rows=(dailyByMetric?.[metric.key] || []).filter((row)=>row?.period_start && numeric(row.station_value)!==null);
    const target=rows.find((row)=>row.period_start===date);
    if(!target) return;
    const targetWeekday=weekday(date);
    const peers=rows
      .filter((row)=>row.period_start!==date && weekday(row.period_start)===targetWeekday)
      .map((row)=>({
        ...row,
        distance:Math.abs(Number(dateFromIso(row.period_start))-Number(dateFromIso(date)))/86400000
      }))
      .filter((row)=>row.distance<=70)
      .sort((a,b)=>a.distance-b.distance)
      .slice(0,8);
    if(peers.length<4) return;
    const baseline=median(peers.map((row)=>row.station_value));
    const delta=percentChange(target.station_value,baseline);
    if(delta===null) return;
    const effect={metricKey:metric.key,label:metric.label,delta,peerCount:peers.length};
    if(metric.key==="streaming.listeners") {
      const targetBenchmark=numeric(target.benchmark_value);
      const peerBenchmark=median(peers.map((row)=>row.benchmark_value));
      const benchmarkDelta=percentChange(targetBenchmark,peerBenchmark);
      if(benchmarkDelta!==null) {
        effect.benchmarkDelta=benchmarkDelta;
        effect.benchmarkLabel=target.benchmark_label || peers.find((row)=>row.benchmark_label)?.benchmark_label || "NPR benchmark";
      }
    }
    effects.push(effect);
  });
  return effects;
}

function datedAudienceSentence(effects,date) {
  if(!effects.length) return "No source-valid daily streaming comparison is available for this dated listing.";
  const day=DAY_NAMES[weekday(date)] || "same-weekday";
  const parts=effects.map((effect)=>
    Math.abs(effect.delta)<ZERO_DELTA_TOLERANCE
      ? `${effect.label} were unchanged from the median of nearby ${day}s`
      : `${effect.label} were ${Math.abs(effect.delta).toFixed(1)}% ${effect.delta<0 ? "below" : "above"} the median of nearby ${day}s`
  );
  const listener=effects.find((effect)=>effect.metricKey==="streaming.listeners" && numeric(effect.benchmarkDelta)!==null);
  const benchmark=listener
    ? Math.abs(listener.benchmarkDelta)<ZERO_DELTA_TOLERANCE
      ? ` NPR ${listener.benchmarkLabel} was unchanged from its nearby ${day} baseline.`
      : ` NPR ${listener.benchmarkLabel} was ${Math.abs(listener.benchmarkDelta).toFixed(1)}% ${listener.benchmarkDelta<0 ? "below" : "above"} its nearby ${day} baseline.`
    : "";
  return `On that date, ${parts.join(" and ")}.${benchmark}`;
}

function datedOverrideFindings(sources,entries,dailyByMetric) {
  const sourceById=new Map(sources.map((source)=>[Number(source.id),source]));
  return entries
    .filter((row)=>row.entry_type==="dated_override" && row.specific_date)
    .map((row)=>{
      const source=sourceById.get(Number(row.source_id));
      const day=DAY_NAMES[Number(row.weekday)] || "day";
      const replacement=row.replaces_program_title
        ? `${row.program_title} replaced ${row.replaces_program_title}`
        : `${row.program_title} is explicitly listed`;
      const effects=datedAudienceContext(dailyByMetric,row.specific_date);
      return {
        id:`newsletter-dated:${row.entry_key}`,
        kind:"newsletter-dated-override",
        category:"scheduling",
        actionability:effects.length ? 90 : 80,
        importance:effects.length ? 88 : 80,
        title:`${formatDate(row.specific_date)}: ${replacement}, ${day} ${formatClock(row.start_time)}`,
        summary:`This is an explicitly dated WNMU-FM Preview listing, not an inferred recurring change.${source ? ` Source: ${source.title}, page ${row.source_page}.` : ""} ${datedAudienceSentence(effects,row.specific_date)} Any audience difference is full-day context unless a finer-grain source is available.`,
        grain:"day",
        sourceStart:row.specific_date,
        sourceEnd:row.specific_date,
        sampleSize:effects.length ? Math.max(...effects.map((effect)=>effect.peerCount))+1 : 1,
        metricKeys:effects.map((effect)=>effect.metricKey),
        newsletterEvidence:{
          sourceKey:source?.source_key || "",
          page:row.source_page,
          dateScope:row.date_scope,
          evidenceBasis:row.evidence_basis
        }
      };
    });
}

export function newsletterDuplicatesScheduleChange(newsletterFindings=[],scheduleChange={}) {
  const effectiveMonth=monthKey(scheduleChange?.effectiveDate);
  const weekday=Number(scheduleChange?.weekday);
  const fromProgram=String(scheduleChange?.fromProgram || "");
  const toProgram=String(scheduleChange?.toProgram || "");
  const startSlot=Number(scheduleChange?.startSlot);
  const endSlot=Number(scheduleChange?.endSlot);
  if(!effectiveMonth || !Number.isInteger(weekday) || !fromProgram || !toProgram || !Number.isFinite(startSlot) || !Number.isFinite(endSlot)) return false;
  const startMinutes=startSlot*SLOT_MINUTES;
  const endMinutes=(endSlot+1)*SLOT_MINUTES;

  return (newsletterFindings || []).some((finding)=>{
    if(finding?.kind!=="newsletter-grid-change" || monthKey(finding.sourceEnd)!==effectiveMonth) return false;
    return (finding.newsletterEvidence?.changes || []).some((change)=>{
      if(Number(change.weekday)!==weekday || change.fromProgram!==fromProgram || change.toProgram!==toProgram) return false;
      const newsletterStart=parseClockMinutes(change.start_time);
      let newsletterEnd=parseClockMinutes(change.end_time);
      if(newsletterStart===null || newsletterEnd===null) return false;
      if(newsletterEnd<=newsletterStart) newsletterEnd+=24*60;
      return newsletterStart<endMinutes && newsletterEnd>startMinutes;
    });
  });
}

export function analyzeNewsletterScheduleTakeaways({sources=[],entries=[],monthlyByMetric={},dailyByMetric={}}={}) {
  if(!sources.length || !entries.length) return [];
  return [
    ...monthlyGridFindings(sources,entries,monthlyByMetric),
    ...datedOverrideFindings(sources,entries,dailyByMetric)
  ].sort((a,b)=>
    Number(b.actionability||0)-Number(a.actionability||0) ||
    String(a.sourceStart || "").localeCompare(String(b.sourceStart || "")) ||
    String(a.title || "").localeCompare(String(b.title || ""))
  );
}

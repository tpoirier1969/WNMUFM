const DAY_NAMES=Object.freeze(["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]);

const MONTHLY_STREAMING_METRICS=Object.freeze([
  {key:"streaming.listeners",label:"live-stream listeners"},
  {key:"streaming.listener_hours",label:"live-stream listener hours"}
]);

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

function consecutiveMonths(a,b) {
  const first=dateFromIso(`${monthKey(a)}-01`);
  const second=dateFromIso(`${monthKey(b)}-01`);
  if(!first || !second) return false;
  const test=new Date(first);
  test.setUTCMonth(test.getUTCMonth()+1);
  return test.toISOString().slice(0,7)===second.toISOString().slice(0,7);
}

function slotKey(row) {
  return `${row.weekday}|${row.start_time}|${row.end_time || ""}`;
}

function percentChange(current,previous) {
  const a=Number(current), b=Number(previous);
  if(!Number.isFinite(a) || !Number.isFinite(b) || b===0) return null;
  return ((a-b)/Math.abs(b))*100;
}

function formatPercent(value) {
  const number=Number(value);
  if(!Number.isFinite(number)) return "—";
  return `${number>0 ? "+" : ""}${number.toFixed(1)}%`;
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
  const parts=effects.map((effect)=>`${effect.label} ${effect.delta<0 ? "fell" : "rose"} ${Math.abs(effect.delta).toFixed(1)}%`);
  const listener=effects.find((effect)=>effect.metricKey==="streaming.listeners" && Number.isFinite(effect.benchmarkDelta));
  const benchmark=listener
    ? ` NPR ${listener.benchmarkLabel} listeners changed ${formatPercent(listener.benchmarkDelta)} over the same two months.`
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

    const previousSlots=new Map(previousRows.map((row)=>[slotKey(row),row]));
    const changes=[];
    currentRows.forEach((row)=>{
      const prior=previousSlots.get(slotKey(row));
      if(!prior || prior.program_title===row.program_title) return;
      changes.push({
        weekday:Number(row.weekday),
        start_time:row.start_time,
        end_time:row.end_time,
        fromProgram:prior.program_title,
        toProgram:row.program_title,
        previousPage:prior.source_page,
        currentPage:row.source_page
      });
    });
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
        sourceEnd:currentSource.issue_month,
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

function datedOverrideFindings(sources,entries) {
  const sourceById=new Map(sources.map((source)=>[Number(source.id),source]));
  return entries
    .filter((row)=>row.entry_type==="dated_override" && row.specific_date)
    .map((row)=>{
      const source=sourceById.get(Number(row.source_id));
      const day=DAY_NAMES[Number(row.weekday)] || "day";
      const replacement=row.replaces_program_title
        ? `${row.program_title} replaced ${row.replaces_program_title}`
        : `${row.program_title} is explicitly listed`;
      return {
        id:`newsletter-dated:${row.entry_key}`,
        kind:"newsletter-dated-override",
        category:"scheduling",
        actionability:80,
        importance:80,
        title:`${formatDate(row.specific_date)}: ${replacement}, ${day} ${formatClock(row.start_time)}`,
        summary:`This is an explicitly dated WNMU-FM Preview listing, not an inferred recurring change.${source ? ` Source: ${source.title}, page ${row.source_page}.` : ""} Audience attribution is left unstated unless source-valid analytics at an appropriate date/time grain are available.`,
        grain:"day",
        sourceStart:row.specific_date,
        sourceEnd:row.specific_date,
        sampleSize:1,
        metricKeys:[],
        newsletterEvidence:{
          sourceKey:source?.source_key || "",
          page:row.source_page,
          dateScope:row.date_scope,
          evidenceBasis:row.evidence_basis
        }
      };
    });
}

export function analyzeNewsletterScheduleTakeaways({sources=[],entries=[],monthlyByMetric={}}={}) {
  if(!sources.length || !entries.length) return [];
  return [
    ...monthlyGridFindings(sources,entries,monthlyByMetric),
    ...datedOverrideFindings(sources,entries)
  ].sort((a,b)=>
    Number(b.actionability||0)-Number(a.actionability||0) ||
    String(a.sourceStart || "").localeCompare(String(b.sourceStart || "")) ||
    String(a.title || "").localeCompare(String(b.title || ""))
  );
}

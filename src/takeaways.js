const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

export const TAKEAWAY_CATEGORIES = Object.freeze([
  ["all","All findings"],
  ["cross-source","Cross-source"],
  ["npr-comparison","NPR comparison"],
  ["scheduling","Scheduling"],
  ["audience","Audience"],
  ["website","Website"],
  ["on-demand","On-demand"],
  ["npr-one","NPR One"],
  ["data-quality","Data quality"]
]);

export const TAKEAWAY_METRICS = Object.freeze([
  { key:"streaming.listeners", label:"Live-stream listeners", category:"audience", sourceFamily:"streaming", monthly:true, benchmarkTrend:true },
  { key:"streaming.listener_hours", label:"Live-stream listener hours", category:"audience", sourceFamily:"streaming", monthly:true },
  { key:"website.active_users", label:"NPR website active users", category:"website", sourceFamily:"website", monthly:true, benchmarkTrend:true },
  { key:"website.pageviews", label:"NPR website pageviews", category:"website", sourceFamily:"website", monthly:true, benchmarkTrend:true },
  { key:"ga4.site_page_views", label:"Google Analytics 4 page views", category:"website", sourceFamily:"ga4", monthly:false },
  { key:"ga4.site_sessions", label:"Google Analytics 4 sessions", category:"website", sourceFamily:"ga4", monthly:false },
  { key:"audio.downloads", label:"On-demand audio downloads", category:"on-demand", sourceFamily:"audio", monthly:true, benchmarkTrend:true },
  { key:"audio.users", label:"On-demand audio users", category:"on-demand", sourceFamily:"audio", monthly:true, benchmarkTrend:true },
  { key:"npr_one.localized_listeners", label:"NPR One localized listeners", category:"npr-one", sourceFamily:"npr-one", monthly:true },
  { key:"npr_one.average_minutes", label:"NPR One average listening minutes", category:"npr-one", sourceFamily:"npr-one", monthly:true, benchmarkTrend:true }
]);

export const TAKEAWAY_BENCHMARK_METRICS = Object.freeze([
  ...TAKEAWAY_METRICS.filter((metric)=>metric.benchmarkTrend),
  { key:"streaming.minutes_per_session", label:"Live-stream minutes per session", category:"audience", sourceFamily:"streaming", benchmarkTrend:true },
  { key:"streaming.sessions_per_listener", label:"Live-stream sessions per listener", category:"audience", sourceFamily:"streaming", benchmarkTrend:true },
  { key:"website.engaged_seconds_per_user", label:"NPR website engaged seconds per user", category:"website", sourceFamily:"website", benchmarkTrend:true },
  { key:"website.views_per_user", label:"NPR website views per user", category:"website", sourceFamily:"website", benchmarkTrend:true },
  { key:"audio.downloads_per_user", label:"On-demand downloads per user", category:"on-demand", sourceFamily:"audio", benchmarkTrend:true }
]);

function toDate(value) {
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDays(value, days) {
  const date=toDate(value);
  if(!date) return "";
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function median(values) {
  const clean=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length) return null;
  const middle=Math.floor(clean.length/2);
  return clean.length%2 ? clean[middle] : (clean[middle-1]+clean[middle])/2;
}

function percentChange(current, baseline) {
  const a=Number(current), b=Number(baseline);
  if(!Number.isFinite(a) || !Number.isFinite(b) || b===0) return null;
  return ((a-b)/Math.abs(b))*100;
}

function numericRows(rows=[]) {
  return rows
    .filter((row)=>row?.period_start && row.station_value!==null && row.station_value!==undefined && Number.isFinite(Number(row.station_value)))
    .map((row)=>({ ...row, station_value:Number(row.station_value) }))
    .sort((a,b)=>String(a.period_start).localeCompare(String(b.period_start)));
}

function coverage(rows) {
  if(!rows.length) return { startDate:"", endDate:"", sampleSize:0 };
  return {
    startDate:rows[0].period_start,
    endDate:rows[rows.length-1].period_end || rows[rows.length-1].period_start,
    sampleSize:rows.length
  };
}

function unitLabel(unit, value) {
  const text=String(unit || "").trim().toLowerCase();
  if(!text) return "";
  if(Number(value)===1) return text.replace(/s$/,"");
  return text;
}

function formatValue(value, unit="") {
  const number=Number(value);
  if(!Number.isFinite(number)) return "—";
  const decimals=Math.abs(number-Math.round(number)) < 0.05 ? 0 : 1;
  const formatted=number.toLocaleString(undefined,{maximumFractionDigits:decimals});
  const label=unitLabel(unit,number);
  return label ? `${formatted} ${label}` : formatted;
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

function formatMonth(value) {
  const date=toDate(String(value || "").slice(0,7)+"-01");
  if(!date) return String(value || "");
  return date.toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"});
}

function findingBase(metric, rows, grain) {
  const span=coverage(rows);
  return {
    metricKey:metric.key,
    metricLabel:metric.label,
    category:metric.category,
    sourceFamily:metric.sourceFamily,
    grain,
    sourceStart:span.startDate,
    sourceEnd:span.endDate,
    sampleSize:span.sampleSize
  };
}

function anomalySourceFamily(anomaly) {
  const key=String(anomaly?.anomaly_key || "").toLowerCase();
  if(key.startsWith("website_spike_")) return "website";
  if(key.startsWith("bulk_audio_")) return "audio";
  if(key.startsWith("streaming_")) return "streaming";
  if(key.startsWith("npr_one_")) return "npr-one";
  if(key.startsWith("ga4_")) return "ga4";
  return "";
}

function reviewedOutlierKeys(anomalies=[]) {
  const keys=new Set();
  anomalies.forEach((anomaly)=>{
    if(!["expected","resolved"].includes(String(anomaly?.status || ""))) return;
    if(anomaly?.evidence?.selected_program) return;
    const family=anomalySourceFamily(anomaly);
    const date=String(anomaly?.evidence?.date || "");
    if(family && date) keys.add(`${family}|${date}`);
  });
  return keys;
}

function excludedMonthKeys(anomalies=[]) {
  const keys=new Set();
  anomalies.forEach((anomaly)=>{
    if(String(anomaly?.status || "")!=="excluded") return;
    if(anomaly?.evidence?.selected_program) return;
    const family=anomalySourceFamily(anomaly);
    const date=String(anomaly?.evidence?.date || "");
    if(family && /^\d{4}-\d{2}-\d{2}$/.test(date)) keys.add(`${family}|${date.slice(0,7)}`);
  });
  return keys;
}

function weekdayWeekendFinding(metric, rows) {
  if(rows.length<28) return null;
  const weekdays=rows.filter((row)=>{
    const date=toDate(row.period_start);
    if(!date) return false;
    const day=date.getUTCDay();
    return day>=1 && day<=5;
  });
  const weekends=rows.filter((row)=>{
    const date=toDate(row.period_start);
    if(!date) return false;
    const day=date.getUTCDay();
    return day===0 || day===6;
  });
  if(weekdays.length<20 || weekends.length<8) return null;
  const weekdayMedian=median(weekdays.map((row)=>row.station_value));
  const weekendMedian=median(weekends.map((row)=>row.station_value));
  const delta=percentChange(weekendMedian,weekdayMedian);
  if(delta===null || Math.abs(delta)<10) return null;
  const unit=rows.find((row)=>row.unit)?.unit || "";
  const direction=delta<0 ? "lower" : "higher";
  const base=findingBase(metric,rows,"day");
  return {
    ...base,
    id:`weekpart:${metric.key}`,
    kind:"weekpart",
    importance:72+Math.min(25,Math.abs(delta)/2),
    title:`${metric.label} are ${direction} on weekends`,
    summary:`The weekend median is ${formatValue(weekendMedian,unit)} versus ${formatValue(weekdayMedian,unit)} on weekdays, a ${formatPercent(delta)} difference.`,
    evidence:[
      { label:"Weekday median", value:formatValue(weekdayMedian,unit) },
      { label:"Weekend median", value:formatValue(weekendMedian,unit) },
      { label:"Weekend difference", value:formatPercent(delta) }
    ],
    direction:delta<0 ? "down" : "up",
    deltaPct:delta
  };
}

function dayOfWeekFinding(metric, rows) {
  if(rows.length<42) return null;
  const buckets=Array.from({length:7},()=>[]);
  rows.forEach((row)=>{
    const date=toDate(row.period_start);
    if(!date) return;
    const jsDay=date.getUTCDay();
    const isoIndex=jsDay===0 ? 6 : jsDay-1;
    buckets[isoIndex].push(row.station_value);
  });
  if(buckets.some((bucket)=>bucket.length<6)) return null;
  const medians=buckets.map((bucket)=>median(bucket));
  const maxValue=Math.max(...medians);
  const minValue=Math.min(...medians);
  const maxIndex=medians.indexOf(maxValue);
  const minIndex=medians.indexOf(minValue);
  const spread=percentChange(minValue,maxValue);
  if(spread===null || Math.abs(spread)<15) return null;
  const unit=rows.find((row)=>row.unit)?.unit || "";
  return {
    ...findingBase(metric,rows,"day"),
    id:`dow:${metric.key}`,
    kind:"day-of-week",
    importance:58+Math.min(18,Math.abs(spread)/3),
    title:`${DAY_LABELS[maxIndex]} is strongest and ${DAY_LABELS[minIndex]} weakest for ${metric.label.toLowerCase()}`,
    summary:`The median is ${formatValue(maxValue,unit)} on ${DAY_LABELS[maxIndex]} and ${formatValue(minValue,unit)} on ${DAY_LABELS[minIndex]}, with the weaker day ${formatPercent(spread)} below the stronger one.`,
    evidence:[
      { label:`${DAY_LABELS[maxIndex]} median`, value:formatValue(maxValue,unit) },
      { label:`${DAY_LABELS[minIndex]} median`, value:formatValue(minValue,unit) },
      { label:"Gap", value:formatPercent(spread) }
    ]
  };
}

function recentFinding(metric, rows) {
  if(rows.length<56) return null;
  const latest=rows[rows.length-1].period_start;
  const recentStart=shiftDays(latest,-27);
  const priorEnd=shiftDays(recentStart,-1);
  const priorStart=shiftDays(priorEnd,-27);
  const recent=rows.filter((row)=>row.period_start>=recentStart && row.period_start<=latest);
  const prior=rows.filter((row)=>row.period_start>=priorStart && row.period_start<=priorEnd);
  if(recent.length<20 || prior.length<20) return null;
  const recentMedian=median(recent.map((row)=>row.station_value));
  const priorMedian=median(prior.map((row)=>row.station_value));
  const delta=percentChange(recentMedian,priorMedian);
  if(delta===null || Math.abs(delta)<15) return null;
  const unit=rows.find((row)=>row.unit)?.unit || "";
  const direction=delta<0 ? "lower" : "higher";
  return {
    ...findingBase(metric,rows,"day"),
    id:`recent:${metric.key}`,
    kind:"recent-change",
    importance:64+Math.min(20,Math.abs(delta)/3),
    title:`${metric.label} are ${direction} in the latest 28 days`,
    summary:`The median daily value is ${formatValue(recentMedian,unit)} in the latest 28-day window versus ${formatValue(priorMedian,unit)} in the preceding 28 days, a ${formatPercent(delta)} change.`,
    evidence:[
      { label:"Latest 28-day median", value:formatValue(recentMedian,unit) },
      { label:"Previous 28-day median", value:formatValue(priorMedian,unit) },
      { label:"Change", value:formatPercent(delta) }
    ],
    sourceStart:priorStart,
    sourceEnd:latest,
    sampleSize:recent.length+prior.length
  };
}

function outlierFinding(metric, rows, reviewedKeys = new Set()) {
  if(rows.length<30) return null;
  const baseMedian=median(rows.map((row)=>row.station_value));
  if(baseMedian===null || baseMedian<=0) return null;
  const candidates=rows.filter((row)=>!reviewedKeys.has(`${metric.sourceFamily}|${row.period_start}`));
  const maxRow=candidates.reduce((best,row)=>!best || row.station_value>best.station_value ? row : best,null);
  if(!maxRow || maxRow.station_value < baseMedian*4) return null;
  const ratio=maxRow.station_value/baseMedian;
  const unit=maxRow.unit || rows.find((row)=>row.unit)?.unit || "";
  return {
    ...findingBase(metric,rows,"day"),
    id:`outlier:${metric.key}`,
    kind:"outlier",
    category:"data-quality",
    importance:88+Math.min(10,ratio),
    title:`${metric.label} include an extreme spike on ${formatDate(maxRow.period_start)}`,
    summary:`That day reached ${formatValue(maxRow.station_value,unit)}, about ${ratio.toFixed(1)}× the selected-range median of ${formatValue(baseMedian,unit)}. It may be legitimate, but it should be reviewed before being treated as normal audience behavior.`,
    evidence:[
      { label:"Spike day", value:formatValue(maxRow.station_value,unit) },
      { label:"Range median", value:formatValue(baseMedian,unit) },
      { label:"Multiple of median", value:`${ratio.toFixed(1)}×` }
    ],
    sourceStart:rows[0].period_start,
    sourceEnd:rows[rows.length-1].period_start,
    outlierDate:maxRow.period_start,
    spikeValue:maxRow.station_value,
    medianValue:baseMedian,
    ratio,
    unit
  };
}

function joinWithAnd(values) {
  const items=values.filter(Boolean);
  if(items.length<=1) return items[0] || "";
  if(items.length===2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0,-1).join(", ")}, and ${items.at(-1)}`;
}

function groupDataQualityOutliers(findings) {
  const other=findings.filter((finding)=>finding.kind!=="outlier");
  const grouped=new Map();

  findings.filter((finding)=>finding.kind==="outlier").forEach((finding)=>{
    const key=`${finding.sourceFamily || "unknown"}|${finding.outlierDate || ""}`;
    if(!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(finding);
  });

  grouped.forEach((items)=>{
    if(items.length===1) {
      other.push(items[0]);
      return;
    }
    const labels=items.map((item)=>BENCHMARK_TREND_LABELS[item.metricKey] || item.metricLabel);
    const details=items.map((item)=>
      `${item.metricLabel} reached ${formatValue(item.spikeValue,item.unit)} (${item.ratio.toFixed(1)}× its median)`
    );
    other.push({
      id:`outlier-group:${items[0].sourceFamily}:${items[0].outlierDate}`,
      kind:"outlier-group",
      category:"data-quality",
      sourceFamily:items[0].sourceFamily,
      grain:"day",
      importance:Math.max(...items.map((item)=>Number(item.importance || 0)))+2,
      title:`${joinWithAnd(labels)} spike together on ${formatDate(items[0].outlierDate)}`,
      summary:`${joinWithAnd(details)}. Because multiple measures from the same source moved together on the same date, they are grouped as one data-quality event. The spike may be legitimate and should be reviewed before being treated as normal audience behavior.`,
      evidence:items.map((item)=>({
        label:item.metricLabel,
        value:`${formatValue(item.spikeValue,item.unit)} · ${item.ratio.toFixed(1)}× median`
      })),
      sourceStart:items.map((item)=>item.sourceStart).sort()[0] || "",
      sourceEnd:items.map((item)=>item.sourceEnd).sort().at(-1) || "",
      sampleSize:items.reduce((sum,item)=>sum+Number(item.sampleSize || 0),0),
      metricKeys:items.map((item)=>item.metricKey),
      outlierDate:items[0].outlierDate
    });
  });

  return other;
}

function benchmarkLabel(rows) {
  const counts=new Map();
  rows.forEach((row)=>{
    const label=String(row.benchmark_label || "").trim();
    if(label) counts.set(label,(counts.get(label)||0)+1);
  });
  return [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "NPR benchmark";
}

const BENCHMARK_TREND_LABELS = Object.freeze({
  "streaming.listeners":"streaming listeners",
  "streaming.minutes_per_session":"streaming minutes per session",
  "streaming.sessions_per_listener":"streaming sessions per listener",
  "website.active_users":"website active users",
  "website.pageviews":"website pageviews",
  "website.engaged_seconds_per_user":"website engaged seconds per user",
  "website.views_per_user":"website views per user",
  "audio.downloads":"on-demand audio downloads",
  "audio.users":"on-demand audio users",
  "audio.downloads_per_user":"on-demand downloads per user",
  "npr_one.average_minutes":"NPR One average listening minutes"
});

function benchmarkTrendMetricLabel(metric) {
  return BENCHMARK_TREND_LABELS[metric.key] || String(metric.label || metric.key);
}

function movementLabel(value) {
  const number=Number(value);
  if(!Number.isFinite(number)) return "changed";
  if(number>=3) return "rose";
  if(number<=-3) return "fell";
  return "was nearly flat";
}

function benchmarkTrendTitle(metric, periodStart, stationChange, benchmarkChange, label) {
  const month=formatMonth(periodStart);
  const stationMovement=movementLabel(stationChange);
  const benchmarkMovement=movementLabel(benchmarkChange);
  const metricName=benchmarkTrendMetricLabel(metric);
  if(stationMovement!==benchmarkMovement) {
    return `${month}: WNMU-FM ${metricName} ${stationMovement} while NPR ${label} ${benchmarkMovement}`;
  }
  const gap=stationChange-benchmarkChange;
  if(stationMovement==="rose") {
    return `${month}: WNMU-FM ${metricName} rose ${gap>=0 ? "faster" : "more slowly"} than NPR ${label}`;
  }
  if(stationMovement==="fell") {
    return `${month}: WNMU-FM ${metricName} fell ${gap<0 ? "faster" : "less sharply"} than NPR ${label}`;
  }
  return `${month}: WNMU-FM ${metricName} moved differently from NPR ${label}`;
}

function priorMonthLabel(periodStart) {
  const date=toDate(periodStart);
  if(!date) return "the previous month";
  date.setUTCMonth(date.getUTCMonth()-1);
  return date.toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"});
}

function benchmarkTrendCandidates(metric, rows, excludedMonths = new Set()) {
  const paired=numericRows(rows)
    .filter((row)=>row.benchmark_value!==null && row.benchmark_value!==undefined && Number.isFinite(Number(row.benchmark_value)))
    .map((row)=>({...row,benchmark_value:Number(row.benchmark_value)}));
  if(paired.length<2) return [];

  const label=benchmarkLabel(paired);
  const candidates=[];
  for(let index=1;index<paired.length;index+=1) {
    const previous=paired[index-1];
    const current=paired[index];
    const previousMonth=String(previous.period_start).slice(0,7);
    const currentMonth=String(current.period_start).slice(0,7);
    if(excludedMonths.has(`${metric.sourceFamily}|${previousMonth}`) || excludedMonths.has(`${metric.sourceFamily}|${currentMonth}`)) continue;
    const stationChange=percentChange(current.station_value,previous.station_value);
    const benchmarkChange=percentChange(current.benchmark_value,previous.benchmark_value);
    if(stationChange===null || benchmarkChange===null) continue;
    const gap=stationChange-benchmarkChange;
    const opposite=(stationChange>=3 && benchmarkChange<=-3) || (stationChange<=-3 && benchmarkChange>=3);
    const material=Math.abs(gap)>=10 && (opposite || Math.max(Math.abs(stationChange),Math.abs(benchmarkChange))>=7);
    if(!material) continue;

    const priorYearKey=`${Number(currentMonth.slice(0,4))-1}-${currentMonth.slice(5,7)}`;
    const priorYear=paired.find((row)=>String(row.period_start).slice(0,7)===priorYearKey);
    let yearOverYear="";
    if(priorYear) {
      const stationYoY=percentChange(current.station_value,priorYear.station_value);
      const benchmarkYoY=percentChange(current.benchmark_value,priorYear.benchmark_value);
      if(stationYoY!==null && benchmarkYoY!==null) {
        yearOverYear=` Year over year, WNMU-FM is ${formatPercent(stationYoY)} and NPR ${label} is ${formatPercent(benchmarkYoY)}.`;
      }
    }

    const score=Math.abs(gap)+(opposite ? 15 : 0);
    candidates.push({
      ...findingBase(metric,[previous,current],"month"),
      id:`benchmark-trend:${metric.key}:${currentMonth}`,
      kind:"benchmark-trend",
      category:"npr-comparison",
      importance:80+Math.min(18,score/4),
      actionability:84,
      title:benchmarkTrendTitle(metric,current.period_start,stationChange,benchmarkChange,label),
      summary:`Compared with ${priorMonthLabel(current.period_start)}, WNMU-FM changed ${formatPercent(stationChange)} while NPR ${label} changed ${formatPercent(benchmarkChange)}, a ${Math.abs(gap).toFixed(1)}-point divergence.${yearOverYear} This compares movement, not raw audience size.`,
      evidence:[
        { label:"WNMU-FM monthly change", value:formatPercent(stationChange) },
        { label:`NPR ${label} monthly change`, value:formatPercent(benchmarkChange) },
        { label:"Trend divergence", value:`${Math.abs(gap).toFixed(1)} points` }
      ],
      sourceStart:previous.period_start,
      sourceEnd:current.period_end || current.period_start,
      sampleSize:2,
      metricKeys:[metric.key],
      periodStart:current.period_start,
      periodEnd:current.period_end || current.period_start,
      stationChangePct:stationChange,
      benchmarkChangePct:benchmarkChange,
      trendGapPct:gap,
      trendDirection:gap>=0 ? "stronger" : "weaker",
      benchmarkLabel:label,
      score
    });
  }

  return candidates
    .sort((a,b)=>b.score-a.score || String(b.periodStart).localeCompare(String(a.periodStart)))
    .slice(0,1);
}

function groupBenchmarkTrendComparisons(findings) {
  const other=findings.filter((finding)=>finding.kind!=="benchmark-trend");
  const grouped=new Map();
  findings.filter((finding)=>finding.kind==="benchmark-trend").forEach((finding)=>{
    const key=`${finding.sourceFamily || "unknown"}|${finding.periodStart || ""}|${finding.trendDirection || ""}|${finding.benchmarkLabel || ""}`;
    if(!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(finding);
  });

  grouped.forEach((items)=>{
    if(items.length===1) {
      other.push(items[0]);
      return;
    }
    const labels=items.map((item)=>BENCHMARK_TREND_LABELS[item.metricKey] || item.metricLabel);
    const month=formatMonth(items[0].periodStart);
    const benchmark=items[0].benchmarkLabel || "NPR benchmark";
    const stronger=items[0].trendDirection==="stronger";
    const details=items.map((item)=>
      `${BENCHMARK_TREND_LABELS[item.metricKey] || item.metricLabel}: WNMU-FM ${formatPercent(item.stationChangePct)} vs NPR ${formatPercent(item.benchmarkChangePct)}`
    );
    other.push({
      id:`benchmark-trend-group:${items[0].sourceFamily}:${String(items[0].periodStart).slice(0,7)}:${items[0].trendDirection}`,
      kind:"benchmark-trend-group",
      category:"npr-comparison",
      sourceFamily:items[0].sourceFamily,
      grain:"month",
      importance:Math.max(...items.map((item)=>Number(item.importance || 0)))+1,
      actionability:84,
      title:`${month}: ${joinWithAnd(labels)} moved ${stronger ? "more strongly" : "more weakly"} at WNMU-FM than at NPR ${benchmark}`,
      summary:`${joinWithAnd(details)}. The comparison is based on percentage movement, not the stations' raw audience totals.`,
      evidence:items.flatMap((item)=>item.evidence || []),
      sourceStart:items.map((item)=>item.sourceStart).sort()[0] || "",
      sourceEnd:items.map((item)=>item.sourceEnd).sort().at(-1) || "",
      sampleSize:items.reduce((sum,item)=>sum+Number(item.sampleSize || 0),0),
      metricKeys:items.flatMap((item)=>item.metricKeys || []),
      periodStart:items[0].periodStart,
      periodEnd:items[0].periodEnd,
      trendDirection:items[0].trendDirection,
      benchmarkLabel:benchmark,
      score:Math.max(...items.map((item)=>item.score || 0))
    });
  });
  return other;
}

export function takeawayActionability(finding) {
  if(Number.isFinite(Number(finding?.actionability))) return Number(finding.actionability);
  if(finding?.category==="data-quality") return 100;
  if(finding?.kind==="schedule-correlation") return 90;
  if(finding?.kind==="recent-change") return 84;
  if(finding?.kind==="benchmark-trend" || finding?.kind==="benchmark-trend-group") return 84;
  if(finding?.kind==="weekpart" || finding?.kind==="day-of-week") return 74;
  if(finding?.kind==="schedule-change-days") return 68;
  if(finding?.kind==="year-over-year") return 58;
  if(finding?.category==="cross-source") return 50;
  return 55;
}

export function sortTakeaways(findings=[]) {
  return [...findings].sort((a,b)=>
    takeawayActionability(b)-takeawayActionability(a) ||
    Number(b.importance||0)-Number(a.importance||0) ||
    String(a.title || "").localeCompare(String(b.title || ""))
  );
}

function yearOverYearFinding(metric, rows) {
  if(!metric.monthly || rows.length<13) return null;
  const latest=rows[rows.length-1];
  const latestDate=toDate(latest.period_start);
  if(!latestDate) return null;
  const priorKey=`${latestDate.getUTCFullYear()-1}-${String(latestDate.getUTCMonth()+1).padStart(2,"0")}`;
  const prior=rows.find((row)=>String(row.period_start).slice(0,7)===priorKey);
  if(!prior || prior.station_value===0) return null;
  const delta=percentChange(latest.station_value,prior.station_value);
  if(delta===null || Math.abs(delta)<10) return null;
  const unit=latest.unit || prior.unit || "";
  const direction=delta<0 ? "lower" : "higher";
  return {
    ...findingBase(metric,rows,"month"),
    id:`yoy:${metric.key}`,
    kind:"year-over-year",
    importance:55+Math.min(22,Math.abs(delta)/3),
    title:`${metric.label} are ${direction} than the same month last year`,
    summary:`${formatMonth(latest.period_start)} is ${formatValue(latest.station_value,unit)} versus ${formatValue(prior.station_value,unit)} one year earlier, a ${formatPercent(delta)} change.`,
    evidence:[
      { label:formatMonth(prior.period_start), value:formatValue(prior.station_value,unit) },
      { label:formatMonth(latest.period_start), value:formatValue(latest.station_value,unit) },
      { label:"Year-over-year", value:formatPercent(delta) }
    ],
    sourceStart:prior.period_start,
    sourceEnd:latest.period_end || latest.period_start,
    sampleSize:2
  };
}

function crossSourceWeekendFinding(signals) {
  const material=signals.filter((finding)=>Math.abs(finding.deltaPct)>=10);
  const down=material.filter((finding)=>finding.direction==="down");
  const up=material.filter((finding)=>finding.direction==="up");
  const group=down.length>=up.length ? down : up;
  const families=new Set(group.map((finding)=>finding.sourceFamily));
  if(group.length<4 || families.size<3) return null;
  const direction=group===down ? "lower" : "higher";
  const magnitudes=group.map((finding)=>Math.abs(finding.deltaPct));
  const min=Math.min(...magnitudes), max=Math.max(...magnitudes);
  const start=group.map((finding)=>finding.sourceStart).sort().at(-1) || "";
  const end=group.map((finding)=>finding.sourceEnd).sort()[0] || "";
  return {
    id:"cross-source:weekend",
    kind:"cross-source-weekpart",
    category:"cross-source",
    importance:120,
    title:`Audience and activity measures are consistently ${direction} on weekends`,
    summary:`${group.length} daily measures across ${families.size} source families show weekend medians ${direction} than weekday medians. The observed differences range from ${min.toFixed(1)}% to ${max.toFixed(1)}%.`,
    evidence:[
      { label:"Measures agreeing", value:`${group.length}` },
      { label:"Source families", value:`${families.size}` },
      { label:"Difference range", value:`${min.toFixed(1)}%–${max.toFixed(1)}%` }
    ],
    sourceStart:start,
    sourceEnd:end,
    sampleSize:group.reduce((sum,finding)=>sum+finding.sampleSize,0),
    grain:"day"
  };
}

export function analyzeTakeaways({ dailyByMetric={}, monthlyByMetric={}, benchmarkByMetric={}, reviewedAnomalies=[] }={}) {
  const findings=[];
  const weekpartSignals=[];
  const reviewedKeys=reviewedOutlierKeys(reviewedAnomalies);
  const excludedMonths=excludedMonthKeys(reviewedAnomalies);

  TAKEAWAY_METRICS.forEach((metric)=>{
    const daily=numericRows(dailyByMetric[metric.key] || []);
    if(daily.length) {
      const weekpart=weekdayWeekendFinding(metric,daily);
      if(weekpart) {
        weekpartSignals.push(weekpart);
        findings.push(weekpart);
      }
      const dow=dayOfWeekFinding(metric,daily);
      if(dow) findings.push(dow);
      const recent=recentFinding(metric,daily);
      if(recent) findings.push(recent);
      const outlier=outlierFinding(metric,daily,reviewedKeys);
      if(outlier) findings.push(outlier);
    }

    const monthly=numericRows(monthlyByMetric[metric.key] || []);
    const yoy=yearOverYearFinding(metric,monthly);
    if(yoy) findings.push(yoy);
  });

  TAKEAWAY_BENCHMARK_METRICS.forEach((metric)=>{
    const rows=benchmarkByMetric[metric.key] || monthlyByMetric[metric.key] || [];
    findings.push(...benchmarkTrendCandidates(metric,rows,excludedMonths));
  });

  const crossSource=crossSourceWeekendFinding(weekpartSignals);
  if(crossSource) findings.push(crossSource);

  return sortTakeaways(groupBenchmarkTrendComparisons(groupDataQualityOutliers(findings)));
}

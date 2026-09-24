const SOURCE_CONFIG=Object.freeze([
  ["station_streaming","Live streaming"],
  ["station_website","NPR Website"],
  ["audio_downloads","On-demand audio"],
  ["npr_one","NPR One"],
  ["ga4_website","Google Analytics 4"]
]);

const GRAIN_ORDER=Object.freeze(["day","week","month","unknown"]);

function earlier(a,b) {
  if(!a) return b || "";
  if(!b) return a;
  return a<b ? a : b;
}

function later(a,b) {
  if(!a) return b || "";
  if(!b) return a;
  return a>b ? a : b;
}

export function buildCoverageRows(imports=[]) {
  const grouped=new Map();
  SOURCE_CONFIG.forEach(([key,label])=>grouped.set(key,{key,label,grains:new Map()}));

  imports.forEach((item)=>{
    const group=grouped.get(item?.report_type);
    if(!group || !item?.grain || !item?.report_start || !item?.report_end) return;
    const grain=String(item.grain);
    const existing=group.grains.get(grain) || {grain,startDate:"",endDate:"",imports:0};
    existing.startDate=earlier(existing.startDate,item.report_start);
    existing.endDate=later(existing.endDate,item.report_end);
    existing.imports+=1;
    group.grains.set(grain,existing);
  });

  return [...grouped.values()]
    .map((group)=>({
      key:group.key,
      label:group.label,
      grains:GRAIN_ORDER.map((grain)=>group.grains.get(grain)).filter(Boolean)
    }))
    .filter((group)=>group.grains.length);
}

export function intersectRanges(ranges=[]) {
  const usable=ranges.filter((range)=>range?.startDate && range?.endDate);
  if(!usable.length) return {startDate:"",endDate:""};
  const startDate=usable.reduce((latest,range)=>!latest || range.startDate>latest ? range.startDate : latest,"");
  const endDate=usable.reduce((earliest,range)=>!earliest || range.endDate<earliest ? range.endDate : earliest,"");
  return startDate && endDate && startDate<=endDate ? {startDate,endDate} : {startDate:"",endDate:""};
}

export function coverageRange(rows=[]) {
  const spans=rows.flatMap((row)=>row.grains || []);
  if(!spans.length) return {startDate:"",endDate:""};
  return {
    startDate:spans.reduce((value,span)=>earlier(value,span.startDate),""),
    endDate:spans.reduce((value,span)=>later(value,span.endDate),"")
  };
}

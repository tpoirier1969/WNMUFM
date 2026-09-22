function svgElement(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (Math.abs(number) >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return Number.isInteger(number) ? number.toLocaleString() : number.toFixed(1);
}

function clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function linePath(points, key, xFor, yFor) {
  let path = "";
  let drawing = false;
  points.forEach((point,index) => {
    const value = finiteNumber(point[key]);
    if (value === null) { drawing = false; return; }
    path += (drawing ? " L" : "M") + xFor(index).toFixed(1) + "," + yFor(value).toFixed(1);
    drawing = true;
  });
  return path;
}

function estimatedProjectedWidth(label, angle, fontSize = 10) {
  const textWidth = Math.max(18, String(label || "").length * fontSize * 0.56);
  const textHeight = fontSize * 1.25;
  const radians = Math.abs(angle) * Math.PI / 180;
  return textWidth * Math.cos(radians) + textHeight * Math.sin(radians);
}

function dayLabelCandidates(points) {
  const candidates = new Set([0, Math.max(0, points.length - 1)]);
  const months = new Map();
  points.forEach((point,index) => {
    if (!point.date) return;
    const key = String(point.date).slice(0,7);
    if (!months.has(key)) months.set(key,[]);
    months.get(key).push(index);
  });
  months.forEach((indexes) => {
    for (const target of [1,15]) {
      let best = indexes[0];
      let bestDistance = Infinity;
      indexes.forEach((index) => {
        const day = Number(String(points[index].date).slice(8,10));
        const distance = Math.abs(day - target);
        if (distance < bestDistance) { best = index; bestDistance = distance; }
      });
      candidates.add(best);
    }
  });
  if (points.length <= 45) {
    let lastDate = null;
    points.forEach((point,index) => {
      if (!point.date) return;
      const date = new Date(String(point.date) + "T12:00:00Z");
      if (!lastDate || (date - lastDate) / 86400000 >= 7) { candidates.add(index); lastDate = date; }
    });
  }
  return [...candidates].sort((a,b)=>a-b);
}

export function selectSpacedLabelIndexes(points, plotWidth, options = {}) {
  if (!points?.length) return [];
  const xFor = (index) => points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth;
  const angle = Number(options.labelAngle ?? (points.some((point)=>point.date) ? -74 : 0));
  const candidates = options.grain === "day" && points.some((point)=>point.date)
    ? dayLabelCandidates(points)
    : points.map((_,index)=>index).filter((index) => {
        const every = options.labelEvery || (points.length <= 16 ? 1 : points.length <= 40 ? 2 : Math.max(2,Math.ceil(points.length/24)));
        return index === 0 || index === points.length - 1 || index % every === 0;
      });
  const gap = Number(options.minLabelGap ?? 6);
  const selected = [];
  for (const index of candidates) {
    const label = points[index]?.shortLabel || points[index]?.label || "";
    const projected = estimatedProjectedWidth(label,angle,10);
    if (!selected.length) { selected.push({index,projected}); continue; }
    const previous = selected[selected.length - 1];
    const distance = xFor(index) - xFor(previous.index);
    const needed = (previous.projected + projected) / 2 + gap;
    if (distance >= needed) selected.push({index,projected});
    else if (index === points.length - 1 && selected.length > 1) {
      const before = selected[selected.length - 2];
      const beforeDistance = xFor(index) - xFor(before.index);
      const beforeNeeded = (before.projected + projected) / 2 + gap;
      if (beforeDistance >= beforeNeeded) selected[selected.length - 1] = {index,projected};
    }
  }
  return selected.map((item)=>item.index);
}

export function renderLineChart(container, points, options = {}) {
  clear(container);
  if (!points?.length) {
    container.innerHTML = '<p class="empty-state">No observations are available for this view.</p>';
    return;
  }

  const width = 1100;
  const hasSecondary = points.some((point)=>finiteNumber(point.secondaryValue) !== null);
  const labelAngle = Number(options.labelAngle ?? (points.some((point)=>point.date) ? -74 : 0));
  const margin = { top:(hasSecondary || options.primaryLabel ? 34 : 18), right:58, bottom:(labelAngle ? 92 : 58), left:76 };
  const height = labelAngle ? 390 : 340;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.flatMap((point)=>[point.value,point.secondaryValue]).map(finiteNumber).filter((value)=>value !== null);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min = Math.max(0,min-1); max += 1; }
  if (min > 0 && options.zeroBaseline !== false) min = 0;

  const svg = svgElement("svg",{
    viewBox:"0 0 " + width + " " + height,
    role:"img",
    "aria-label":options.ariaLabel || options.title || "Trend chart",
    class:"chart-svg"
  });
  const xFor=(index)=>margin.left+(points.length===1 ? plotWidth/2 : (index/(points.length-1))*plotWidth);
  const yFor=(value)=>margin.top+((max-Number(value))/(max-min))*plotHeight;
  const step=points.length>1 ? plotWidth/(points.length-1) : plotWidth;

  if (options.grain === "day" && points.some((point)=>point.date)) {
    let monthStart=0, monthIndex=0;
    while(monthStart<points.length) {
      const monthKey=String(points[monthStart].date||"").slice(0,7);
      let monthEnd=monthStart;
      while(monthEnd+1<points.length && String(points[monthEnd+1].date||"").slice(0,7)===monthKey) monthEnd+=1;
      const left=monthStart===0 ? margin.left : (xFor(monthStart-1)+xFor(monthStart))/2;
      const right=monthEnd===points.length-1 ? width-margin.right : (xFor(monthEnd)+xFor(monthEnd+1))/2;
      if(monthIndex%2===1) svg.appendChild(svgElement("rect",{x:left,y:margin.top,width:Math.max(0,right-left),height:plotHeight,class:"chart-month-band"}));
      if(monthStart>0) svg.appendChild(svgElement("line",{x1:xFor(monthStart),x2:xFor(monthStart),y1:margin.top,y2:margin.top+plotHeight,class:"chart-month-line"}));
      monthStart=monthEnd+1; monthIndex+=1;
    }
  }

  if (options.grain === "day") {
    points.forEach((point,index)=>{
      if(!point.weekend) return;
      const x=xFor(index)-step/2;
      svg.appendChild(svgElement("rect",{x:Math.max(margin.left,x),y:margin.top,width:Math.min(step,width-margin.right-Math.max(margin.left,x)),height:plotHeight,class:"chart-weekend-band"}));
    });
  }

  if (options.showBars !== false) {
    const baselineY=yFor(min);
    const barWidth=Math.max(1.2,Math.min(13,step*.62));
    points.forEach((point,index)=>{
      if(finiteNumber(point.value) === null) return;
      const y=yFor(point.value);
      svg.appendChild(svgElement("rect",{x:xFor(index)-barWidth/2,y,width:barWidth,height:Math.max(0,baselineY-y),class:point.weekend ? "chart-background-bar weekend" : "chart-background-bar"}));
    });
  }

  for(let i=0;i<=4;i+=1) {
    const fraction=i/4;
    const y=margin.top+plotHeight*fraction;
    const value=max-(max-min)*fraction;
    svg.appendChild(svgElement("line",{x1:margin.left,x2:width-margin.right,y1:y,y2:y,class:"chart-grid"}));
    const label=svgElement("text",{x:margin.left-10,y:y+4,"text-anchor":"end",class:"chart-axis-label"});
    label.textContent=compactNumber(value); svg.appendChild(label);
  }

  if (Number.isFinite(Number(options.median))) {
    const medianY=yFor(Number(options.median));
    svg.appendChild(svgElement("line",{x1:margin.left,x2:width-margin.right,y1:medianY,y2:medianY,class:"chart-median-line"}));
    const medianLabel=svgElement("text",{x:width-margin.right-4,y:medianY-6,"text-anchor":"end",class:"chart-median-label"});
    medianLabel.textContent="Median " + compactNumber(options.median); svg.appendChild(medianLabel);
  }

  const primaryPath=linePath(points,"value",xFor,yFor);
  if(primaryPath) svg.appendChild(svgElement("path",{d:primaryPath,class:"chart-line"}));
  const secondaryPath=linePath(points,"secondaryValue",xFor,yFor);
  if(secondaryPath) svg.appendChild(svgElement("path",{d:secondaryPath,class:"chart-secondary-line"}));

  if (options.primaryLabel || options.secondaryLabel) {
    let legendX=margin.left;
    const addLegend=(className,labelText)=>{
      if(!labelText) return;
      svg.appendChild(svgElement("line",{x1:legendX,x2:legendX+22,y1:14,y2:14,class:className}));
      const label=svgElement("text",{x:legendX+28,y:18,class:"chart-legend-label"});
      label.textContent=labelText; svg.appendChild(label);
      legendX+=Math.max(120,String(labelText).length*7+58);
    };
    addLegend("chart-line",options.primaryLabel);
    addLegend("chart-secondary-line",options.secondaryLabel);
  }

  points.forEach((point,index)=>{
    if(finiteNumber(point.value) !== null) {
      const circle=svgElement("circle",{cx:xFor(index),cy:yFor(point.value),r:2,class:(point.weekend ? "chart-point weekend" : "chart-point") + (options.onPointClick ? " clickable" : ""),...(options.onPointClick ? {tabindex:"0",role:"button","aria-label":"Open details for " + point.label} : {})});
      const title=svgElement("title");
      const parts=[point.label + ": " + compactNumber(point.value)];
      if(finiteNumber(point.secondaryValue) !== null) parts.push((options.secondaryLabel || "Comparison") + ": " + compactNumber(point.secondaryValue));
      if(point.contextLabel) parts.push("Notable because: " + point.contextLabel);
      title.textContent=parts.join(" · "); circle.appendChild(title);
      if(options.onPointClick) {
        const activate=()=>options.onPointClick(point,index);
        circle.addEventListener("click",activate);
        circle.addEventListener("keydown",(event)=>{ if(event.key==="Enter"||event.key===" ") { event.preventDefault(); activate(); } });
      }
      svg.appendChild(circle);
    }
    if(finiteNumber(point.secondaryValue) !== null) {
      const circle=svgElement("circle",{cx:xFor(index),cy:yFor(point.secondaryValue),r:1.7,class:"chart-secondary-point"});
      const title=svgElement("title");
      title.textContent=point.label + ": " + (options.secondaryLabel || "Comparison") + " " + compactNumber(point.secondaryValue) + (point.contextLabel ? " · Notable because: " + point.contextLabel : "");
      circle.appendChild(title); svg.appendChild(circle);
    }
  });

  const labelIndexes=new Set(selectSpacedLabelIndexes(points,plotWidth,{grain:options.grain,labelEvery:options.labelEvery,labelAngle,minLabelGap:options.minLabelGap}));
  points.forEach((point,index)=>{
    if(!labelIndexes.has(index)) return;
    const x=xFor(index), y=margin.top+plotHeight+18;
    const label=svgElement("text",{x,y,"text-anchor":labelAngle ? "end" : "middle",class:(point.weekend ? "chart-axis-label weekend" : "chart-axis-label") + " dense",...(labelAngle ? {transform:"rotate(" + labelAngle + " " + x + " " + y + ")"} : {})});
    label.textContent=point.shortLabel || point.label; svg.appendChild(label);
  });
  container.appendChild(svg);
}

export function renderIndexedMultiLineChart(container, points, options = {}) {
  clear(container);
  const series = Array.isArray(options.series) ? options.series : [];
  if (!points?.length || !series.length) {
    container.innerHTML = '<p class="empty-state">No comparable observations are available for this view.</p>';
    return;
  }

  const width = 1100;
  const labelAngle = Number(options.labelAngle ?? (points.some((point)=>point.date) ? -74 : 0));
  const margin = { top:58, right:58, bottom:(labelAngle ? 92 : 58), left:76 };
  const height = labelAngle ? 414 : 364;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.flatMap((point)=>series.map((item)=>finiteNumber(point.values?.[item.key]))).filter((value)=>value !== null);
  if (!values.length) {
    container.innerHTML = '<p class="empty-state">No comparable observations are available for this view.</p>';
    return;
  }

  let min = Math.min(...values,100);
  let max = Math.max(...values,100);
  if (min === max) { min -= 5; max += 5; }
  const padding = Math.max(4,(max-min)*0.08);
  min = Math.max(0,min-padding);
  max += padding;

  const svg = svgElement("svg",{
    viewBox:"0 0 " + width + " " + height,
    role:"img",
    "aria-label":options.ariaLabel || options.title || "Indexed metric comparison",
    class:"chart-svg"
  });
  const xFor=(index)=>margin.left+(points.length===1 ? plotWidth/2 : (index/(points.length-1))*plotWidth);
  const yFor=(value)=>margin.top+((max-Number(value))/(max-min))*plotHeight;
  const step=points.length>1 ? plotWidth/(points.length-1) : plotWidth;

  if (options.grain === "day" && points.some((point)=>point.date)) {
    let monthStart=0, monthIndex=0;
    while(monthStart<points.length) {
      const monthKey=String(points[monthStart].date||"").slice(0,7);
      let monthEnd=monthStart;
      while(monthEnd+1<points.length && String(points[monthEnd+1].date||"").slice(0,7)===monthKey) monthEnd+=1;
      const left=monthStart===0 ? margin.left : (xFor(monthStart-1)+xFor(monthStart))/2;
      const right=monthEnd===points.length-1 ? width-margin.right : (xFor(monthEnd)+xFor(monthEnd+1))/2;
      if(monthIndex%2===1) svg.appendChild(svgElement("rect",{x:left,y:margin.top,width:Math.max(0,right-left),height:plotHeight,class:"chart-month-band"}));
      if(monthStart>0) svg.appendChild(svgElement("line",{x1:xFor(monthStart),x2:xFor(monthStart),y1:margin.top,y2:margin.top+plotHeight,class:"chart-month-line"}));
      monthStart=monthEnd+1;
      monthIndex+=1;
    }
  }

  if (options.grain === "day") {
    points.forEach((point,index)=>{
      if(!point.weekend) return;
      const x=xFor(index)-step/2;
      svg.appendChild(svgElement("rect",{x:Math.max(margin.left,x),y:margin.top,width:Math.min(step,width-margin.right-Math.max(margin.left,x)),height:plotHeight,class:"chart-weekend-band"}));
    });
  }

  for(let i=0;i<=4;i+=1) {
    const fraction=i/4;
    const y=margin.top+plotHeight*fraction;
    const value=max-(max-min)*fraction;
    svg.appendChild(svgElement("line",{x1:margin.left,x2:width-margin.right,y1:y,y2:y,class:"chart-grid"}));
    const label=svgElement("text",{x:margin.left-10,y:y+4,"text-anchor":"end",class:"chart-axis-label"});
    label.textContent=compactNumber(value);
    svg.appendChild(label);
  }

  const baselineY=yFor(100);
  svg.appendChild(svgElement("line",{x1:margin.left,x2:width-margin.right,y1:baselineY,y2:baselineY,class:"chart-index-baseline"}));
  const baselineLabel=svgElement("text",{x:width-margin.right-4,y:baselineY-6,"text-anchor":"end",class:"chart-index-label"});
  baselineLabel.textContent="Selected-range median = 100";
  svg.appendChild(baselineLabel);

  let legendX=margin.left;
  let legendY=18;
  series.forEach((item,seriesIndex)=>{
    const estimated=Math.max(126,String(item.label).length*7+54);
    if(legendX+estimated>width-margin.right) {
      legendX=margin.left;
      legendY+=18;
    }
    const className="chart-metric-line chart-series-" + (seriesIndex % 8);
    svg.appendChild(svgElement("line",{x1:legendX,x2:legendX+22,y1:legendY,y2:legendY,class:className}));
    const legend=svgElement("text",{x:legendX+28,y:legendY+4,class:"chart-legend-label"});
    legend.textContent=item.label;
    svg.appendChild(legend);
    legendX+=estimated;

    let path="";
    let drawing=false;
    points.forEach((point,index)=>{
      const value=finiteNumber(point.values?.[item.key]);
      if(value===null) {
        drawing=false;
        return;
      }
      path+=(drawing ? " L" : "M")+xFor(index).toFixed(1)+","+yFor(value).toFixed(1);
      drawing=true;
    });
    if(path) svg.appendChild(svgElement("path",{d:path,class:className}));

    points.forEach((point,index)=>{
      const indexed=finiteNumber(point.values?.[item.key]);
      if(indexed===null) return;
      const actual=finiteNumber(point.actualValues?.[item.key]);
      const circle=svgElement("circle",{
        cx:xFor(index),
        cy:yFor(indexed),
        r:1.7,
        class:"chart-metric-point chart-series-" + (seriesIndex % 8) + (options.onPointClick ? " clickable" : ""),
        ...(options.onPointClick ? {tabindex:"0",role:"button","aria-label":"Open " + item.label + " details for " + point.label} : {})
      });
      const title=svgElement("title");
      const parts=[
        point.label,
        item.label + ": " + (actual===null ? "—" : formatMetric(actual,item.unit)),
        "Index: " + indexed.toFixed(1)
      ];
      if(point.contextLabel) parts.push("Notable because: " + point.contextLabel);
      title.textContent=parts.join(" · ");
      circle.appendChild(title);
      if(options.onPointClick) {
        const activate=()=>options.onPointClick(point,item);
        circle.addEventListener("click",activate);
        circle.addEventListener("keydown",(event)=>{
          if(event.key==="Enter"||event.key===" ") {
            event.preventDefault();
            activate();
          }
        });
      }
      svg.appendChild(circle);
    });
  });

  const labelIndexes=new Set(selectSpacedLabelIndexes(points,plotWidth,{
    grain:options.grain,
    labelEvery:options.labelEvery,
    labelAngle,
    minLabelGap:options.minLabelGap
  }));
  points.forEach((point,index)=>{
    if(!labelIndexes.has(index)) return;
    const x=xFor(index);
    const y=margin.top+plotHeight+18;
    const label=svgElement("text",{
      x,
      y,
      "text-anchor":labelAngle ? "end" : "middle",
      class:(point.weekend ? "chart-axis-label weekend" : "chart-axis-label")+" dense",
      ...(labelAngle ? {transform:"rotate("+labelAngle+" "+x+" "+y+")"} : {})
    });
    label.textContent=point.shortLabel || point.label;
    svg.appendChild(label);
  });
  container.appendChild(svg);
}

export function renderBarChart(container, rows, options = {}) {
  clear(container);
  if (!rows?.length) {
    container.innerHTML = '<p class="empty-state">No breakdown is available for this view.</p>';
    return;
  }

  const limited = options.limit ? rows.slice(0, options.limit) : rows;
  const max = Number.isFinite(Number(options.maxValue))
    ? Number(options.maxValue)
    : Math.max(...limited.map((row) => Number(row.value) || 0), 1);
  const list = document.createElement("div");
  list.className = "bar-chart";

  limited.forEach((row) => {
    const item = document.createElement("div");
    item.className = "bar-row";
    const name = document.createElement("div");
    name.className = "bar-label";
    name.textContent = row.label;
    name.title = row.label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max(1, Math.min(100, (Number(row.value) / max) * 100))}%`;
    track.appendChild(fill);
    const value = document.createElement("div");
    value.className = "bar-value";
    value.textContent = options.formatValue ? options.formatValue(row.value) : compactNumber(row.value);
    item.append(name, track, value);
    if (options.onBarClick) {
      item.classList.add("clickable-bar-row");
      item.tabIndex = 0;
      item.setAttribute("role","button");
      item.setAttribute("aria-label", `Open details for ${row.label}`);
      const activate = () => options.onBarClick(row);
      item.addEventListener("click", activate);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
    }
    list.appendChild(item);
  });

  container.appendChild(list);
}

export function formatMetric(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (unit === "percent") return `${number.toFixed(number % 1 ? 1 : 0)}%`;
  if (unit === "minutes") return `${number.toFixed(1)} min`;
  if (unit === "hours") return `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })} hr`;
  if (unit === "seconds") return `${number.toFixed(1)} sec`;
  if (["downloads_per_user", "sessions_per_listener", "views_per_user", "views_per_session"].includes(unit)) return number.toFixed(2);
  return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

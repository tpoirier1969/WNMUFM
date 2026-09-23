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

function tooltipText(point, options, series = "primary") {
  const explicit = series === "secondary"
    ? (point.secondaryTooltipLines || point.tooltipLines)
    : (point.primaryTooltipLines || point.tooltipLines);
  if (Array.isArray(explicit) && explicit.length) return explicit.filter(Boolean).join("\n");

  const parts=[];
  if(point.label) parts.push(point.label);
  if(series === "secondary") {
    parts.push((options.secondaryLabel || "Comparison") + ": " + compactNumber(point.secondaryValue));
  } else {
    parts.push((options.primaryLabel || options.title || "Value") + ": " + compactNumber(point.value));
    if(finiteNumber(point.secondaryValue) !== null) {
      parts.push((options.secondaryLabel || "Comparison") + ": " + compactNumber(point.secondaryValue));
    }
  }
  if(point.contextLabel) parts.push("Notable because: " + point.contextLabel);
  return parts.join("\n");
}

function tooltipModelText(model) {
  if(!model) return "";
  const lines=[model.title || ""];
  if(Array.isArray(model.rows)) {
    model.rows.forEach((row)=>{
      lines.push([row.label,row.value,row.delta].filter(Boolean).join(" · "));
    });
  }
  if(Array.isArray(model.metrics)) {
    model.metrics.forEach((metric)=>{
      lines.push(metric.label || "");
      if(metric.station) lines.push(["WNMU-FM",metric.station.value,metric.station.delta].filter(Boolean).join(" · "));
      if(metric.benchmark) lines.push([metric.benchmark.label || "NPR benchmark",metric.benchmark.value,metric.benchmark.delta].filter(Boolean).join(" · "));
    });
  }
  return lines.filter(Boolean).join("\n");
}

function chartTooltip(container) {
  let tooltip=container.querySelector(":scope > .chart-tooltip");
  if(tooltip) return tooltip;
  tooltip=document.createElement("div");
  tooltip.className="chart-tooltip";
  tooltip.hidden=true;
  tooltip.setAttribute("role","tooltip");
  container.appendChild(tooltip);
  return tooltip;
}

function populateTooltip(tooltip, model) {
  tooltip.replaceChildren();
  const title=document.createElement("div");
  title.className="chart-tooltip-title";
  title.textContent=model?.title || "";
  tooltip.appendChild(title);

  if(Array.isArray(model?.rows)) {
    model.rows.forEach((row)=>{
      const line=document.createElement("div");
      line.className="chart-tooltip-row " + (row.tone ? " " + row.tone : "");
      const label=document.createElement("strong");
      label.textContent=row.label || "";
      const value=document.createElement("span");
      value.textContent=row.value || "—";
      const delta=document.createElement("span");
      delta.className="chart-tooltip-delta";
      delta.textContent=row.delta || "";
      line.append(label,value,delta);
      tooltip.appendChild(line);
    });
  }

  if(Array.isArray(model?.metrics)) {
    const head=document.createElement("div");
    head.className="chart-tooltip-metric-head";
    ["Metric","WNMU-FM","NPR benchmark"].forEach((text)=>{
      const cell=document.createElement("span");
      cell.textContent=text;
      head.appendChild(cell);
    });
    tooltip.appendChild(head);
    model.metrics.forEach((metric)=>{
      const row=document.createElement("div");
      row.className="chart-tooltip-metric-row";
      const name=document.createElement("strong");
      name.textContent=metric.label || "";
      const station=document.createElement("span");
      station.textContent=[metric.station?.value,metric.station?.delta].filter(Boolean).join(" · ") || "—";
      const benchmark=document.createElement("span");
      benchmark.textContent=[metric.benchmark?.value,metric.benchmark?.delta].filter(Boolean).join(" · ") || "—";
      benchmark.title=metric.benchmark?.label || "NPR benchmark";
      row.append(name,station,benchmark);
      tooltip.appendChild(row);
    });
  }
}

function positionTooltip(container, tooltip, event, target) {
  const containerRect=container.getBoundingClientRect();
  const targetRect=target.getBoundingClientRect();
  const anchorX=event?.clientX ?? (targetRect.left+targetRect.width/2);
  const anchorY=event?.clientY ?? targetRect.top;
  tooltip.style.left=(anchorX-containerRect.left+14)+"px";
  tooltip.style.top=(anchorY-containerRect.top+14)+"px";
  const right=tooltip.offsetLeft+tooltip.offsetWidth;
  const bottom=tooltip.offsetTop+tooltip.offsetHeight;
  if(right>container.clientWidth-6) tooltip.style.left=Math.max(6,container.clientWidth-tooltip.offsetWidth-6)+"px";
  if(bottom>container.clientHeight-6) tooltip.style.top=Math.max(6,anchorY-containerRect.top-tooltip.offsetHeight-14)+"px";
}

function bindChartTooltip(container, element, model) {
  if(!model) return;
  const tooltip=chartTooltip(container);
  const text=tooltipModelText(model);
  if(text) {
    const existing=element.getAttribute("aria-label");
    element.setAttribute("aria-label",(existing ? existing+". " : "")+text.replace(/\n/g,". "));
  }
  const show=(event)=>{
    populateTooltip(tooltip,model);
    tooltip.hidden=false;
    positionTooltip(container,tooltip,event,element);
  };
  const hide=()=>{ tooltip.hidden=true; };
  element.addEventListener("pointerenter",show);
  element.addEventListener("pointermove",(event)=>positionTooltip(container,tooltip,event,element));
  element.addEventListener("pointerleave",hide);
  element.addEventListener("focus",show);
  element.addEventListener("blur",hide);
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
    for (const target of [1,8,15,22]) {
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
  const angle = Number(options.labelAngle ?? (points.some((point)=>point.date) ? -80 : 0));
  const candidates = options.grain === "day" && points.some((point)=>point.date)
    ? dayLabelCandidates(points)
    : points.map((_,index)=>index).filter((index) => {
        const every = options.labelEvery || (points.length <= 24 ? 1 : points.length <= 60 ? 2 : Math.max(2,Math.ceil(points.length/40)));
        return index === 0 || index === points.length - 1 || index % every === 0;
      });
  const gap = Number(options.minLabelGap ?? 2);
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

function attachHorizontalZoom(svg, points, { width, margin, plotWidth, plotHeight, zoomMode, onZoomSelect } = {}) {
  if (!zoomMode || typeof onZoomSelect !== "function" || !Array.isArray(points) || points.length < 2) return;

  svg.classList.add("chart-zoom-active");
  const selection = svgElement("rect",{
    x:margin.left,
    y:margin.top,
    width:0,
    height:plotHeight,
    class:"chart-zoom-selection"
  });
  const hitbox = svgElement("rect",{
    x:margin.left,
    y:margin.top,
    width:plotWidth,
    height:plotHeight,
    class:"chart-zoom-hitbox",
    tabindex:"0",
    role:"button",
    "aria-label":"Drag horizontally across the chart to zoom into a date range"
  });

  let startX = null;
  let pointerId = null;
  const clampX = (value) => Math.max(margin.left,Math.min(width-margin.right,value));
  const svgX = (event) => {
    const bounds=svg.getBoundingClientRect();
    if(!bounds.width) return margin.left;
    return clampX((event.clientX-bounds.left)*(width/bounds.width));
  };
  const resetSelection = () => {
    startX=null;
    pointerId=null;
    selection.setAttribute("width","0");
  };

  hitbox.addEventListener("pointerdown",(event)=>{
    if(event.button !== 0) return;
    event.preventDefault();
    pointerId=event.pointerId;
    startX=svgX(event);
    selection.setAttribute("x",String(startX));
    selection.setAttribute("width","0");
    hitbox.setPointerCapture?.(event.pointerId);
  });
  hitbox.addEventListener("pointermove",(event)=>{
    if(startX===null || event.pointerId!==pointerId) return;
    const current=svgX(event);
    selection.setAttribute("x",String(Math.min(startX,current)));
    selection.setAttribute("width",String(Math.abs(current-startX)));
  });
  hitbox.addEventListener("pointerup",(event)=>{
    if(startX===null || event.pointerId!==pointerId) return;
    event.preventDefault();
    const endX=svgX(event);
    hitbox.releasePointerCapture?.(event.pointerId);
    const distance=Math.abs(endX-startX);
    if(distance<8) { resetSelection(); return; }
    const indexFor=(x)=>Math.max(0,Math.min(points.length-1,Math.round(((x-margin.left)/plotWidth)*(points.length-1))));
    const a=indexFor(startX);
    const b=indexFor(endX);
    const startIndex=Math.min(a,b);
    const endIndex=Math.max(a,b);
    resetSelection();
    if(endIndex<=startIndex) return;
    onZoomSelect(points[startIndex],points[endIndex],startIndex,endIndex);
  });
  hitbox.addEventListener("pointercancel",resetSelection);
  hitbox.addEventListener("keydown",(event)=>{
    if(event.key==="Escape") resetSelection();
  });

  svg.appendChild(selection);
  svg.appendChild(hitbox);
}

export function renderLineChart(container, points, options = {}) {
  clear(container);
  if (!points?.length) {
    container.innerHTML = '<p class="empty-state">No observations are available for this view.</p>';
    return;
  }

  const width = 1100;
  const hasSecondary = points.some((point)=>finiteNumber(point.secondaryValue) !== null);
  const labelAngle = Number(options.labelAngle ?? (points.some((point)=>point.date) ? -80 : 0));
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
      const circle=svgElement("circle",{cx:xFor(index),cy:yFor(point.value),r:3,class:(point.weekend ? "chart-point weekend" : "chart-point") + (options.onPointClick ? " clickable" : ""),...(options.onPointClick ? {tabindex:"0",role:"button","aria-label":"Open details for " + point.label} : {})});
      const primaryModel=point.primaryTooltipModel || point.tooltipModel || null;
      if(primaryModel) {
        bindChartTooltip(container,circle,primaryModel);
      } else {
        const title=svgElement("title");
        title.textContent=tooltipText(point,options,"primary");
        circle.appendChild(title);
      }
      if(options.onPointClick) {
        const activate=()=>options.onPointClick(point,index);
        circle.addEventListener("click",activate);
        circle.addEventListener("keydown",(event)=>{ if(event.key==="Enter"||event.key===" ") { event.preventDefault(); activate(); } });
      }
      svg.appendChild(circle);
    }
    if(finiteNumber(point.secondaryValue) !== null) {
      const circle=svgElement("circle",{cx:xFor(index),cy:yFor(point.secondaryValue),r:2.6,class:"chart-secondary-point"});
      const secondaryModel=point.secondaryTooltipModel || point.tooltipModel || null;
      if(secondaryModel) {
        bindChartTooltip(container,circle,secondaryModel);
      } else {
        const title=svgElement("title");
        title.textContent=tooltipText(point,options,"secondary");
        circle.appendChild(title);
      }
      svg.appendChild(circle);
    }
  });

  const labelIndexes=new Set(selectSpacedLabelIndexes(points,plotWidth,{grain:options.grain,labelEvery:options.labelEvery,labelAngle,minLabelGap:options.minLabelGap}));
  points.forEach((point,index)=>{
    if(!labelIndexes.has(index)) return;
    const x=xFor(index), y=margin.top+plotHeight+18;
    const label=svgElement("text",{x,y,"text-anchor":labelAngle ? "end" : "middle",class:(point.weekend ? "chart-axis-label weekend" : "chart-axis-label") + " dense",...(labelAngle ? {transform:"rotate(" + labelAngle + " " + x + " " + y + ")"} : {})});
    label.textContent=point.shortLabel || point.label; svg.appendChild(label);
  });
  attachHorizontalZoom(svg,points,{ width,margin,plotWidth,plotHeight,zoomMode:options.zoomMode,onZoomSelect:options.onZoomSelect });
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
  const left = 76;
  const right = 58;
  const bottom = Number(options.labelAngle ?? (points.some((point)=>point.date) ? -80 : 0)) ? 92 : 58;
  const labelAngle = Number(options.labelAngle ?? (points.some((point)=>point.date) ? -80 : 0));
  const legendAvailable = width-left-right;
  let legendRows=1;
  let legendUsed=0;
  series.forEach((item)=>{
    const estimated=Math.max(126,String(item.label).length*7+54);
    if(legendUsed && legendUsed+estimated>legendAvailable) {
      legendRows+=1;
      legendUsed=0;
    }
    legendUsed+=estimated;
  });
  const metricLegendStart=42;
  const indexNoteY=metricLegendStart+(legendRows-1)*18+24;
  const margin = { top:indexNoteY+12, right, bottom, left };
  const plotHeight = 264;
  const height = margin.top + plotHeight + margin.bottom;
  const plotWidth = width - margin.left - margin.right;

  const values = points.flatMap((point)=>series.flatMap((item)=>[
    finiteNumber(point.values?.[item.key]),
    finiteNumber(point.benchmarkValues?.[item.key])
  ])).filter((value)=>value !== null);
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
      const bandLeft=monthStart===0 ? margin.left : (xFor(monthStart-1)+xFor(monthStart))/2;
      const bandRight=monthEnd===points.length-1 ? width-margin.right : (xFor(monthEnd)+xFor(monthEnd+1))/2;
      if(monthIndex%2===1) svg.appendChild(svgElement("rect",{x:bandLeft,y:margin.top,width:Math.max(0,bandRight-bandLeft),height:plotHeight,class:"chart-month-band"}));
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
  const indexNote=svgElement("text",{x:width-margin.right,y:indexNoteY,"text-anchor":"end",class:"chart-index-note"});
  indexNote.textContent="Index scale: 100 = each series' selected-range median";
  svg.appendChild(indexNote);

  let styleX=margin.left;
  const addStyleLegend=(className,labelText)=>{
    svg.appendChild(svgElement("line",{x1:styleX,x2:styleX+24,y1:18,y2:18,class:className}));
    const label=svgElement("text",{x:styleX+30,y:22,class:"chart-legend-label"});
    label.textContent=labelText;
    svg.appendChild(label);
    styleX+=Math.max(150,labelText.length*7+62);
  };
  addStyleLegend("chart-station-key","WNMU-FM");
  addStyleLegend("chart-benchmark-key",options.benchmarkLabel || "NPR benchmark");

  let legendX=margin.left;
  let legendY=metricLegendStart;
  series.forEach((item,seriesIndex)=>{
    const estimated=Math.max(126,String(item.label).length*7+54);
    if(legendX>margin.left && legendX+estimated>width-margin.right) {
      legendX=margin.left;
      legendY+=18;
    }
    const metricClass="chart-metric-line chart-series-" + (seriesIndex % 8);
    svg.appendChild(svgElement("line",{x1:legendX,x2:legendX+22,y1:legendY,y2:legendY,class:metricClass}));
    const legend=svgElement("text",{x:legendX+28,y:legendY+4,class:"chart-legend-label"});
    legend.textContent=item.label;
    svg.appendChild(legend);
    legendX+=estimated;

    const pathFor=(bucket)=>{
      let path="";
      let drawing=false;
      points.forEach((point,index)=>{
        const value=finiteNumber(point[bucket]?.[item.key]);
        if(value===null) { drawing=false; return; }
        path+=(drawing ? " L" : "M")+xFor(index).toFixed(1)+","+yFor(value).toFixed(1);
        drawing=true;
      });
      return path;
    };

    const stationPath=pathFor("values");
    if(stationPath) svg.appendChild(svgElement("path",{d:stationPath,class:metricClass}));
    const benchmarkPath=pathFor("benchmarkValues");
    if(benchmarkPath) svg.appendChild(svgElement("path",{d:benchmarkPath,class:metricClass+" chart-benchmark-line"}));

    points.forEach((point,index)=>{
      const stationIndexed=finiteNumber(point.values?.[item.key]);
      if(stationIndexed!==null) {
        const circle=svgElement("circle",{
          cx:xFor(index),
          cy:yFor(stationIndexed),
          r:2.6,
          class:"chart-metric-point chart-series-" + (seriesIndex % 8) + (options.onPointClick ? " clickable" : ""),
          ...(options.onPointClick ? {tabindex:"0",role:"button","aria-label":"Open " + item.label + " details for " + point.label} : {})
        });
        if(point.tooltipModel) bindChartTooltip(container,circle,point.tooltipModel);
        else {
          const title=svgElement("title");
          title.textContent=point.label+" · "+item.label+" · WNMU-FM";
          circle.appendChild(title);
        }
        if(options.onPointClick) {
          const activate=()=>options.onPointClick(point,item);
          circle.addEventListener("click",activate);
          circle.addEventListener("keydown",(event)=>{
            if(event.key==="Enter"||event.key===" ") { event.preventDefault(); activate(); }
          });
        }
        svg.appendChild(circle);
      }

      const benchmarkIndexed=finiteNumber(point.benchmarkValues?.[item.key]);
      if(benchmarkIndexed!==null) {
        const circle=svgElement("circle",{
          cx:xFor(index),
          cy:yFor(benchmarkIndexed),
          r:2.2,
          class:"chart-metric-point chart-benchmark-point chart-series-" + (seriesIndex % 8),
          tabindex:"0",
          role:"img"
        });
        if(point.tooltipModel) bindChartTooltip(container,circle,point.tooltipModel);
        else {
          const title=svgElement("title");
          title.textContent=point.label+" · "+item.label+" · "+(item.benchmarkLabel || "NPR benchmark");
          circle.appendChild(title);
        }
        svg.appendChild(circle);
      }
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
  attachHorizontalZoom(svg,points,{ width,margin,plotWidth,plotHeight,zoomMode:options.zoomMode,onZoomSelect:options.onZoomSelect });
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

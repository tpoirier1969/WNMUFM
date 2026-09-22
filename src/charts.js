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

export function renderLineChart(container, points, options = {}) {
  clear(container);
  if (!points?.length) {
    container.innerHTML = '<p class="empty-state">No observations are available for this view.</p>';
    return;
  }

  const width = 1100;
  const denseLabels = points.length > 20;
  const height = denseLabels ? 350 : 330;
  const margin = { top: 18, right: 22, bottom: denseLabels ? 72 : 56, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = Math.max(0, min - 1);
    max += 1;
  }
  if (min > 0 && options.zeroBaseline !== false) min = 0;

  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": options.ariaLabel || options.title || "Trend chart",
    class: "chart-svg"
  });

  const xFor = (index) => margin.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (value) => margin.top + ((max - Number(value)) / (max - min)) * plotHeight;
  const step = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;

  if (points.some((point) => point.date)) {
    let monthStart = 0;
    let monthIndex = 0;
    while (monthStart < points.length) {
      const monthKey = String(points[monthStart].date || "").slice(0, 7);
      let monthEnd = monthStart;
      while (monthEnd + 1 < points.length && String(points[monthEnd + 1].date || "").slice(0, 7) === monthKey) monthEnd += 1;
      const left = monthStart === 0 ? margin.left : (xFor(monthStart - 1) + xFor(monthStart)) / 2;
      const right = monthEnd === points.length - 1 ? width - margin.right : (xFor(monthEnd) + xFor(monthEnd + 1)) / 2;
      if (monthIndex % 2 === 1) {
        svg.appendChild(svgElement("rect", {
          x: left, y: margin.top, width: Math.max(0, right - left), height: plotHeight, class: "chart-month-band"
        }));
      }
      if (monthStart > 0) {
        svg.appendChild(svgElement("line", {
          x1: xFor(monthStart), x2: xFor(monthStart), y1: margin.top, y2: margin.top + plotHeight, class: "chart-month-line"
        }));
      }
      monthStart = monthEnd + 1;
      monthIndex += 1;
    }
  }

  points.forEach((point, index) => {
    if (!point.weekend) return;
    const x = xFor(index) - step / 2;
    svg.appendChild(svgElement("rect", {
      x: Math.max(margin.left, x),
      y: margin.top,
      width: Math.min(step, width - margin.right - Math.max(margin.left, x)),
      height: plotHeight,
      class: "chart-weekend-band"
    }));
  });

  const baselineY = yFor(min);
  const barWidth = Math.max(1.2, Math.min(13, step * 0.62));
  points.forEach((point, index) => {
    const y = yFor(point.value);
    svg.appendChild(svgElement("rect", {
      x: xFor(index) - barWidth / 2,
      y,
      width: barWidth,
      height: Math.max(0, baselineY - y),
      class: point.weekend ? "chart-background-bar weekend" : "chart-background-bar"
    }));
  });

  for (let i = 0; i <= 4; i += 1) {
    const fraction = i / 4;
    const y = margin.top + plotHeight * fraction;
    const value = max - (max - min) * fraction;
    svg.appendChild(svgElement("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: "chart-grid" }));
    const label = svgElement("text", { x: margin.left - 10, y: y + 4, "text-anchor": "end", class: "chart-axis-label" });
    label.textContent = compactNumber(value);
    svg.appendChild(label);
  }

  points.forEach((point, index) => {
    const x = xFor(index);
    svg.appendChild(svgElement("line", { x1: x, x2: x, y1: margin.top + plotHeight, y2: margin.top + plotHeight + 6, class: "chart-tick" }));
  });

  if (Number.isFinite(Number(options.median))) {
    const medianY = yFor(Number(options.median));
    svg.appendChild(svgElement("line", {
      x1: margin.left, x2: width - margin.right, y1: medianY, y2: medianY, class: "chart-median-line"
    }));
    const medianLabel = svgElement("text", {
      x: width - margin.right - 4, y: medianY - 6, "text-anchor": "end", class: "chart-median-label"
    });
    medianLabel.textContent = `Median ${compactNumber(options.median)}`;
    svg.appendChild(medianLabel);
  }

  const path = points.map((point, index) => `${index ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(" ");
  svg.appendChild(svgElement("path", { d: path, class: "chart-line" }));

  points.forEach((point, index) => {
    const circle = svgElement("circle", {
      cx: xFor(index),
      cy: yFor(point.value),
      r: 3.8,
      class: `${point.weekend ? "chart-point weekend" : "chart-point"}${options.onPointClick ? " clickable" : ""}`,
      ...(options.onPointClick ? { tabindex:"0", role:"button", "aria-label":`Open details for ${point.label}` } : {})
    });
    const title = svgElement("title");
    title.textContent = `${point.label}: ${compactNumber(point.value)}`;
    circle.appendChild(title);
    if (options.onPointClick) {
      const activate = () => options.onPointClick(point, index);
      circle.addEventListener("click", activate);
      circle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
    }
    svg.appendChild(circle);
  });

  const labelIndexes = new Set();
  if (options.grain === "day" && points.some((point) => point.date)) {
    let monthStart = 0;
    while (monthStart < points.length) {
      const monthKey = String(points[monthStart].date || "").slice(0, 7);
      let monthEnd = monthStart;
      while (monthEnd + 1 < points.length && String(points[monthEnd + 1].date || "").slice(0, 7) === monthKey) monthEnd += 1;
      labelIndexes.add(monthStart);
      let lastLabeledDate = new Date(`${points[monthStart].date}T12:00:00Z`);
      for (let candidate = monthStart + 1; candidate <= monthEnd; candidate += 1) {
        const candidateDate = new Date(`${points[candidate].date}T12:00:00Z`);
        if ((candidateDate - lastLabeledDate) / 86400000 >= 7) {
          labelIndexes.add(candidate);
          lastLabeledDate = candidateDate;
        }
      }
      monthStart = monthEnd + 1;
    }
  } else {
    const labelEvery = options.labelEvery || (points.length <= 16 ? 1 : points.length <= 40 ? 2 : Math.max(2, Math.ceil(points.length / 24)));
    points.forEach((point, index) => {
      if (index === 0 || index === points.length - 1 || index % labelEvery === 0) labelIndexes.add(index);
    });
  }

  points.forEach((point, index) => {
    if (!labelIndexes.has(index)) return;
    const x = xFor(index);
    const y = margin.top + plotHeight + 16;
    const label = svgElement("text", {
      x,
      y,
      "text-anchor": denseLabels ? "end" : "middle",
      class: `${point.weekend ? "chart-axis-label weekend" : "chart-axis-label"}${denseLabels ? " dense" : ""}`,
      ...(denseLabels ? { transform: `rotate(-34 ${x} ${y})` } : {})
    });
    label.textContent = point.shortLabel || point.label;
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

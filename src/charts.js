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
  const height = 340;
  const margin = { top: 18, right: 22, bottom: 64, left: 76 };
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
    svg.appendChild(svgElement("line", { x1: x, x2: x, y1: margin.top, y2: margin.top + plotHeight, class: "chart-v-grid" }));
    svg.appendChild(svgElement("line", { x1: x, x2: x, y1: margin.top + plotHeight, y2: margin.top + plotHeight + 7, class: "chart-tick" }));
  });

  const path = points.map((point, index) => `${index ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(" ");
  svg.appendChild(svgElement("path", { d: path, class: "chart-line" }));

  points.forEach((point, index) => {
    const circle = svgElement("circle", {
      cx: xFor(index),
      cy: yFor(point.value),
      r: 3.8,
      class: point.weekend ? "chart-point weekend" : "chart-point"
    });
    const title = svgElement("title");
    title.textContent = `${point.label}: ${compactNumber(point.value)}`;
    circle.appendChild(title);
    svg.appendChild(circle);
  });

  const labelEvery = options.labelEvery || (points.length <= 16 ? 1 : points.length <= 40 ? 2 : Math.ceil(points.length / 16));
  points.forEach((point, index) => {
    if (index !== 0 && index !== points.length - 1 && index % labelEvery !== 0) return;
    const label = svgElement("text", {
      x: xFor(index),
      y: height - 22,
      "text-anchor": "middle",
      class: point.weekend ? "chart-axis-label weekend" : "chart-axis-label"
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

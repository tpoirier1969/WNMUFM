const PARAMS = Object.freeze({
  activeTab:"tab",
  startDate:"start",
  endDate:"end",
  rangeMode:"range",
  trendMetrics:"metrics",
  trendGrain:"grain",
  trendWeekpart:"weekpart",
  trendNotable:"notable",
  trendProgram:"program",
  exploreView:"explore"
});

export function parseViewState(search = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const view = {};

  const read = (key) => {
    const param = PARAMS[key];
    return params.has(param) ? params.get(param) ?? "" : undefined;
  };

  for (const key of ["activeTab","startDate","endDate","rangeMode","trendGrain","trendWeekpart","trendNotable","trendProgram","exploreView"]) {
    const value = read(key);
    if (value !== undefined) view[key] = value;
  }

  const metrics = read("trendMetrics");
  if (metrics !== undefined) {
    view.trendMetrics = metrics.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return view;
}

export function buildViewSearch(view = {}) {
  const params = new URLSearchParams();
  const set = (key, value) => {
    if (value === undefined || value === null || value === "") return;
    params.set(PARAMS[key], String(value));
  };

  set("activeTab", view.activeTab);
  set("startDate", view.startDate);
  set("endDate", view.endDate);
  set("rangeMode", view.rangeMode);
  if (Array.isArray(view.trendMetrics) && view.trendMetrics.length) {
    set("trendMetrics", view.trendMetrics.join(","));
  }
  set("trendGrain", view.trendGrain);
  set("trendWeekpart", view.trendWeekpart);
  set("trendNotable", view.trendNotable);
  set("trendProgram", view.trendProgram);
  set("exploreView", view.exploreView);

  const text = params.toString();
  return text ? `?${text}` : "";
}

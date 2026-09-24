import test from "node:test";
import assert from "node:assert/strict";
import { detectGa4FreeFormReport, detectGa4Report, inspectGa4CsvText, parseGa4Metadata, parseGa4Sections } from "../src/ga4.js";

const wrap=(title,body)=>`# ----------------------------------------
# ${title}
# Account: WNMU-FM Public Radio 90
# Property: WNMU-FM Public Radio 90
# ----------------------------------------
#
# All Users
# Start date: 20260101
# End date: 20260923

${body}
`;

test("GA4 metadata and report detection use the export comments", () => {
  const text=wrap("Pages and screens: Page path and screen class","Page path and screen class,Views\n/,12");
  assert.deepEqual(parseGa4Metadata(text),{
    title:"Pages and screens: Page path and screen class",
    start:"2026-01-01",
    end:"2026-09-23"
  });
  assert.equal(detectGa4Report(parseGa4Metadata(text).title),"pages_and_screens");
});

test("GA4 page exports normalize content and engagement metrics over the source period", () => {
  const text=wrap("Pages and screens: Page path and screen class",[
    "Page path and screen class,Views,Active users,Views per active user,Average engagement time per active user,Event count,Key events,Total revenue",
    "/listen-online,6225,926,6.72,139.45,22063,0,0",
    "/news,1889,445,4.24,55.96,3588,0,0"
  ].join("\n"));
  const result=inspectGa4CsvText(text,{fileName:"pages.csv",stationKey:"wnmu_fm"});
  assert.equal(result.reportKey,"pages_and_screens");
  assert.deepEqual(result.normalized.range,{grain:"unknown",start:"2026-01-01",end:"2026-09-23"});
  assert.equal(result.normalized.status,"imported");
  const views=result.normalized.observations.find((row)=>row.metric_key==="ga4.page_views" && row.dimension_value==="/listen-online");
  const engagement=result.normalized.observations.find((row)=>row.metric_key==="ga4.page_engagement_seconds_per_user" && row.dimension_value==="/listen-online");
  assert.equal(views.station_value,6225);
  assert.equal(views.dimension_type,"ga4_page_path");
  assert.equal(views.period_start,"2026-01-01");
  assert.equal(views.period_end,"2026-09-23");
  assert.equal(engagement.station_value,139.45);
  assert.deepEqual(views.quality_flags,["ga4_aggregate_source_period"]);
});

test("GA4 engagement rates are converted from fractions to display percentages", () => {
  const text=wrap("Demographic details: Country",[
    "Country,Active users,New users,Engaged sessions,Engagement rate,Engaged sessions per active user,Average engagement time per active user,Event count,Key events,User key event rate,Total revenue",
    "United States,202808,198170,85299,0.3600207658,0.4205,11.55,838776,0,0,0",
    "China,14201,14266,94,0.0066062267,0.0066,0.92,49411,0,0,0"
  ].join("\n"));
  const result=inspectGa4CsvText(text,{fileName:"country.csv"});
  const us=result.normalized.observations.find((row)=>row.metric_key==="ga4.country_engagement_rate" && row.dimension_value==="United States");
  assert.ok(Math.abs(us.station_value-36.00207658)<0.00001);
});

test("GA4 multi-section overview parsing finds city, source and tech sections", () => {
  const userText=wrap("User attributes overview",[
    "Country ID,Active users",
    "US,10",
    "",
    "City,Active users",
    "Marquette,2288",
    "Singapore,24604",
    "",
    "Language,Active users",
    "English,100"
  ].join("\n"));
  const userSections=parseGa4Sections(userText);
  assert.equal(userSections.length,3);
  const user=inspectGa4CsvText(userText,{fileName:"users.csv"});
  assert.equal(user.normalized.observations.find((row)=>row.metric_key==="ga4.city_active_users" && row.dimension_value==="Marquette")?.station_value,2288);

  const leadText=wrap("Generate leads overview",[
    "Nth week,New users",
    "0023,10",
    "",
    "Session manual source,Sessions",
    "google,100",
    "chatgpt.com,12"
  ].join("\n"));
  const lead=inspectGa4CsvText(leadText,{fileName:"leads.csv"});
  assert.equal(lead.normalized.observations.find((row)=>row.metric_key==="ga4.sessions_by_manual_source" && row.dimension_value==="chatgpt.com")?.station_value,12);

  const techText=wrap("Tech overview",[
    "Operating system,Active users",
    "Macintosh,234182",
    "",
    "Device category,Active users",
    "desktop,290070",
    "",
    "Screen resolution,Active users",
    "800x600,224155"
  ].join("\n"));
  const tech=inspectGa4CsvText(techText,{fileName:"tech.csv"});
  assert.equal(tech.normalized.observations.find((row)=>row.metric_key==="ga4.screen_active_users")?.station_value,224155);
});

test("recognized low-value GA4 reports are retained without inventing metrics", () => {
  const text=wrap("Audiences: Audience name","Audience name,Total users\nAll Users,314618");
  const result=inspectGa4CsvText(text,{fileName:"audiences.csv"});
  assert.equal(result.reportKey,"audiences");
  assert.equal(result.normalized.observations.length,0);
  assert.equal(result.normalized.status,"partial");
});

test("the app exposes GA4 CSV imports and GA4 Explore views", async () => {
  const fs=await import("node:fs/promises");
  const [app,html]=await Promise.all([
    fs.readFile(new URL("../src/app.js",import.meta.url),"utf8"),
    fs.readFile(new URL("../index.html",import.meta.url),"utf8")
  ]);
  assert.match(html,/accept="\.zip,\.csv,application\/zip,text\/csv"/);
  assert.match(html,/NPR Analytics ZIPs and Google Analytics 4 CSV exports are supported/);
  assert.match(app,/["']ga4-pages["']/);
  assert.match(app,/["']ga4-landing["']/);
  assert.match(app,/["']ga4-traffic["']/);
  assert.match(app,/["']ga4-events["']/);
  assert.match(app,/view\.sourceRange \? \{\} : selectedRange\(\)/);
  assert.match(app,/loadBreakdownDimensionMetrics/);
});


test("GA4 Free Form Date + Page Path exports normalize as daily observations", () => {
  const text=[
    "# ----------------------------------------",
    "# WNMU-FM Public Radio 90",
    "# Free form-Free form 1",
    "# 20260723-20260922",
    "# ----------------------------------------",
    "",
    "Date,Page path and screen class,Active users,Event count,Views,Views per active user,Average engagement time per session",
    ",,211078,847833,309558,1.4665,6.888,Grand total",
    "20260826,/,44963,163565,68392,1.521,0.308",
    "20260826,/listen-online,50,210,130,2.6,12.5",
    "20260825,/,33439,120438,48944,1.463,0.301"
  ].join("\n");
  const metadata=parseGa4Metadata(text);
  assert.equal(metadata.title,"Free form-Free form 1");
  assert.equal(metadata.start,"2026-07-23");
  assert.equal(metadata.end,"2026-09-22");
  const sections=parseGa4Sections(text);
  assert.equal(detectGa4FreeFormReport(sections),"daily_pages");
  const result=inspectGa4CsvText(text,{fileName:"daily-pages.csv",stationKey:"wnmu_fm"});
  assert.equal(result.reportKey,"daily_pages");
  assert.deepEqual(result.normalized.range,{grain:"day",start:"2026-07-23",end:"2026-09-22"});
  const page=result.normalized.observations.find((row)=>row.metric_key==="ga4.page_views" && row.dimension_value==="/listen-online");
  assert.equal(page.period_start,"2026-08-26");
  assert.equal(page.station_value,130);
  assert.deepEqual(page.quality_flags,["ga4_daily_exploration"]);
  const total=result.normalized.observations.find((row)=>row.metric_key==="ga4.site_page_views" && row.period_start==="2026-08-26");
  assert.equal(total.station_value,68522);
  assert.equal(total.dimension_type,"");
});

test("GA4 Free Form landing and session-channel exports preserve their exact metrics", () => {
  const landing=[
    "# WNMU-FM Public Radio 90",
    "# Free form-Free form 1",
    "# 20260723-20260922",
    "",
    "Date,Landing page,Sessions,Active users,New users,Average engagement time per session",
    "20260826,/,49241,44952,44921,0.394",
    "20260826,/listen-online,80,70,50,18"
  ].join("\n");
  const landingResult=inspectGa4CsvText(landing,{fileName:"landing.csv"});
  assert.equal(landingResult.reportKey,"daily_landing");
  assert.equal(landingResult.normalized.observations.find((row)=>row.metric_key==="ga4.site_sessions")?.station_value,49321);

  const channels=[
    "# WNMU-FM Public Radio 90",
    "# Free form-Free form 1",
    "# 20260723-20260922",
    "",
    "Date,Session primary channel group (Default Channel Group),Event count,Active users,Event count per active user",
    "20260826,Direct,164695,45251,3.6395",
    "20260826,Organic Search,500,250,2"
  ].join("\n");
  const channelResult=inspectGa4CsvText(channels,{fileName:"channels.csv"});
  assert.equal(channelResult.reportKey,"daily_session_channel");
  assert.equal(channelResult.normalized.observations.find((row)=>row.metric_key==="ga4.channel_event_count" && row.dimension_value==="Direct")?.station_value,164695);
  assert.equal(channelResult.normalized.observations.find((row)=>row.metric_key==="ga4.channel_active_users" && row.dimension_value==="Direct")?.station_value,45251);
});

test("dated GA4 controls are exposed without replacing NPR website metrics", async () => {
  const fs=await import("node:fs/promises");
  const app=await fs.readFile(new URL("../src/app.js",import.meta.url),"utf8");
  assert.match(app,/ga4\.site_page_views/);
  assert.match(app,/ga4\.site_sessions/);
  assert.match(app,/Google Analytics 4 pages that day/);
  assert.match(app,/Date \+ Event name/);
});

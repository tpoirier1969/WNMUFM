import { durationToSeconds, parseCsv } from "./csv.js";

export const STREAMGUYS_PARSER_VERSION = "streamguys-hourly-tlh-v1";

function normalizedHeaderMap(headers = []) {
  return new Map(headers.map((header) => [String(header || "").trim().toLowerCase(), header]));
}

function parseSourceDate(value) {
  const text=String(value ?? "").trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!match) return null;
  const month=Number(match[1]), day=Number(match[2]), year=Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) return null;
  return `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function parseSourceHour(value) {
  const text=String(value ?? "").trim();
  const match=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(!match) return null;
  const hour=Number(match[1]), minute=Number(match[2]), second=Number(match[3] || 0);
  if(hour<0 || hour>23 || minute!==0 || second!==0) return null;
  return `${String(hour).padStart(2,"0")}:00`;
}

function isBlankRow(row = {}) {
  return Object.values(row).every((value)=>String(value ?? "").trim()==="");
}

export function looksLikeStreamGuysCsvText(text) {
  const parsed=parseCsv(text);
  const map=normalizedHeaderMap(parsed.headers);
  return map.has("day") && map.has("tlh") && map.has("hour_of_day_local");
}

export function inspectStreamGuysCsvText(text,{fileName="streamguys.csv",stationKey="wnmu_fm"}={}) {
  const parsed=parseCsv(text);
  const headerMap=normalizedHeaderMap(parsed.headers);
  const dayHeader=headerMap.get("day");
  const tlhHeader=headerMap.get("tlh");
  const hourHeader=headerMap.get("hour_of_day_local");

  if(!dayHeader || !tlhHeader || !hourHeader) {
    throw new Error("This is not a StreamGuys TLH by Day CSV. The file must contain Day, TLH, and hour_of_day_local columns.");
  }

  const observations=[];
  const seen=new Set();
  const hours=new Set();
  let blankTlhCount=0;
  let meaningfulRows=0;

  parsed.rows.forEach((row,index)=>{
    if(isBlankRow(row)) return;
    meaningfulRows += 1;
    const sourceRow=index+2;
    const dayRaw=String(row[dayHeader] ?? "").trim();
    const hourRaw=String(row[hourHeader] ?? "").trim();
    const tlhRaw=String(row[tlhHeader] ?? "").trim();
    const day=parseSourceDate(dayRaw);
    const hour=parseSourceHour(hourRaw);

    if(!day) throw new Error(`StreamGuys row ${sourceRow} has an invalid Day value: "${dayRaw || "(blank)"}".`);
    if(!hour) throw new Error(`StreamGuys row ${sourceRow} has an invalid hour_of_day_local value: "${hourRaw || "(blank)"}". Expected a whole clock hour such as 05:00.`);
    if(!tlhRaw) {
      blankTlhCount += 1;
      return;
    }

    const seconds=durationToSeconds(tlhRaw);
    if(seconds===null || seconds<0) throw new Error(`StreamGuys row ${sourceRow} has an invalid TLH duration: "${tlhRaw}".`);

    const identity=`${day}|${hour}`;
    if(seen.has(identity)) throw new Error(`StreamGuys contains more than one TLH row for ${day} at ${hour}. Export one source value per day/hour before importing.`);
    seen.add(identity);
    hours.add(hour);

    observations.push({
      station_key:stationKey,
      report_type:"station_streaming",
      grain:"day",
      period_start:day,
      period_end:day,
      metric_key:"streamguys.tlh",
      metric_label:"StreamGuys TLH",
      unit:"hours",
      dimension_type:"hour_of_day_local",
      dimension_value:hour,
      filter_signature:`source=StreamGuys;hour_of_day_local=${hour}`,
      station_value:seconds/3600,
      benchmark_value:null,
      benchmark_label:null,
      text_value:null,
      source_import_id:null,
      source_csv:fileName,
      source_row:sourceRow,
      quality_flags:[]
    });
  });

  if(!meaningfulRows) throw new Error("This StreamGuys CSV has no data rows.");
  if(!observations.length) throw new Error("This StreamGuys CSV contains no usable TLH values.");

  const dates=observations.map((row)=>row.period_start).sort();
  const uniqueHours=[...hours].sort();
  const hourContext=uniqueHours.length===1 ? uniqueHours[0] : "multiple";

  return {
    reportLabel:"StreamGuys hourly TLH",
    parserVersion:STREAMGUYS_PARSER_VERSION,
    parsed,
    dataRowCount:meaningfulRows,
    filterContext:{source:"StreamGuys",report:"TLH by Day",hour_of_day_local:hourContext},
    reportRunDate:new Date().toISOString().slice(0,10),
    note:`StreamGuys TLH by Day import. Raw hour_of_day_local is preserved; WNMU schedule-time alignment is applied separately and remains reversible.${blankTlhCount ? ` ${blankTlhCount} blank TLH row(s) remained missing and were not converted to zero.` : ""}`,
    normalized:{
      range:{grain:"day",start:dates[0],end:dates[dates.length-1]},
      observations,
      status:"imported"
    }
  };
}

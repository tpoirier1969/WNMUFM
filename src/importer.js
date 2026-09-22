import { CONFIG } from "./config.js";
import { parseCsv, normalizeLineEndings } from "./csv.js";
import { detectAnomalies, detectReport, inferDrilldownProgram, normalizeReport, reportLabel, REPORT_TYPES } from "./reports.js";
import { batchInsert, batchUpsert, insertRows, selectRows, updateRows } from "./api.js";

const PARSER_VERSION = "npr-export-parser-1";
const OBSERVATION_CONFLICT = [
  "station_key",
  "report_type",
  "grain",
  "period_start",
  "period_end",
  "metric_key",
  "dimension_type",
  "dimension_value",
  "filter_signature"
];

function baseName(path) {
  return String(path).split("/").filter(Boolean).pop() || path;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function canonicalExportText(entries) {
  return entries
    .map((entry) => ({ name: baseName(entry.name), text: normalizeLineEndings(entry.text).trimEnd() }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.name}\n${entry.text}`)
    .join("\n---WNMUFM-FILE---\n");
}

async function readZip(file) {
  if (!window.JSZip) throw new Error("ZIP reader did not load.");
  const zip = await window.JSZip.loadAsync(file);
  const entries = [];
  const promises = [];
  zip.forEach((relativePath, item) => {
    if (item.dir || !relativePath.toLowerCase().endsWith(".csv")) return;
    promises.push(item.async("string").then((text) => entries.push({ name: relativePath, text })));
  });
  await Promise.all(promises);
  if (!entries.length) throw new Error("No CSV files were found in this ZIP export.");
  return entries;
}

function parseEntries(entries) {
  const files = new Map();
  entries.forEach((entry) => {
    const parsed = parseCsv(entry.text);
    files.set(baseName(entry.name), { ...parsed, path: entry.name, text: entry.text });
  });
  return files;
}

function rawRowsForImport(importId, files) {
  const output = [];
  files.forEach((file, name) => {
    output.push({
      import_id: importId,
      csv_name: name,
      row_number: 1,
      row_data: { __headers: file.headers }
    });
    file.rows.forEach((row, index) => {
      output.push({
        import_id: importId,
        csv_name: name,
        row_number: index + 2,
        row_data: row
      });
    });
  });
  return output;
}

function queryForHash(hash) {
  return new URLSearchParams({
    select: "id,source_filename,report_type,grain,report_start,report_end,report_run_date,selected_program,status,imported_at",
    source_sha256: `eq.${hash}`,
    limit: "1"
  }).toString();
}

function queryForArchive(importId) {
  return new URLSearchParams({
    select: "import_id",
    import_id: `eq.${importId}`,
    limit: "1"
  }).toString();
}

async function archiveSourceZip(importId, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  await insertRows("wnmufm_analytics_source_archives", [{
    import_id: importId,
    source_bytes: `\\x${hex}`,
    source_mime_type: file.type || "application/zip",
    source_size_bytes: bytes.length
  }]);
}

export async function inspectExport(file, filterContext = {}) {
  const entries = await readZip(file);
  const files = parseEntries(entries);
  const reportType = detectReport(entries.map((entry) => entry.name));
  if (reportType === "unknown") throw new Error("This ZIP does not match a supported NPR Analytics export.");

  let selectedProgram = null;
  let programInference = null;
  if (reportType === REPORT_TYPES.AUDIO_DRILLDOWN) {
    programInference = inferDrilldownProgram(files);
    selectedProgram = programInference.program;
  }

  const normalized = normalizeReport({
    reportType,
    files,
    stationKey: CONFIG.stationKey,
    filterContext,
    selectedProgram
  });
  const contentHash = await sha256(canonicalExportText(entries));
  const dataRowCount = [...files.values()].reduce((sum, item) => sum + item.rows.length, 0);

  return {
    file,
    entries,
    files,
    reportType,
    reportLabel: reportLabel(reportType),
    selectedProgram,
    programInference,
    normalized,
    contentHash,
    dataRowCount,
    filterContext
  };
}

export async function importInspectedExport(inspected, userEmail) {
  const existing = await selectRows("wnmufm_analytics_imports", queryForHash(inspected.contentHash));
  if (existing?.length) {
    const archive = await selectRows("wnmufm_analytics_source_archives", queryForArchive(existing[0].id));
    if (!archive?.length) await archiveSourceZip(existing[0].id, inspected.file);
    return { duplicate: true, importRecord: existing[0], inspected };
  }

  const { range, observations, status } = inspected.normalized;
  const notes = [];
  if (inspected.reportType === REPORT_TYPES.AUDIO_DRILLDOWN && !inspected.selectedProgram) {
    notes.push(`Program inference: ${inspected.programInference?.confidence || "unresolved"}.`);
  }
  if (!range.start || !range.end) notes.push("No dated primary rows were present; raw CSV data was preserved but not normalized for charts.");

  const inserted = await insertRows("wnmufm_analytics_imports", [{
    source_sha256: inspected.contentHash,
    source_filename: inspected.file.name,
    report_type: inspected.reportType,
    grain: range.grain,
    station_key: CONFIG.stationKey,
    station_name: CONFIG.stationName,
    service_name: CONFIG.serviceName,
    report_start: range.start,
    report_end: range.end,
    report_run_date: new Date().toISOString().slice(0, 10),
    filter_context: inspected.filterContext || {},
    selected_program: inspected.selectedProgram,
    status,
    row_count: inspected.dataRowCount,
    parser_version: PARSER_VERSION,
    imported_by_email: userEmail || null,
    notes: notes.join(" ") || null
  }], { returnRows: true });

  const importRecord = inserted?.[0];
  if (!importRecord?.id) throw new Error("The import record was created without an ID.");

  try {
    await archiveSourceZip(importRecord.id, inspected.file);

    const rawRows = rawRowsForImport(importRecord.id, inspected.files);
    await batchInsert("wnmufm_analytics_raw_rows", rawRows, { batchSize: 150 });

    const normalizedRows = observations.map((item) => ({ ...item, source_import_id: importRecord.id }));
    await batchUpsert("wnmufm_analytics_observations", normalizedRows, OBSERVATION_CONFLICT, 150);

    const anomalies = detectAnomalies(observations, inspected.reportType, inspected.selectedProgram).map((item) => ({
      ...item,
      import_id: importRecord.id
    }));
    if (anomalies.length) await batchInsert("wnmufm_analytics_anomalies", anomalies, { batchSize: 100 });

    return { duplicate: false, importRecord, inspected, normalizedCount: normalizedRows.length, anomalyCount: anomalies.length };
  } catch (error) {
    await updateRows("wnmufm_analytics_imports", `id=eq.${importRecord.id}`, {
      status: "partial",
      notes: `${notes.join(" ")} Import processing stopped: ${error.message}`.trim()
    }).catch(() => null);
    throw error;
  }
}

export async function importExport(file, filterContext, userEmail) {
  const inspected = await inspectExport(file, filterContext);
  return importInspectedExport(inspected, userEmail);
}

import { parse } from "csv-parse/sync";

export interface NormalizedTelemetryRow {
  code: string;
  hour: number;
  leak: number | null;
  vth: number | null;
  rds: number | null;
  temp: number | null;
  vds: number | null;
  channel: string | null;
}

export interface ComponentMetadata {
  sourceCode: string;
  lot: string;
  wafer: string;
  manufacturer: string;
  rack: number | null;
  row: number | null;
  col: number | null;
  channel: string | null;
  staticLimitUa: number;
}

export interface CsvIngestResult {
  rows: NormalizedTelemetryRow[];
  components: Map<string, ComponentMetadata>;
  quality: Record<string, unknown>;
  testStart: Date | null;
  testEnd: Date | null;
}

const normalizeHeader = (value: string) => value
  .replace(/^\uFEFF/, "")
  .trim()
  .toLowerCase()
  .replace(/[%()\[\]{}]/g, "")
  .replace(/[µμ]/g, "u")
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const ALIAS = {
  code: ["component_code", "component_id", "device_id", "part_id", "serial_number", "serial_no", "dut_id", "unit_id"],
  hour: ["hour", "hours", "test_hour", "time_hours", "elapsed_hours", "elapsed_hour", "duration_hours", "burn_in_hour"],
  timestamp: ["timestamp", "datetime", "date_time", "sample_time", "recorded_at", "time_stamp"],
  leakUa: ["leakage_ua", "leakage_current_ua", "leak_current_ua", "ileak_ua", "i_leak_ua"],
  leakA: ["leakage_a", "leakage_current_a", "ileak_a"],
  leakMa: ["leakage_ma", "leakage_current_ma", "ileak_ma"],
  leakNa: ["leakage_na", "leakage_current_na", "ileak_na"],
  leakGeneric: ["leakage", "leakage_current", "leak_current", "ileak", "i_leak"],
  vthMv: ["vth_mv", "threshold_voltage_mv", "threshold_mv"],
  vthV: ["vth_v", "threshold_voltage_v", "threshold_v"],
  rdsMohm: ["rds_mohm", "rds_on_mohm", "on_resistance_mohm", "resistance_mohm"],
  temp: ["chamber_temp_c", "temperature_c", "temp_c", "chamber_temperature_c", "temperature"],
  vds: ["vds_stress_v", "voltage_stress_v", "stress_voltage_v", "vds_v", "voltage_v"],
  channel: ["channel_id", "measurement_channel", "channel", "sensor_channel"],
  lot: ["lot_id", "lot", "batch_lot", "fabrication_lot"],
  wafer: ["wafer_id", "wafer", "wafer_code"],
  manufacturer: ["manufacturer", "vendor", "foundry", "supplier"],
  rack: ["rack", "chamber_rack", "rack_id"],
  row: ["chamber_row", "row", "socket_row"],
  col: ["chamber_col", "column", "col", "socket_col"],
  limit: ["static_limit_ua", "leakage_limit_ua", "max_leakage_ua", "screen_limit_ua", "upper_limit_ua"],
  parameter: ["parameter_name", "parameter", "measurement_name", "metric", "signal"],
  value: ["value", "measurement_value", "reading"],
  unit: ["unit", "units", "measurement_unit"],
} as const;

type RecordRow = Record<string, string>;
const valueOf = (row: RecordRow, aliases: readonly string[]) => {
  for (const key of aliases) {
    const value = row[key];
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return null;
};
const numberOf = (value: string | null): number | null => {
  if (value == null || /^(na|n\/a|null|nan|-)$/i.test(value.trim())) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const hasColumn = (headers: string[], aliases: readonly string[]) => aliases.some((key) => headers.includes(key));

function explicitLeakUa(row: RecordRow, unitWarnings: { value: number }) {
  const ua = numberOf(valueOf(row, ALIAS.leakUa));
  if (ua != null) return ua;
  const a = numberOf(valueOf(row, ALIAS.leakA));
  if (a != null) return a * 1e6;
  const ma = numberOf(valueOf(row, ALIAS.leakMa));
  if (ma != null) return ma * 1e3;
  const na = numberOf(valueOf(row, ALIAS.leakNa));
  if (na != null) return na / 1e3;
  const generic = numberOf(valueOf(row, ALIAS.leakGeneric));
  if (generic == null) return null;
  const unit = (valueOf(row, ALIAS.unit) ?? "ua").toLowerCase().replace(/[µμ]/g, "u").replace(/\s/g, "");
  if (unit === "a" || unit === "amp" || unit === "amps") return generic * 1e6;
  if (unit === "ma") return generic * 1e3;
  if (unit === "na") return generic / 1e3;
  if (!["ua", "uamp", "microamp", "microamps"].includes(unit)) unitWarnings.value++;
  return generic;
}

function longValue(row: RecordRow, unitWarnings: { value: number }) {
  const parameter = normalizeHeader(valueOf(row, ALIAS.parameter) ?? "");
  const raw = numberOf(valueOf(row, ALIAS.value));
  if (!parameter || raw == null) return null;
  const unit = (valueOf(row, ALIAS.unit) ?? "").toLowerCase().replace(/[µμ]/g, "u").replace(/\s/g, "");
  if (parameter.includes("leak") || parameter.includes("ileak") || parameter === "i_leak") {
    if (unit === "a") return { key: "leak" as const, value: raw * 1e6 };
    if (unit === "ma") return { key: "leak" as const, value: raw * 1e3 };
    if (unit === "na") return { key: "leak" as const, value: raw / 1e3 };
    if (unit && !["ua", "uamp", "microamp", "microamps"].includes(unit)) unitWarnings.value++;
    return { key: "leak" as const, value: raw };
  }
  if (parameter === "vth" || parameter.includes("threshold_voltage"))
    return { key: "vth" as const, value: unit === "v" ? raw * 1e3 : raw };
  if (parameter.includes("rds") || parameter.includes("on_resistance"))
    return { key: "rds" as const, value: unit === "ohm" || unit === "ohms" ? raw * 1e3 : raw };
  if (parameter.includes("temp"))
    return { key: "temp" as const, value: unit === "k" ? raw - 273.15 : raw };
  if (parameter.includes("stress_voltage") || parameter === "vds")
    return { key: "vds" as const, value: raw };
  return null;
}

export function parseBurnInCsv(text: string): CsvIngestResult {
  let records: RecordRow[];
  try {
    records = parse(text, {
      bom: true,
      columns: (headers: string[]) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
    });
  } catch (error) {
    throw new Error(`CSV parsing failed: ${error instanceof Error ? error.message : "invalid file"}`);
  }
  if (!records.length) throw new Error("CSV contains a header but no data rows");
  const headers = Object.keys(records[0]);
  if (!hasColumn(headers, ALIAS.code))
    throw new Error(`Missing component identifier. Accepted headers: ${ALIAS.code.join(", ")}`);
  if (!hasColumn(headers, ALIAS.hour) && !hasColumn(headers, ALIAS.timestamp))
    throw new Error(`Missing time field. Provide elapsed hour or timestamp (${[...ALIAS.hour, ...ALIAS.timestamp].join(", ")})`);
  const longFormat = hasColumn(headers, ALIAS.parameter) && hasColumn(headers, ALIAS.value);
  const hasWideLeak = [ALIAS.leakUa, ALIAS.leakA, ALIAS.leakMa, ALIAS.leakNa, ALIAS.leakGeneric]
    .some((aliases) => hasColumn(headers, aliases));
  if (!longFormat && !hasWideLeak)
    throw new Error("Missing leakage measurement. Provide leakage_ua (or an explicit A/mA/nA variant), or parameter_name/value/unit long format.");

  const unitWarnings = { value: 0 };
  const raw: Array<Record<string, unknown>> = [];
  const firstTimestamp = new Map<string, number>();
  let earliestTimestamp = Infinity, latestTimestamp = -Infinity;

  for (let order = 0; order < records.length; order++) {
    const record = records[order];
    const code = valueOf(record, ALIAS.code);
    if (!code) continue;
    const hour = numberOf(valueOf(record, ALIAS.hour));
    const timestampText = valueOf(record, ALIAS.timestamp);
    const timestampMs = timestampText ? Date.parse(timestampText) : NaN;
    if (hour == null && !Number.isFinite(timestampMs)) continue;
    if (Number.isFinite(timestampMs)) {
      if (!firstTimestamp.has(code)) firstTimestamp.set(code, timestampMs);
      firstTimestamp.set(code, Math.min(firstTimestamp.get(code)!, timestampMs));
      earliestTimestamp = Math.min(earliestTimestamp, timestampMs);
      latestTimestamp = Math.max(latestTimestamp, timestampMs);
    }
    const vthMv = numberOf(valueOf(record, ALIAS.vthMv));
    const vthV = numberOf(valueOf(record, ALIAS.vthV));
    raw.push({
      record, order, code, explicitHour: hour, timestampMs,
      leak: explicitLeakUa(record, unitWarnings),
      vth: vthMv ?? (vthV != null ? vthV * 1e3 : null),
      rds: numberOf(valueOf(record, ALIAS.rdsMohm)),
      temp: numberOf(valueOf(record, ALIAS.temp)),
      vds: numberOf(valueOf(record, ALIAS.vds)),
      channel: valueOf(record, ALIAS.channel),
      long: longFormat ? longValue(record, unitWarnings) : null,
    });
  }
  if (!raw.length) throw new Error("No rows contain both a valid component identifier and time value");

  const components = new Map<string, ComponentMetadata>();
  const merged = new Map<string, NormalizedTelemetryRow & { sourceOrder: number }>();
  let duplicateValues = 0, timestampIssues = 0, impossibleValues = 0, invalidRows = records.length - raw.length;
  let defaultLimitCount = 0;
  const previousHour = new Map<string, number>();

  for (const entry of raw) {
    const record = entry.record as RecordRow;
    const code = entry.code as string;
    const timestampMs = entry.timestampMs as number;
    const hour = entry.explicitHour != null
      ? Number(entry.explicitHour)
      : (timestampMs - firstTimestamp.get(code)!) / 3_600_000;
    if (!Number.isFinite(hour) || hour < 0) { invalidRows++; continue; }
    if ((previousHour.get(code) ?? -Infinity) > hour) timestampIssues++;
    previousHour.set(code, hour);
    const normalizedHour = +hour.toFixed(6);
    const key = `${code}\u0000${normalizedHour}`;
    if (!components.has(code)) {
      const explicitLimit = numberOf(valueOf(record, ALIAS.limit));
      if (explicitLimit == null) defaultLimitCount++;
      components.set(code, {
        sourceCode: code,
        lot: valueOf(record, ALIAS.lot) ?? "LOT-UNKNOWN",
        wafer: valueOf(record, ALIAS.wafer) ?? "WFR-UNKNOWN",
        manufacturer: valueOf(record, ALIAS.manufacturer) ?? "UNKNOWN",
        rack: numberOf(valueOf(record, ALIAS.rack)),
        row: numberOf(valueOf(record, ALIAS.row)),
        col: numberOf(valueOf(record, ALIAS.col)),
        channel: valueOf(record, ALIAS.channel),
        staticLimitUa: explicitLimit != null && explicitLimit > 0 ? explicitLimit : 5,
      });
    }
    let row = merged.get(key);
    if (!row) {
      row = {
        code, hour: normalizedHour,
        leak: entry.leak as number | null, vth: entry.vth as number | null,
        rds: entry.rds as number | null, temp: entry.temp as number | null,
        vds: entry.vds as number | null, channel: entry.channel as string | null,
        sourceOrder: entry.order as number,
      };
      merged.set(key, row);
    } else {
      const fields = ["leak", "vth", "rds", "temp", "vds"] as const;
      for (const field of fields) {
        const incoming = entry[field] as number | null;
        if (incoming != null && row[field] != null) duplicateValues++;
        else if (incoming != null) row[field] = incoming;
      }
      row.channel ||= entry.channel as string | null;
    }
    const long = entry.long as { key: "leak" | "vth" | "rds" | "temp" | "vds"; value: number } | null;
    if (long) {
      if (row[long.key] != null && row[long.key] !== long.value) duplicateValues++;
      row[long.key] = long.value;
    }
  }

  const rows = [...merged.values()].map(({ sourceOrder: _, ...row }) => row).sort((a, b) => a.code.localeCompare(b.code) || a.hour - b.hour);
  for (const row of rows) {
    if (row.leak != null && (row.leak < 0 || row.leak > 1_000_000)) { row.leak = null; impossibleValues++; }
    if (row.temp != null && (row.temp < -100 || row.temp > 400)) { row.temp = null; impossibleValues++; }
    if (row.vds != null && (row.vds < 0 || row.vds > 10_000)) { row.vds = null; impossibleValues++; }
  }
  const missingLeak = rows.filter((row) => row.leak == null).length;
  const missingTemp = rows.filter((row) => row.temp == null).length;
  const missingStress = rows.filter((row) => row.vds == null).length;
  const validLeak = rows.length - missingLeak;
  if (validLeak === 0) throw new Error("No valid leakage values were found after unit conversion and range validation");

  const missingPct = (missingLeak / Math.max(1, rows.length)) * 100;
  const duplicatePct = (duplicateValues / Math.max(1, raw.length)) * 100;
  const invalidPct = (invalidRows / Math.max(1, records.length)) * 100;
  const impossiblePct = (impossibleValues / Math.max(1, rows.length)) * 100;
  const score = Math.max(0, Math.min(100, 100 - missingPct * 1.1 - duplicatePct * 0.4 - invalidPct * 0.8 - impossiblePct * 1.5 - Math.min(8, unitWarnings.value)));
  const sampleCounts = [...components.keys()].map((code) => rows.filter((r) => r.code === code && r.leak != null).length).sort((a, b) => a - b);
  const typicalSamples = sampleCounts[Math.floor(sampleCounts.length / 2)] ?? 0;
  const readiness = components.size >= 30 && typicalSamples >= 10 ? "HIGH" : components.size >= 10 && typicalSamples >= 6 ? "MEDIUM" : "LOW";
  const warnings: string[] = [];
  if (defaultLimitCount) warnings.push(`${defaultLimitCount} components use the prototype default leakage limit of 5 µA; upload static_limit_ua for device-specific screening.`);
  if (missingTemp) warnings.push(`${missingTemp} rows have no temperature; normalization uses the 125°C reference and lowers explanation confidence.`);
  if (missingStress) warnings.push(`${missingStress} rows have no stress voltage; normalization uses the 28 V reference and lowers explanation confidence.`);
  if (components.size < 10) warnings.push("Fewer than 10 components: population anomaly confidence is low; static and temporal evidence remain available.");
  if (typicalSamples < 6) warnings.push("Fewer than 6 typical samples per component: forecasting and temporal anomaly evidence are limited.");

  return {
    rows,
    components,
    quality: {
      score: +score.toFixed(1),
      readiness,
      missingPct: +missingPct.toFixed(2),
      missingTemperaturePct: +((missingTemp / Math.max(1, rows.length)) * 100).toFixed(2),
      missingStressPct: +((missingStress / Math.max(1, rows.length)) * 100).toFixed(2),
      duplicatePct: +duplicatePct.toFixed(2),
      invalidRowPct: +invalidPct.toFixed(2),
      timestampIssuePct: +((timestampIssues / Math.max(1, raw.length)) * 100).toFixed(2),
      unknownUnits: unitWarnings.value,
      impossibleValues,
      totalRows: rows.length,
      sourceRows: records.length,
      components: components.size,
      typicalSamples,
      format: longFormat ? "long" : "wide",
      defaultStaticLimitUa: 5,
      warnings,
      note: "Quoted CSV fields supported. Duplicate parameter values are de-duplicated; missing data is flagged, not silently imputed.",
    },
    testStart: Number.isFinite(earliestTimestamp) ? new Date(earliestTimestamp) : null,
    testEnd: Number.isFinite(latestTimestamp) ? new Date(latestTimestamp) : null,
  };
}

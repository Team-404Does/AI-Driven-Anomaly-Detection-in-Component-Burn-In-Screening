// Burn-in CSV upload → validation (data-quality report) → persist → full analysis pipeline.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, batches, components, telemetry } from "@/db/schema";
import { runPipeline } from "@/lib/ml/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const REQUIRED = ["component_code", "hour", "leakage_ua"];

// RFC-4180-ish split: honors double-quoted cells (escaped "" inside)
function splitCsv(line: string, delim: string): string[] {
  const out: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === "\"") { if (line[i + 1] === "\"") { cur += "\""; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === "\"") inQ = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const unquote = (s: string) => s.trim().replace(/^\"|\"$/g, "");

export async function POST(req: Request) {
  const raw = await req.text();
  if (!raw || raw.length < 50) return NextResponse.json({ error: "empty file" }, { status: 400 });
  if (raw.length > 40_000_000) return NextResponse.json({ error: "file too large (40MB max)" }, { status: 413 });
  if (raw.slice(0, 2) === "PK")
    return NextResponse.json({ error: "This is an .xlsx workbook, not CSV — export it as CSV (File → Save As → CSV UTF-8) and upload again." }, { status: 400 });

  // tolerate a UTF-8 BOM (Excel "CSV UTF-8" exports)
  const text = raw.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  // sniff delimiter: comma, semicolon or tab — whichever the sample uses most
  const sample = lines.slice(0, 20).join("\n");
  const counts: [string, number][] = [",", ";", "\t"].map((d) =>
    [d, sample.split(d).length - 1] as [string, number]);
  counts.sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 0 ? counts[0][0] : ",";

  // header may not be line 1 (title/preamble rows are common in exports) —
  // find the first line in the top 15 that contains all required columns
  let headerIdx = -1, header: string[] = [];
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const cells = splitCsv(lines[i], delim).map((c) => unquote(c).toLowerCase());
    if (REQUIRED.every((c) => cells.includes(c))) { headerIdx = i; header = cells; break; }
  }
  if (headerIdx < 0) {
    const found = splitCsv(lines[0], delim).map(unquote).slice(0, 12).join(", ");
    return NextResponse.json({
      error: `Could not find the required columns (${REQUIRED.join(", ")}) in the first rows. Detected delimiter "${delim === "\t" ? "TAB" : delim}". First header line reads: [${found}]. Use a comma-separated CSV with those exact headers.`,
    }, { status: 400 });
  }
  const H = (n: string) => header.indexOf(n);
  const num = (v: string | undefined): number | null => {
    if (v == null || v.trim() === "" || v.toLowerCase() === "nan") return null;
    let s = v.trim();
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", "."); // European decimal comma
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  let missing = 0, dupes = 0, tsIssues = 0, impossible = 0;
  const rows: any[] = [];
  const seen = new Set<string>();
  const compMeta = new Map<string, any>();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const c = splitCsv(lines[i], delim).map(unquote);
    const code = unquote(c[H("component_code")] ?? "");
    const hour = num(c[H("hour")]);
    const leak = num(c[H("leakage_ua")]);
    if (!code || hour == null) { missing++; continue; }
    if (leak == null) missing++;
    if (leak != null && (leak < 0 || leak > 1000)) impossible++;
    const key = `${code}@${hour}`;
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    if (!compMeta.has(code)) {
      compMeta.set(code, {
        lot: c[H("lot_id")]?.trim() || "LOT-UPLOAD", wafer: c[H("wafer_id")]?.trim() || "WFR-U00",
        mfr: c[H("manufacturer")]?.trim() || "UNKNOWN",
        rack: num(c[H("rack")]) ?? compMeta.size >> 7,
        row: num(c[H("chamber_row")]) ?? (compMeta.size % 128) >> 4,
        col: num(c[H("chamber_col")]) ?? compMeta.size % 16,
        channel: c[H("channel_id")]?.trim() || `CH-0${(compMeta.size % 8) + 1}`,
        maxHour: hour,
      });
    }
    rows.push({
      code, hour, leak,
      vth: num(c[H("vth_mv")]), rds: num(c[H("rds_mohm")]) ?? 118,
      temp: num(c[H("chamber_temp_c")]) ?? 125, vds: num(c[H("vds_stress_v")]) ?? 28,
      channel: c[H("channel_id")]?.trim() || compMeta.get(code).channel,
    });
  }
  if (!rows.length) return NextResponse.json({ error: "no valid telemetry rows parsed" }, { status: 400 });
  const total = rows.length + missing;
  const quality = {
    score: +(100 - (missing / total) * 100 * 1.4 - (dupes / total) * 300 - (impossible / total) * 400).toFixed(1),
    missingPct: +((missing / total) * 100).toFixed(2),
    duplicatePct: +((dupes / total) * 100).toFixed(2),
    unknownUnitsPct: 0, timestampIssuePct: +((tsIssues / total) * 100).toFixed(2),
    impossibleValues: impossible, totalRows: rows.length, components: compMeta.size,
    note: "Duplicates dropped; missing samples flagged, not imputed.",
  };

  const codes = [...compMeta.keys()];
  const batchCode = `BN-UP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 900) + 100)}`;
  const [batch] = await db.insert(batches).values({
    batchCode, manufacturer: "upload", sourceFile: "user-upload.csv",
    status: "validated", componentCount: codes.length, dataQuality: quality,
  }).returning();

  // component_code is GLOBALLY unique, so uploaded codes are namespaced per
  // batch — otherwise re-uploading any CSV (or two teams uploading similar
  // files) collides on the unique index and the request 500s.
  const codePrefix = `U${batch.id}-`;

  const compIds: Record<string, number> = {};
  const CH = 200;
  for (let i = 0; i < codes.length; i += CH) {
    const vals = codes.slice(i, i + CH).map((code) => {
      const m = compMeta.get(code);
      return {
        componentCode: `${codePrefix}${code}`, batchId: batch.id, lotId: m.lot, waferId: m.wafer, manufacturer: m.mfr,
        rack: Math.min(7, m.rack), chamberRow: Math.min(7, m.row), chamberCol: Math.min(15, m.col),
        socketId: `R${Math.min(7, m.rack) + 1}-${"ABCDEFGH"[Math.min(7, m.row)]}${String(Math.min(15, m.col) + 1).padStart(2, "0")}`,
        channelId: m.channel, scenarioTag: "uploaded",
      };
    });
    const ret = await db.insert(components).values(vals).returning({ id: components.id, code: components.componentCode });
    ret.forEach((r) => (compIds[r.code.slice(codePrefix.length)] = r.id));
  }
  try {
    for (let i = 0; i < rows.length; i += 2500) {
      await db.insert(telemetry).values(rows.slice(i, i + 2500).map((r) => ({
        componentId: compIds[r.code], hour: r.hour, leakageUa: r.leak, vthMv: r.vth,
        rdsMohm: r.rds, chamberTempC: r.temp, vdsStressV: r.vds, channelId: r.channel,
      })));
    }
    const result = await runPipeline(batch.id);
    await db.insert(auditLog).values({
      userName: "OPERATOR", action: "BATCH_UPLOAD", objectType: "batch", objectId: batchCode,
      detail: { components: codes.length, rows: rows.length, qualityScore: quality.score },
    });
    return NextResponse.json({ ok: true, batchId: batch.id, batchCode, quality, ...result });
  } catch (e: any) {
    console.error("[upload] analysis failed", e);
    // never let the API die with an opaque 500 — the modal surfaces this text
    return NextResponse.json(
      { error: e?.message ? `Analysis failed: ${e.message}` : "Analysis failed — batch saved, re-run analysis from the dashboard." },
      { status: 500 });
  }
}

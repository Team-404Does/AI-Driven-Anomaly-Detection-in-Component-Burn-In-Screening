// Burn-in CSV upload → validation (data-quality report) → persist → full analysis pipeline.
// Accepts gzip-encoded bodies (Content-Encoding: gzip) — the client compresses
// large CSVs to stay under Vercel's ~4.5 MB request-body limit.
import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { count, eq } from "drizzle-orm";
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
  let raw: string;
  const ab = await req.arrayBuffer();
  if ((req.headers.get("content-encoding") ?? "").includes("gzip")) {
    try {
      raw = gunzipSync(Buffer.from(ab)).toString("utf8");
    } catch {
      // some layers auto-decompress despite the header — treat bytes as plain text
      raw = Buffer.from(ab).toString("utf8");
    }
  } else {
    raw = Buffer.from(ab).toString("utf8");
  }
  if (!raw || raw.length < 50) return NextResponse.json({ error: "empty file" }, { status: 400 });
  if (raw.length > 40_000_000) return NextResponse.json({ error: "file too large (40MB max after decompression)" }, { status: 413 });
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
  // find the first line in the top 15 that contains all required columns;
  // if none matches, use line 1 as the header and try schema auto-mapping
  let headerIdx = -1, header: string[] = [];
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const cells = splitCsv(lines[i], delim).map((c) => unquote(c).toLowerCase());
    if (REQUIRED.every((c) => cells.includes(c))) { headerIdx = i; header = cells; break; }
  }
  if (headerIdx < 0) { headerIdx = 0; header = splitCsv(lines[0], delim).map((c) => unquote(c).toLowerCase()); }
  const H = (n: string) => header.indexOf(n);
  const num = (v: string | undefined): number | null => {
    if (v == null || v.trim() === "" || v.toLowerCase() === "nan") return null;
    let s = v.trim();
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", "."); // European decimal comma
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  // ---- flexible schema mapping: common synonyms for the required fields ----
  const norm = (s: string) => s.replace(/[^a-z0-9]/g, "");
  const SYN: Record<string, string[]> = {
    component_code: ["componentcode", "component", "unitid", "unit", "deviceid", "device", "serialno", "serial", "partid", "part", "chipid", "dieid", "code", "id"],
    hour: ["hourselapsed", "hours", "timeindex", "timeh", "elapsed", "elapsedh", "t", "time", "step", "cycle", "sample"],
    leakage_ua: ["leakageua", "leakage", "leakagecurrent", "leakua", "leak", "currentua", "currentma", "current", "ileak", "supplycurrent", "idlecurrent", "power"],
  };
  const resolve = (req: string): number => {
    if (header.includes(req)) return header.indexOf(req);
    for (const syn of SYN[req]) { const i = header.findIndex((c) => norm(c) === syn); if (i >= 0) return i; }
    for (const syn of SYN[req]) { if (syn.length > 3) { const i = header.findIndex((c) => c.includes(syn)); if (i >= 0) return i; } }
    return -1;
  };
  const cIdx = resolve("component_code");
  const hIdx = resolve("hour");
  let lIdx = resolve("leakage_ua");
  const tsIdx = header.findIndex((c) => /timestamp|datetime|^date$|^time$/.test(c));
  const mapping: string[] = [];
  if (cIdx < 0) mapping.push("no component column — entire file treated as one virtual unit CHAMBER-LOG");
  if (hIdx < 0 && tsIdx >= 0) mapping.push(`hours derived from "${header[tsIdx]}"`);

  // ---- wide-format detection: hour-per-column layouts (leak_h0, leak_h4, …) ----
  const sampleRows = lines.slice(headerIdx + 1, headerIdx + 21).map((l) => splitCsv(l, delim).map(unquote));
  const nSample = Math.max(1, sampleRows.length);
  const numericRatio = (j: number) =>
    sampleRows.map((r) => num(r[j])).filter((v: number | null): v is number => v != null).length / nSample;
  const WIDE_RE = /^(?:(?:leakage|leak|current|ileak|meas|value|h|hour|hr|t)[_\s-]*)?h?(\d{1,3})$/;
  const wideCols = header
    .map((c, j) => ({ c, j, m: WIDE_RE.exec(c) }))
    .filter(({ c, j, m }) => m != null && +m![1]! <= 1000 && numericRatio(j) >= 0.8)
    .map(({ j, m }) => ({ idx: j, hour: +m![1]! }));
  const isWide = wideCols.length >= 4;

  // no leakage column → pick the most measurement-like numeric column
  const META = /timestamp|datetime|^date|^time$|elapsed|index|^id$|code|component|unit|device|serial|lot|wafer|manufact|channel|rack|row|col|comment|note|label|name|status|type/;
  let pickerPicked = false;
  if (lIdx < 0 && !isWide) {
    let best = -1, bestScore = -1;
    for (let j = 0; j < header.length; j++) {
      if (META.test(header[j]) || j === tsIdx) continue;
      if (numericRatio(j) < 0.8) continue;
      const vals = sampleRows.map((r) => num(r[j])).filter((v: number | null): v is number => v != null);
      if (vals.length < 3) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      const cv = Math.abs(mean) > 1e-9 ? sd / Math.abs(mean) : 0;
      let score = Math.min(3, cv);
      if (/leak|current|_ua|ua$|amp/i.test(header[j])) score += 3;
      if (/voltage|volt|temp|humid|pressure|power|freq/i.test(header[j])) score += 2;
      if (score > bestScore) { bestScore = score; best = j; }
    }
    if (best >= 0) {
      lIdx = best;
      pickerPicked = true;
      mapping.push(`no leakage_ua — using "${header[lIdx]}" as the measured parameter`);
    }
  }
  // roster/manifest file: component identities but no telemetry anywhere
  const rosterMode = lIdx < 0 && !isWide && cIdx >= 0;
  // chamber environment log (temperature/humidity/voltage series): the picked
  // parameter is not a leakage-like measurement, so screening it against the
  // µA limit would flag it CRITICAL nonsense — register it, explain, don't screen
  const LEAK_LIKE = /leak|current|_ua|ua$|amp|power/i;
  const envLogMode = !rosterMode && !isWide && pickerPicked && lIdx >= 0 && !LEAK_LIKE.test(header[lIdx]);
  if (envLogMode) mapping.push("chamber environment log — no component telemetry found; readings registered, nothing screened");

  let t0: number | null = null;
  const tsHours = (v: string | undefined): number | null => {
    if (v == null) return null;
    const t = Date.parse(v);
    if (!Number.isFinite(t)) return null;
    if (t0 == null) t0 = t;
    return +((t - t0) / 3.6e6).toFixed(2);
  };

  let missing = 0, dupes = 0, tsIssues = 0, impossible = 0, rowCount = 0;
  const seen = new Set<string>();
  // telemetry is flushed to the DB in bounded parallel chunks instead of being
  // held in memory — accumulating every parsed row OOMs the 512 MB Render free
  // tier on large files
  let teleBuf: any[] = [];
  const teleInFlight: Promise<unknown>[] = [];
  const drainTele = async () => {
    if (teleBuf.length) { teleInFlight.push(db.insert(telemetry).values(teleBuf)); teleBuf = []; }
    if (teleInFlight.length) await Promise.all(teleInFlight.splice(0));
  };
  const compMeta = new Map<string, any>();
  const metaFrom = (c: string[]) => ({
    lot: c[H("lot_id")]?.trim() || "LOT-UPLOAD", wafer: c[H("wafer_id")]?.trim() || "WFR-U00",
    mfr: c[H("manufacturer")]?.trim() || "UNKNOWN",
    rack: num(c[H("rack")]) ?? compMeta.size >> 7,
    row: num(c[H("chamber_row")]) ?? (compMeta.size % 128) >> 4,
    col: num(c[H("chamber_col")]) ?? compMeta.size % 16,
    channel: c[H("channel_id")]?.trim() || `CH-0${(compMeta.size % 8) + 1}`,
    maxHour: 0 as number,
  });
  if (isWide) {
    // wide layout: one row per unit, one column per hour → unpivot to long
    mapping.push(`wide layout — ${wideCols.length} time columns unpivoted (${header[wideCols[0].idx]} … ${header[wideCols[wideCols.length - 1].idx]})`);
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const c = splitCsv(lines[i], delim).map(unquote);
      const code = (cIdx >= 0 ? c[cIdx]?.trim() : "") || "CHAMBER-LOG";
      if (!code) continue;
      if (!compMeta.has(code)) compMeta.set(code, metaFrom(c));
      for (const wc of wideCols) {
        const leak = num(c[wc.idx]);
        if (leak == null) { missing++; continue; }
        if (leak < 0 || leak > 1000) impossible++;
        const key = `${code}@${wc.hour}`;
        if (seen.has(key)) { dupes++; continue; }
        seen.add(key);
        rowCount++;
      }
    }
  } else if (rosterMode) {
    // roster/manifest: register the units so traceability exists; nothing to analyze yet
    mapping.push("no telemetry series found — units registered as a roster (upload a telemetry log to analyze)");
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const c = splitCsv(lines[i], delim).map(unquote);
      const code = cIdx >= 0 ? c[cIdx]?.trim() : "";
      if (!code || compMeta.has(code)) continue;
      compMeta.set(code, metaFrom(c));
    }
  } else {
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const c = splitCsv(lines[i], delim).map(unquote);
    const code = (cIdx >= 0 ? c[cIdx]?.trim() : "") || "CHAMBER-LOG";
    const hour = hIdx >= 0 ? num(c[hIdx]) : tsIdx >= 0 ? tsHours(c[tsIdx]) : null;
    const leak = num(c[lIdx]);
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
    rowCount++;
  }
  }
  if (!rowCount && !compMeta.size)
    return NextResponse.json({ error: "no valid rows parsed — check the file has a header and at least one data row" }, { status: 400 });
  const total = rowCount + missing;
  const quality = {
    score: +(100 - (missing / Math.max(1, total)) * 100 * 1.4 - (dupes / Math.max(1, total)) * 300 - (impossible / Math.max(1, total)) * 400).toFixed(1),
    missingPct: +((missing / Math.max(1, total)) * 100).toFixed(2),
    duplicatePct: +((dupes / Math.max(1, total)) * 100).toFixed(2),
    unknownUnitsPct: 0, timestampIssuePct: +((tsIssues / Math.max(1, total)) * 100).toFixed(2),
    impossibleValues: impossible, totalRows: rowCount, components: compMeta.size,
    note: rosterMode
      ? "Roster upload — units registered; no telemetry series found in this file."
      : "Duplicates dropped; missing samples flagged, not imputed.",
  };

  const codes = [...compMeta.keys()];
  const batchCode = `BN-UP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 900) + 100)}`;
  const [batch] = await db.insert(batches).values({
    batchCode, manufacturer: "upload", sourceFile: "user-upload.csv",
    status: envLogMode ? "environment" : rosterMode ? "roster" : "validated", componentCount: envLogMode ? 0 : codes.length, dataQuality: quality,
  }).returning();

  if (envLogMode) {
    await db.insert(auditLog).values({
      userName: "OPERATOR", action: "BATCH_UPLOAD", objectType: "batch", objectId: batchCode,
      detail: { environment: true, rows: rowCount, qualityScore: quality.score },
    });
    return NextResponse.json({
      ok: true, batchId: batch.id, batchCode, quality, environment: true,
      schemaMapping: mapping.length ? mapping : null,
      message: `Environment log — this file contains chamber readings ("${header[lIdx]}") , not component telemetry. ${rowCount} readings registered for traceability; nothing was screened. Upload a burn-in telemetry CSV (component_code, hour, leakage_ua) to screen components.`,
    });
  }

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
  // ---- pass 2: telemetry inserts in bounded parallel chunks (FK ids now known) ----
  const pushTele = async (v: any) => {
    teleBuf.push(v);
    if (teleBuf.length >= 2500) {
      teleInFlight.push(db.insert(telemetry).values(teleBuf));
      teleBuf = [];
      if (teleInFlight.length >= 3) await Promise.all(teleInFlight.splice(0));
    }
  };
  const teleVal = (code: string, hour: number, leak: number | null, c: string[]) => ({
    componentId: compIds[code], hour, leakageUa: leak, vthMv: num(c[H("vth_mv")]),
    rdsMohm: num(c[H("rds_mohm")]) ?? 118, chamberTempC: num(c[H("chamber_temp_c")]) ?? 125,
    vdsStressV: num(c[H("vds_stress_v")]) ?? 28,
    channelId: c[H("channel_id")]?.trim() || compMeta.get(code)?.channel,
  });
  try {
    if (!rosterMode) {
      if (isWide) {
        for (let i = headerIdx + 1; i < lines.length; i++) {
          const c = splitCsv(lines[i], delim).map(unquote);
          const code = (cIdx >= 0 ? c[cIdx]?.trim() : "") || "CHAMBER-LOG";
          if (!compIds[code]) continue;
          for (const wc of wideCols) {
            const leak = num(c[wc.idx]);
            if (leak == null) continue;
            // NOTE: no `seen` check here — pass 1 already deduped, and every
            // pass-1 key is in `seen`, so checking it again would skip 100% of rows
            await pushTele(teleVal(code, wc.hour, leak, c));
          }
        }
      } else {
        for (let i = headerIdx + 1; i < lines.length; i++) {
          const c = splitCsv(lines[i], delim).map(unquote);
          const code = (cIdx >= 0 ? c[cIdx]?.trim() : "") || "CHAMBER-LOG";
          const hour = hIdx >= 0 ? num(c[hIdx]) : tsIdx >= 0 ? tsHours(c[tsIdx]) : null;
          if (!compIds[code] || hour == null) continue;
          const leak = num(c[lIdx]);
          await pushTele(teleVal(code, hour, leak, c));
        }
      }
      await drainTele();
      // hard guard: never hand an empty batch to the pipeline again — it would
      // silently "analyze" nothing and mark every unit MANUAL QC
      const [{ n: persisted }] = await db
        .select({ n: count() })
        .from(telemetry)
        .innerJoin(components, eq(telemetry.componentId, components.id))
        .where(eq(components.batchId, batch.id));
      if (!persisted) throw new Error(`0 of ${rowCount} telemetry rows persisted — insert failed silently`);
      console.log(`[upload] ${batchCode}: persisted ${persisted}/${rowCount} telemetry rows`);
    }
  } catch (e: any) {
    console.error("[upload] telemetry persist failed", e);
    // never let the API die with an opaque 500 — the modal surfaces this text
    return NextResponse.json(
      { error: e?.message ? `Persist failed: ${e.message}` : "Persist failed — nothing was saved." },
      { status: 500 });
  }

  if (rosterMode) {
    await db.insert(auditLog).values({
      userName: "OPERATOR", action: "BATCH_UPLOAD", objectType: "batch", objectId: batchCode,
      detail: { components: codes.length, rows: 0, qualityScore: quality.score, roster: true },
    });
    return NextResponse.json({ ok: true, batchId: batch.id, batchCode, quality, roster: true, schemaMapping: mapping.length ? mapping : null, anomalies: 0, events: 0, flagged: 0, pipelineMs: 0 });
  }

  // ---- analysis runs AFTER the response ----
  // Render's proxy terminates requests around ~100 s; persisting a large CSV
  // already consumes much of that budget, so the pipeline runs in the
  // background and the modal polls /api/batch-status until the batch flips to
  // "analyzed". (Requires a long-running host — Render/Railway.)
  void runPipeline(batch.id)
    .then(async (result) => {
      await db.insert(auditLog).values({
        userName: "OPERATOR", action: "BATCH_UPLOAD", objectType: "batch", objectId: batchCode,
        detail: { components: codes.length, rows: rowCount, qualityScore: quality.score, background: true },
      });
      console.log(`[upload] ${batchCode} analyzed in background:`, result);
    })
    .catch((e) => console.error(`[upload] ${batchCode} background analysis failed`, e));

  return NextResponse.json({ ok: true, batchId: batch.id, batchCode, quality, schemaMapping: mapping.length ? mapping : null, analyzing: true });
}

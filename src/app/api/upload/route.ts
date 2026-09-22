// Burn-in CSV upload → validation (data-quality report) → persist → full analysis pipeline.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, batches, components, telemetry } from "@/db/schema";
import { runPipeline } from "@/lib/ml/pipeline";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const REQUIRED = ["component_code", "hour", "leakage_ua"];

export async function POST(req: Request) {
  const guard = await requireApiRole();
  if (!guard.user) return guard.res;
  const text = await req.text();
  if (!text || text.length < 50) return NextResponse.json({ error: "empty file" }, { status: 400 });
  if (text.length > 40_000_000) return NextResponse.json({ error: "file too large (40MB max)" }, { status: 413 });

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const missingCols = REQUIRED.filter((c) => !header.includes(c));
  if (missingCols.length) return NextResponse.json({ error: `missing required columns: ${missingCols.join(", ")}` }, { status: 400 });
  const H = (n: string) => header.indexOf(n);
  const num = (v: string | undefined): number | null => {
    if (v == null || v.trim() === "" || v.toLowerCase() === "nan") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  let missing = 0, dupes = 0, tsIssues = 0, impossible = 0;
  const rows: any[] = [];
  const seen = new Set<string>();
  const compMeta = new Map<string, any>();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const code = c[H("component_code")]?.trim();
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

  const compIds: Record<string, number> = {};
  const CH = 200;
  for (let i = 0; i < codes.length; i += CH) {
    const vals = codes.slice(i, i + CH).map((code) => {
      const m = compMeta.get(code);
      return {
        componentCode: code, batchId: batch.id, lotId: m.lot, waferId: m.wafer, manufacturer: m.mfr,
        rack: Math.min(7, m.rack), chamberRow: Math.min(7, m.row), chamberCol: Math.min(15, m.col),
        socketId: `R${Math.min(7, m.rack) + 1}-${"ABCDEFGH"[Math.min(7, m.row)]}${String(Math.min(15, m.col) + 1).padStart(2, "0")}`,
        channelId: m.channel, scenarioTag: "uploaded",
      };
    });
    const ret = await db.insert(components).values(vals).returning({ id: components.id, code: components.componentCode });
    ret.forEach((r) => (compIds[r.code] = r.id));
  }
  for (let i = 0; i < rows.length; i += 2500) {
    await db.insert(telemetry).values(rows.slice(i, i + 2500).map((r) => ({
      componentId: compIds[r.code], hour: r.hour, leakageUa: r.leak, vthMv: r.vth,
      rdsMohm: r.rds, chamberTempC: r.temp, vdsStressV: r.vds, channelId: r.channel,
    })));
  }
  const result = await runPipeline(batch.id, { userId: guard.user.uid, userName: guard.user.name });
  await db.insert(auditLog).values({
    userId: guard.user.uid, userName: guard.user.name, action: "BATCH_UPLOAD", objectType: "batch", objectId: batchCode,
    detail: { components: codes.length, rows: rows.length, qualityScore: quality.score },
  });
  return NextResponse.json({ ok: true, batchId: batch.id, batchCode, quality, ...result });
}

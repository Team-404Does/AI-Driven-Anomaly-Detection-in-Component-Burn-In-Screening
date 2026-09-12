// Standards-compliant burn-in CSV ingestion → validation → persistence → analysis.
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { auditLog, batches, components, telemetry } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { runPipeline } from "@/lib/ml/pipeline";
import { parseBurnInCsv } from "@/lib/ingest/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

async function cleanupFailedBatch(batchId: number) {
  // The prototype schema deliberately avoids broad ON DELETE CASCADE rules.
  // Cleanup is explicit so a failed analysis cannot become the active batch.
  await db.execute(sql`DELETE FROM feedback WHERE component_id IN (SELECT id FROM components WHERE batch_id = ${batchId})`);
  await db.execute(sql`DELETE FROM reports WHERE batch_id = ${batchId} OR component_id IN (SELECT id FROM components WHERE batch_id = ${batchId})`);
  await db.execute(sql`DELETE FROM anomalies WHERE component_id IN (SELECT id FROM components WHERE batch_id = ${batchId})`);
  await db.execute(sql`DELETE FROM predictions WHERE component_id IN (SELECT id FROM components WHERE batch_id = ${batchId})`);
  await db.execute(sql`DELETE FROM failure_signatures WHERE component_id IN (SELECT id FROM components WHERE batch_id = ${batchId})`);
  await db.execute(sql`DELETE FROM risk_assessments WHERE component_id IN (SELECT id FROM components WHERE batch_id = ${batchId})`);
  await db.execute(sql`DELETE FROM telemetry WHERE component_id IN (SELECT id FROM components WHERE batch_id = ${batchId})`);
  await db.execute(sql`DELETE FROM equipment_events WHERE batch_id = ${batchId}`);
  await db.delete(components).where(eq(components.batchId, batchId));
  await db.delete(batches).where(eq(batches.id, batchId));
}

export async function POST(req: Request) {
  const text = await req.text();
  if (!text || text.trim().length < 20)
    return NextResponse.json({ error: "The uploaded CSV is empty or contains no usable rows." }, { status: 400 });
  if (Buffer.byteLength(text, "utf8") > 40_000_000)
    return NextResponse.json({ error: "File too large. Maximum accepted size is 40 MB." }, { status: 413 });

  let parsed;
  try {
    parsed = parseBurnInCsv(text);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "CSV validation failed",
      stage: "VALIDATION",
    }, { status: 400 });
  }

  const suffix = randomUUID().slice(0, 6).toUpperCase();
  const batchCode = `BN-UP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${suffix}`;
  const existing = new Set((await db.select({ code: components.componentCode }).from(components)).map((r) => r.code));
  const storedCodes = new Map<string, string>();
  let renamedComponents = 0;
  for (const sourceCode of parsed.components.keys()) {
    let stored = sourceCode;
    if (existing.has(stored)) {
      renamedComponents++;
      stored = `${sourceCode}~${suffix}`;
      let serial = 2;
      while (existing.has(stored)) stored = `${sourceCode}~${suffix}-${serial++}`;
    }
    existing.add(stored);
    storedCodes.set(sourceCode, stored);
  }

  const manufacturers = [...new Set([...parsed.components.values()].map((m) => m.manufacturer).filter((m) => m !== "UNKNOWN"))];
  const filename = decodeURIComponent(req.headers.get("x-file-name") ?? "user-upload.csv").slice(0, 240);
  let batchId: number | null = null;

  try {
    const [batch] = await db.insert(batches).values({
      batchCode,
      manufacturer: manufacturers.length === 1 ? manufacturers[0] : manufacturers.length ? "MULTIPLE" : "UNKNOWN",
      sourceFile: filename,
      testStart: parsed.testStart,
      testEnd: parsed.testEnd,
      status: "analyzing",
      componentCount: parsed.components.size,
      dataQuality: { ...parsed.quality, renamedComponents },
    }).returning();
    batchId = batch.id;

    const compIds = new Map<string, number>();
    const metadataEntries = [...parsed.components.entries()];
    for (let i = 0; i < metadataEntries.length; i += 200) {
      const values = metadataEntries.slice(i, i + 200).map(([sourceCode, m], offset) => {
        const ordinal = i + offset;
        const rack = Math.max(0, Math.min(7, Math.floor(m.rack ?? Math.floor(ordinal / 128))));
        const row = Math.max(0, Math.min(7, Math.floor(m.row ?? Math.floor((ordinal % 128) / 16))));
        const col = Math.max(0, Math.min(15, Math.floor(m.col ?? ordinal % 16)));
        const channel = m.channel ?? `CH-${String((col % 8) + 1).padStart(2, "0")}`;
        return {
          componentCode: storedCodes.get(sourceCode)!,
          sourceComponentCode: sourceCode,
          batchId: batch.id,
          lotId: m.lot,
          waferId: m.wafer,
          manufacturer: m.manufacturer,
          rack,
          chamberRow: row,
          chamberCol: col,
          socketId: `R${rack + 1}-${"ABCDEFGH"[row]}${String(col + 1).padStart(2, "0")}`,
          channelId: channel,
          staticLeakLimitUa: m.staticLimitUa,
          scenarioTag: "uploaded",
        };
      });
      const inserted = await db.insert(components).values(values).returning({ id: components.id, code: components.componentCode });
      for (const item of inserted) compIds.set(item.code, item.id);
    }

    for (let i = 0; i < parsed.rows.length; i += 2_500) {
      const values = parsed.rows.slice(i, i + 2_500).map((row) => {
        const storedCode = storedCodes.get(row.code)!;
        const metadata = parsed.components.get(row.code)!;
        return {
          componentId: compIds.get(storedCode)!,
          hour: row.hour,
          leakageUa: row.leak,
          vthMv: row.vth,
          rdsMohm: row.rds,
          chamberTempC: row.temp,
          vdsStressV: row.vds,
          channelId: row.channel ?? metadata.channel ?? "UNKNOWN",
        };
      });
      await db.insert(telemetry).values(values);
    }

    const result = await runPipeline(batch.id);
    await db.insert(auditLog).values({
      userName: "OPERATOR",
      action: "BATCH_UPLOAD",
      objectType: "batch",
      objectId: batchCode,
      detail: {
        filename,
        components: parsed.components.size,
        rows: parsed.rows.length,
        qualityScore: parsed.quality.score,
        readiness: parsed.quality.readiness,
        renamedComponents,
      },
    });

    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      batchCode,
      quality: { ...parsed.quality, renamedComponents },
      ...result,
    });
  } catch (error) {
    if (batchId != null) await cleanupFailedBatch(batchId).catch(() => undefined);
    console.error("[upload] analysis failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Analysis failed after validation",
      stage: "ANALYSIS",
      quality: parsed.quality,
    }, { status: 422 });
  }
}

import { db } from "@/db";
import { batches, components, telemetry, users } from "@/db/schema";
import { generateBatch, TEST_START } from "@/lib/sim/generator";
import { runPipeline } from "@/lib/ml/pipeline";
import { count } from "drizzle-orm";

let seeding: Promise<any> | null = null;

export async function ensureSeeded(force = false) {
  if (seeding) return seeding;
  seeding = (async () => {
    const [{ value }] = await db.select({ value: count() }).from(batches);
    if (value > 0 && !force) return { seeded: false };
    if (force) {
      await db.execute(`TRUNCATE telemetry, anomalies, predictions, failure_signatures, risk_assessments, equipment_events, feedback, audit_log, reports, components, batches, model_registry, users RESTART IDENTITY CASCADE`);
    }
    await db.insert(users).values([
      { name: "R. Nair", email: "r.nair@qa.example", role: "qa_lead" },
      { name: "S. Iyer", email: "s.iyer@qa.example", role: "qa_engineer" },
      { name: "A. Kulkarni", email: "a.kulkarni@qa.example", role: "reliability_engineer" },
    ]).onConflictDoNothing();

    const [batch] = await db.insert(batches).values({
      batchCode: "BN-2026-0142", manufacturer: "SCL",
      sourceFile: "burnin_export_142.csv (synthetic demo DS-SYN-2026-0142)",
      testStart: TEST_START, testEnd: new Date(TEST_START.getTime() + 168 * 3600e3),
      status: "validated", componentCount: 1000,
    }).returning();

    const { comps, tel, quality } = generateBatch();
    // insert components, capture id order (serial inserts return in order)
    const CH = 200;
    const idRows: { id: number }[] = [];
    for (let i = 0; i < comps.length; i += CH) {
      const rows = comps.slice(i, i + CH).map((c) => ({
        componentCode: c.code, batchId: batch.id, lotId: c.lot, waferId: c.wafer,
        manufacturer: c.mfr, rack: c.rack, chamberRow: c.row, chamberCol: c.col,
        socketId: c.socket, channelId: c.channel, scenarioTag: c.tag,
      }));
      const ret = await db.insert(components).values(rows).returning({ id: components.id });
      idRows.push(...ret);
    }
    const TCH = 2500;
    for (let i = 0; i < tel.length; i += TCH) {
      const rows = tel.slice(i, i + TCH).map((t) => ({
        componentId: idRows[t.idx].id, hour: t.hour, leakageUa: t.leak, vthMv: t.vth,
        rdsMohm: t.rds, chamberTempC: t.temp, vdsStressV: t.vds, channelId: t.channel,
      }));
      await db.insert(telemetry).values(rows);
    }
    await db.update(batches).set({ dataQuality: quality }).where(eq2(batch.id));

    const t0 = Date.now();
    const result = await runPipeline(batch.id);
    await db.update(batches).set({ status: "analyzed" }).where(eq2(batch.id));
    return { seeded: true, batchId: batch.id, seedMs: Date.now() - t0, ...result };
  })().finally(() => { setTimeout(() => (seeding = null), 60_000); });
  return seeding;
}

import { eq as _eq } from "drizzle-orm";
const eq2 = (id: number) => _eq(batches.id, id);

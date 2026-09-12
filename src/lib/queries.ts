// Server-side data access for pages.
import { db } from "@/db";
import {
  anomalies, auditLog, batches, components, equipmentEvents, failureSignatures,
  feedback, modelRegistry, predictions, reports, riskAssessments, telemetry,
} from "@/db/schema";
import { and, asc, desc, eq, ilike, inArray, or, sql, count, type SQL } from "drizzle-orm";

export async function getBatches() {
  return db.select().from(batches).orderBy(desc(batches.createdAt));
}

export async function getActiveBatch(bParam?: string) {
  const all = await getBatches();
  if (!all.length) return null;
  if (bParam) {
    const hit = all.find((b) => b.batchCode === bParam || String(b.id) === bParam);
    if (hit) return hit;
  }
  return all[0];
}

export async function getChamber(batchId: number, rack: number) {
  return db.select().from(components)
    .where(and(eq(components.batchId, batchId), eq(components.rack, rack)))
    .orderBy(asc(components.chamberRow), asc(components.chamberCol));
}

export interface CompFilter { q?: string; status?: string; lot?: string; decision?: string; hidden?: boolean; page?: number; pageSize?: number; }
export async function getComponents(batchId: number, f: CompFilter) {
  const conds: SQL[] = [eq(components.batchId, batchId)];
  if (f.q) conds.push(or(ilike(components.componentCode, `%${f.q}%`), ilike(components.socketId, `%${f.q}%`), ilike(components.lotId, `%${f.q}%`))!);
  if (f.status) conds.push(eq(components.status, f.status));
  if (f.lot) conds.push(eq(components.lotId, f.lot));
  if (f.decision) conds.push(eq(components.decision, f.decision));
  if (f.hidden) conds.push(eq(components.hiddenAnomaly, true));
  const where = and(...conds);
  const page = Math.max(1, f.page ?? 1), pageSize = Math.min(100, f.pageSize ?? 40);
  const [rows, [{ value: total }]] = await Promise.all([
    db.select().from(components).where(where).orderBy(desc(components.riskScore), asc(components.componentCode)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ value: count() }).from(components).where(where),
  ]);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getPassport(code: string) {
  const [comp] = await db.select().from(components).where(eq(components.componentCode, code));
  if (!comp) return null;
  const [tel, ans, preds, sigs, risks, fbs, reps] = await Promise.all([
    db.select().from(telemetry).where(eq(telemetry.componentId, comp.id)).orderBy(asc(telemetry.hour)),
    db.select().from(anomalies).where(eq(anomalies.componentId, comp.id)).orderBy(desc(anomalies.createdAt)),
    db.select().from(predictions).where(eq(predictions.componentId, comp.id)),
    db.select().from(failureSignatures).where(eq(failureSignatures.componentId, comp.id)),
    db.select().from(riskAssessments).where(eq(riskAssessments.componentId, comp.id)).orderBy(desc(riskAssessments.createdAt)),
    db.select().from(feedback).where(eq(feedback.componentId, comp.id)).orderBy(desc(feedback.createdAt)),
    db.select().from(reports).where(eq(reports.componentId, comp.id)).orderBy(desc(reports.createdAt)),
  ]);
  // peer: healthy component on the same wafer for replay comparison
  const [peer] = await db.select().from(components)
    .where(and(eq(components.waferId, comp.waferId), eq(components.status, "healthy"), sql`${components.id} != ${comp.id}`))
    .limit(1);
  const peerTel = peer ? await db.select().from(telemetry).where(eq(telemetry.componentId, peer.id)).orderBy(asc(telemetry.hour)) : [];
  // lot context
  const lotRows = await db.select({
    status: components.status, n: count(),
  }).from(components).where(and(eq(components.batchId, comp.batchId), eq(components.lotId, comp.lotId))).groupBy(components.status);
  const [lotStats] = await db.select({
    avgScore: sql<number>`avg(${components.anomalyScore})`, avgDrift: sql<number>`avg(${components.driftSlope})`,
  }).from(components).where(and(eq(components.batchId, comp.batchId), eq(components.lotId, comp.lotId)));
  const audits = await db.select().from(auditLog).where(eq(auditLog.objectId, comp.componentCode)).orderBy(desc(auditLog.createdAt)).limit(20);
  return { comp, tel, ans, preds, sigs, risks, fbs, reps, peer, peerTel, lotRows, lotStats, audits };
}

export async function getAnomalyQueue(batchId: number) {
  const rows = await db.select({
    a: anomalies, c: components,
  }).from(anomalies).innerJoin(components, eq(anomalies.componentId, components.id))
    .where(eq(components.batchId, batchId))
    .orderBy(desc(anomalies.anomalyScore), desc(anomalies.createdAt));
  const sigs = await db.select().from(failureSignatures)
    .innerJoin(components, eq(failureSignatures.componentId, components.id))
    .where(eq(components.batchId, batchId));
  const sigMap = new Map(sigs.map((s) => [s.failure_signatures.componentId, s.failure_signatures]));
  const preds = await db.select().from(predictions)
    .innerJoin(components, eq(predictions.componentId, components.id))
    .where(eq(components.batchId, batchId));
  const predMap = new Map(preds.map((p) => [p.predictions.componentId, p.predictions]));
  return rows.map((r) => ({ ...r, sig: sigMap.get(r.c.id) ?? null, pred: predMap.get(r.c.id) ?? null }));
}

export async function getEquipmentEvents(batchId?: number) {
  return db.select().from(equipmentEvents)
    .where(batchId != null ? eq(equipmentEvents.batchId, batchId) : undefined)
    .orderBy(desc(equipmentEvents.createdAt)).limit(20);
}

export async function getGenealogy(batchId: number) {
  const rows = await db.select({
    lot: components.lotId, wafer: components.waferId, mfr: components.manufacturer,
    status: components.status, n: count(), avg: sql<number>`avg(${components.anomalyScore})`,
    maxRisk: sql<number>`max(${components.riskScore})`,
  }).from(components).where(eq(components.batchId, batchId))
    .groupBy(components.lotId, components.waferId, components.manufacturer, components.status);
  // assemble tree
  const lots = new Map<string, any>();
  for (const r of rows) {
    if (!lots.has(r.lot)) lots.set(r.lot, { lot: r.lot, mfr: r.mfr, count: 0, flagged: 0, wafers: new Map<string, any>() });
    const L = lots.get(r.lot);
    if (!L.wafers.has(r.wafer)) L.wafers.set(r.wafer, { wafer: r.wafer, count: 0, flagged: 0 });
    const W = L.wafers.get(r.wafer);
    L.count += r.n; W.count += r.n;
    if (r.status === "critical" || r.status === "watch") { L.flagged += r.n; W.flagged += r.n; }
  }
  return [...lots.values()].map((L) => ({ ...L, wafers: [...L.wafers.values()] }));
}

export async function getModels() { return db.select().from(modelRegistry).orderBy(desc(modelRegistry.active), asc(modelRegistry.type)); }
export async function getAudit(page = 1, pageSize = 30) {
  const [rows, [{ value: total }]] = await Promise.all([
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ value: count() }).from(auditLog),
  ]);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
export async function getReports() {
  const rows = await db.select({ r: reports, c: components }).from(reports)
    .leftJoin(components, eq(reports.componentId, components.id))
    .orderBy(desc(reports.createdAt)).limit(50);
  return rows;
}
export async function getReport(id: number) {
  const [row] = await db.select().from(reports).where(eq(reports.id, id));
  if (!row) return null;
  let pass = null;
  if (row.componentId) {
    const [component] = await db.select().from(components).where(eq(components.id, row.componentId));
    if (component) pass = await getPassport(component.componentCode);
  }
  return { report: row, pass };
}

export async function getFeedbackAll(batchId: number) {
  return db.select({ f: feedback, c: components }).from(feedback)
    .innerJoin(components, eq(feedback.componentId, components.id))
    .where(eq(components.batchId, batchId)).orderBy(desc(feedback.createdAt)).limit(30);
}

export async function searchComponentCodes(q: string) {
  return db.select({ code: components.componentCode, status: components.status, lot: components.lotId, socket: components.socketId })
    .from(components).where(ilike(components.componentCode, `%${q}%`)).orderBy(asc(components.componentCode)).limit(12);
}

export async function batchKbMarginals(batchId: number) {
  // Raw-signal population corridor over the accepted/qualified cohort. Physics-
  // normalized residuals remain in the model pipeline; the explorer intentionally
  // preserves raw telemetry visibility.
  const selectCorridor = (cohortOnly: boolean) => db.select({
    hour: telemetry.hour,
    med: sql<number>`percentile_cont(0.5) within group (order by ${telemetry.leakageUa})`,
    p16: sql<number>`percentile_cont(0.16) within group (order by ${telemetry.leakageUa})`,
    p84: sql<number>`percentile_cont(0.84) within group (order by ${telemetry.leakageUa})`,
    p003: sql<number>`percentile_cont(0.0015) within group (order by ${telemetry.leakageUa})`,
    p998: sql<number>`percentile_cont(0.9985) within group (order by ${telemetry.leakageUa})`,
    medTemp: sql<number>`percentile_cont(0.5) within group (order by ${telemetry.chamberTempC})`,
  }).from(telemetry).innerJoin(components, eq(telemetry.componentId, components.id))
    .where(and(
      eq(components.batchId, batchId),
      sql`${telemetry.leakageUa} IS NOT NULL`,
      cohortOnly ? inArray(components.status, ["healthy", "qualified"]) : undefined,
    ))
    .groupBy(telemetry.hour).orderBy(asc(telemetry.hour));
  const cohort = await selectCorridor(true);
  return cohort.length ? cohort : selectCorridor(false);
}

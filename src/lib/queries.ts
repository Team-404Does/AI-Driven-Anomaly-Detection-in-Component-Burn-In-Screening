// Server-side data access for pages.
import { db } from "@/db";
import {
  anomalies, auditLog, batches, components, equipmentEvents, failureSignatures,
  feedback, modelRegistry, predictions, reports, riskAssessments, telemetry,
} from "@/db/schema";
import { and, asc, desc, eq, ilike, or, sql, count, type SQL } from "drizzle-orm";

export async function getBatches() {
  return db.select().from(batches).orderBy(desc(batches.createdAt));
}

// Sentinel id: when the active "batch" is ALL_DATASETS the dashboards
// aggregate EVERY uploaded dataset (?batch=all / topbar switcher).
export const ALL_BATCHES = -1;

export async function getActiveBatch(bParam?: string) {
  const all = await getBatches();
  if (!all.length) return null;
  const analyzed = all.filter((b) => b.status === "analyzed");
  const fleet = (): any => ({
    id: ALL_BATCHES, batchCode: "ALL DATASETS", status: "all",
    componentCount: analyzed.reduce((s, b) => s + (b.componentCount ?? 0), 0),
    createdAt: all[0].createdAt, stats: {}, dataQuality: {},
  });
  if (bParam === "all" && analyzed.length) return fleet();
  if (bParam) {
    const hit = all.find((b) => b.batchCode === bParam || String(b.id) === bParam);
    if (hit) return hit;
  }
  // default view: with two or more real datasets analyzed, show the fleet
  // (every dataset at once) — a single dataset still gets the focused cockpit.
  // Tiny uploads never hijack the view; the upload modal navigates to them.
  if (analyzed.filter((b) => (b.componentCount ?? 0) >= 10).length >= 2) return fleet();
  return analyzed.find((b) => (b.componentCount ?? 0) >= 10)
    ?? analyzed[0]
    ?? all[0];
}

// Per-dataset rollup + grand totals for the fleet view.
export async function getFleetSummary() {
  const rows = await db.select({
    id: batches.id, code: batches.batchCode, status: batches.status, units: batches.componentCount,
    createdAt: batches.createdAt, quality: batches.dataQuality,
    flagged: sql<number>`(select count(*) from components c where c.batch_id = ${batches.id} and c.decision is not null and c.decision not in ('PASS','PASS-EARLY'))`,
    hidden: sql<number>`(select count(*) from components c where c.batch_id = ${batches.id} and c.hidden_anomaly)`,
  }).from(batches).orderBy(desc(batches.createdAt));
  const byDecision = await db.select({ decision: components.decision, n: count() }).from(components).groupBy(components.decision);
  const [hidden] = await db.select({ n: count() }).from(components).where(eq(components.hiddenAnomaly, true));
  const pass = ["PASS", "PASS-EARLY"];
  return {
    rows,
    totals: {
      units: rows.filter((r) => r.status === "analyzed").reduce((s, r) => s + (r.units ?? 0), 0),
      flagged: byDecision.filter((d) => d.decision && !pass.includes(d.decision)).reduce((s, d) => s + d.n, 0),
      pass: byDecision.filter((d) => pass.includes(d.decision ?? "")).reduce((s, d) => s + d.n, 0),
      hidden: hidden?.n ?? 0,
      datasets: rows.filter((r) => r.status === "analyzed").length,
      byDecision,
    },
  };
}

export async function getChamber(batchId: number, rack: number) {
  const where = batchId === ALL_BATCHES
    ? eq(components.rack, rack)
    : and(eq(components.batchId, batchId), eq(components.rack, rack));
  return db.select().from(components)
    .where(where)
    .orderBy(asc(components.chamberRow), asc(components.chamberCol));
}

export interface CompFilter { q?: string; status?: string; lot?: string; decision?: string; hidden?: boolean; page?: number; pageSize?: number; }
export async function getComponents(batchId: number, f: CompFilter) {
  const conds: SQL[] = [];
  if (batchId !== ALL_BATCHES) conds.push(eq(components.batchId, batchId));
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
    .where(batchId === ALL_BATCHES ? undefined : eq(components.batchId, batchId))
    .orderBy(desc(anomalies.anomalyScore), desc(anomalies.createdAt));
  const sigs = await db.select().from(failureSignatures)
    .innerJoin(components, eq(failureSignatures.componentId, components.id))
    .where(batchId === ALL_BATCHES ? undefined : eq(components.batchId, batchId));
  const sigMap = new Map(sigs.map((s) => [s.failure_signatures.componentId, s.failure_signatures]));
  const preds = await db.select().from(predictions)
    .innerJoin(components, eq(predictions.componentId, components.id))
    .where(batchId === ALL_BATCHES ? undefined : eq(components.batchId, batchId));
  const predMap = new Map(preds.map((p) => [p.predictions.componentId, p.predictions]));
  return rows.map((r) => ({ ...r, sig: sigMap.get(r.c.id) ?? null, pred: predMap.get(r.c.id) ?? null }));
}

export async function getEquipmentEvents() {
  return db.select().from(equipmentEvents).orderBy(desc(equipmentEvents.createdAt)).limit(20);
}

export async function getGenealogy(batchId: number) {
  const rows = await db.select({
    lot: components.lotId, wafer: components.waferId, mfr: components.manufacturer,
    status: components.status, n: count(), avg: sql<number>`avg(${components.anomalyScore})`,
    maxRisk: sql<number>`max(${components.riskScore})`,
  }).from(components).where(batchId === ALL_BATCHES ? undefined : eq(components.batchId, batchId))
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
  const pass = row.componentId ? await getPassport((await db.select().from(components).where(eq(components.id, row.componentId)))[0].componentCode) : null;
  return { report: row, pass };
}

export async function getFeedbackAll(batchId: number) {
  return db.select({ f: feedback, c: components }).from(feedback)
    .innerJoin(components, eq(feedback.componentId, components.id))
    .where(batchId === ALL_BATCHES ? undefined : eq(components.batchId, batchId)).orderBy(desc(feedback.createdAt)).limit(30);
}

export interface HistoryRow { date: string; batch: string; result: string; health: number | null; score: number | null; units?: number }
const DECISION_RANK = ["REJECT", "REVIEW", "WATCH", "MANUAL QC", "EQUIP HOLD", "PASS-EARLY", "PASS"];

// Cross-batch test history: previous burn-in campaigns for one part code or one lot.
export async function getTestHistory(opts: { part?: string; lot?: string; days?: number }): Promise<HistoryRow[]> {
  const days = Math.min(365, Math.max(1, opts.days ?? 90));
  const cutoff = new Date(Date.now() - days * 86400_000);
  const conds: SQL[] = [sql`${batches.createdAt} >= ${cutoff}`];
  if (opts.part) conds.push(eq(components.componentCode, opts.part));
  if (opts.lot) conds.push(eq(components.lotId, opts.lot));
  const rows = await db.select({
    date: batches.createdAt, batch: batches.batchCode,
    decision: components.decision, health: components.healthScore, score: components.anomalyScore,
  }).from(components).innerJoin(batches, eq(components.batchId, batches.id))
    .where(and(...conds)).orderBy(desc(batches.createdAt)).limit(500);

  if (opts.part) {
    return rows.map((r) => ({ date: (r.date ?? new Date()).toISOString(), batch: r.batch, result: r.decision ?? "MANUAL QC", health: r.health, score: r.score }));
  }
  // lot view: one row per campaign — worst decision, mean health
  const byBatch = new Map<string, { date: string; batch: string; worst: string; hSum: number; hN: number; score: number | null; units: number }>();
  for (const r of rows) {
    const b = byBatch.get(r.batch) ?? { date: (r.date ?? new Date()).toISOString(), batch: r.batch, worst: "PASS", hSum: 0, hN: 0, score: null, units: 0 };
    const rank = DECISION_RANK.indexOf((r.decision ?? "PASS").toUpperCase());
    const worstRank = DECISION_RANK.indexOf(b.worst);
    if (rank !== -1 && (worstRank === -1 || rank < worstRank)) b.worst = (r.decision ?? "PASS").toUpperCase();
    if (r.health != null) { b.hSum += r.health; b.hN++; }
    if (b.score == null && r.score != null && r.score > 0.3) b.score = r.score;
    b.units++;
    byBatch.set(r.batch, b);
  }
  return [...byBatch.values()].map((b) => ({ date: b.date, batch: b.batch, result: b.worst, health: b.hN ? Math.round(b.hSum / b.hN) : null, score: b.score, units: b.units }));
}

export async function getLotOptions() {
  const rows = await db.selectDistinct({ lot: components.lotId }).from(components).orderBy(asc(components.lotId)).limit(40);
  return rows.map((r) => r.lot);
}

export async function searchComponentCodes(q: string) {
  return db.select({ code: components.componentCode, status: components.status, lot: components.lotId, socket: components.socketId })
    .from(components).where(ilike(components.componentCode, `%${q}%`)).orderBy(asc(components.componentCode)).limit(12);
}

export async function batchKbMarginals(batchId: number) {
  // per-hour population stats for telemetry corridor (median, p05, p95), computed over normalized units is
  // approximated by raw stats here for rendering corridors.
  // Prefer the tagged normal cohort (seeded demo); fall back to the whole batch when no
  // scenario tags exist (uploaded datasets) so the corridor never renders empty.
  const base = {
    hour: telemetry.hour,
    med: sql<number>`percentile_cont(0.5) within group (order by ${telemetry.leakageUa})`,
    p16: sql<number>`percentile_cont(0.16) within group (order by ${telemetry.leakageUa})`,
    p84: sql<number>`percentile_cont(0.84) within group (order by ${telemetry.leakageUa})`,
    p003: sql<number>`percentile_cont(0.0015) within group (order by ${telemetry.leakageUa})`,
    p998: sql<number>`percentile_cont(0.9985) within group (order by ${telemetry.leakageUa})`,
    medTemp: sql<number>`percentile_cont(0.5) within group (order by ${telemetry.chamberTempC})`,
  };
  const q = db.select(base).from(telemetry).innerJoin(components, eq(telemetry.componentId, components.id));
  const bCond = batchId === ALL_BATCHES ? undefined : eq(components.batchId, batchId);
  const tagged = await q.where(bCond ? and(bCond, eq(components.scenarioTag, "normal")) : eq(components.scenarioTag, "normal"))
    .groupBy(telemetry.hour).orderBy(asc(telemetry.hour));
  if (tagged.length > 0) return tagged;
  const allRows = await q.where(bCond)
    .groupBy(telemetry.hour).orderBy(asc(telemetry.hour));
  return allRows;
}

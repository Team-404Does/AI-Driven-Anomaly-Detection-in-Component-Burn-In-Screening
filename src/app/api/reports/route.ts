// Generate a version-pinned engineering assessment / NCR-style snapshot.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  anomalies, auditLog, batches, components, failureSignatures,
  predictions, reports, riskAssessments, telemetry,
} from "@/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import { MODEL_A, MODEL_DRIFT } from "@/lib/ml/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.componentCode)
    return NextResponse.json({ error: "componentCode is required" }, { status: 400 });
  const [comp] = await db.select().from(components).where(eq(components.componentCode, body.componentCode));
  if (!comp) return NextResponse.json({ error: "Component not found" }, { status: 404 });

  const [[an], [sig], [pred], [risk], [batch], tel] = await Promise.all([
    db.select().from(anomalies).where(eq(anomalies.componentId, comp.id)).orderBy(desc(anomalies.anomalyScore)).limit(1),
    db.select().from(failureSignatures).where(eq(failureSignatures.componentId, comp.id)).limit(1),
    db.select().from(predictions).where(eq(predictions.componentId, comp.id)).limit(1),
    db.select().from(riskAssessments).where(eq(riskAssessments.componentId, comp.id)).orderBy(desc(riskAssessments.createdAt)).limit(1),
    db.select().from(batches).where(eq(batches.id, comp.batchId)).limit(1),
    db.select().from(telemetry).where(eq(telemetry.componentId, comp.id)).orderBy(asc(telemetry.hour)),
  ]);

  const reportType = body.type === "EAR" ? "EAR" : "NCR";
  const code = `${reportType}-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const disposition =
    comp.decision === "REJECT" ? "REJECT — segregate unit; initiate supplier quality notification."
    : comp.decision === "REVIEW" ? "HOLD — route to reliability engineering board for manual review."
    : comp.decision === "EQUIP HOLD" ? "HOLD — pending channel/equipment investigation; do not disposition component yet."
    : comp.decision === "WATCH" ? "CONDITIONAL PASS — extended monitoring recommended."
    : comp.decision === "MANUAL QC" ? "HOLD — insufficient data; perform manual data-quality and test review."
    : "PASS — release for next assembly stage subject to authorized QA approval.";
  const dataset = batch?.sourceFile ?? batch?.batchCode ?? `batch-${comp.batchId}`;
  const telemetrySnapshot = tel.map((point) => ({
    hour: point.hour,
    leakageUa: point.leakageUa,
    vthMv: point.vthMv,
    rdsMohm: point.rdsMohm,
    temperatureC: point.chamberTempC,
    stressV: point.vdsStressV,
  }));

  const [row] = await db.insert(reports).values({
    reportCode: code,
    componentId: comp.id,
    batchId: comp.batchId,
    reportType,
    title: `Prototype ${reportType === "EAR" ? "Engineering Assessment" : "Non-Conformance (NCR-style)"} — ${comp.componentCode}`,
    content: {
      disposition,
      identification: {
        componentCode: comp.componentCode,
        sourceComponentCode: comp.sourceComponentCode,
        manufacturer: comp.manufacturer,
        lotId: comp.lotId,
        waferId: comp.waferId,
        socketId: comp.socketId,
        channelId: comp.channelId,
        batchCode: batch?.batchCode,
        staticLimitUa: comp.staticLeakLimitUa,
        staticResult: comp.staticResult,
        dynamicResult: comp.dynamicResult,
        decision: comp.decision,
        riskScore: comp.riskScore,
        riskLevel: comp.riskLevel,
      },
      telemetry: telemetrySnapshot,
      anomaly: an ? {
        hour: an.hour, score: an.anomalyScore, severity: an.severity,
        signature: an.signature, explanation: an.explanation, detector: an.detectorName,
      } : null,
      signature: sig ? {
        top: sig.signature, probability: sig.probability,
        evidence: sig.evidence, candidates: sig.candidates,
      } : null,
      forecast: pred ? {
        predictedValue: pred.predictedValue, lowerBound: pred.lowerBound,
        upperBound: pred.upperBound, slopePer24h: pred.slopePer24h,
        timeToLimitH: pred.timeToLimitH, horizonH: pred.horizonH, curve: pred.curve,
      } : null,
      risk: risk ? {
        score: risk.riskScore, level: risk.riskLevel,
        decision: risk.decision, confidence: risk.confidence, reasons: risk.reasons,
      } : null,
      modelVersions: {
        anomaly: `${MODEL_A.name} ${MODEL_A.version}`,
        drift: `${MODEL_DRIFT.name} ${MODEL_DRIFT.version}`,
      },
      dataset,
      batchCode: batch?.batchCode,
      generatedAt: new Date().toISOString(),
      disclaimer: "Prototype engineering assessment for decision support. Candidate mechanisms are model-derived and require engineering validation. Not an official ISRO document.",
    },
    generatedBy: body.generatedBy ?? "QA Operator",
    modelVersion: `${MODEL_A.name} ${MODEL_A.version}`,
  }).returning();

  await db.insert(auditLog).values({
    userName: body.generatedBy ?? "QA Operator",
    action: "REPORT_GENERATED",
    objectType: "report",
    objectId: row.reportCode,
    detail: {
      component: comp.componentCode,
      batch: batch?.batchCode,
      type: row.reportType,
      model: row.modelVersion,
      dataset,
    },
  });
  return NextResponse.json({ ok: true, id: row.id, code: row.reportCode });
}

// Generate an engineering assessment / NCR-style report record.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { anomalies, auditLog, components, failureSignatures, predictions, reports, riskAssessments } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { MODEL_A, MODEL_DRIFT } from "@/lib/ml/pipeline";
import { requireApiRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Issuing an NCR / engineering assessment is a disposition action: expert role only.
  const guard = await requireApiRole([ROLES.EXPERT]);
  if (!guard.user) return guard.res;
  const body = await req.json().catch(() => null);
  if (!body?.componentCode) return NextResponse.json({ error: "componentCode required" }, { status: 400 });
  const [comp] = await db.select().from(components).where(eq(components.componentCode, body.componentCode));
  if (!comp) return NextResponse.json({ error: "component not found" }, { status: 404 });
  const [an] = await db.select().from(anomalies).where(eq(anomalies.componentId, comp.id)).orderBy(desc(anomalies.anomalyScore)).limit(1);
  const [sig] = await db.select().from(failureSignatures).where(eq(failureSignatures.componentId, comp.id)).limit(1);
  const [pred] = await db.select().from(predictions).where(eq(predictions.componentId, comp.id)).limit(1);
  const [risk] = await db.select().from(riskAssessments).where(eq(riskAssessments.componentId, comp.id)).orderBy(desc(riskAssessments.createdAt)).limit(1);

  const code = `${body.type === "EAR" ? "EAR" : "NCR"}-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const disposition =
    comp.decision === "REJECT" ? "REJECT — segregate unit; initiate supplier quality notification."
    : comp.decision === "REVIEW" ? "HOLD — route to reliability engineering board for manual review."
    : comp.decision === "EQUIP HOLD" ? "HOLD — pending channel/equipment investigation; do not disposition component yet."
    : comp.decision === "WATCH" ? "CONDITIONAL PASS — extended monitoring recommended."
    : "PASS — release for next assembly stage.";
  const [row] = await db.insert(reports).values({
    reportCode: code, componentId: comp.id, batchId: comp.batchId,
    reportType: body.type === "EAR" ? "EAR" : "NCR",
    title: `Prototype ${body.type === "EAR" ? "Engineering Assessment" : "Non-Conformance (NCR-style)"} — ${comp.componentCode}`,
    content: {
      disposition,
      anomaly: an ? { hour: an.hour, score: an.anomalyScore, severity: an.severity, signature: an.signature, explanation: an.explanation, detector: an.detectorName } : null,
      signature: sig ? { top: sig.signature, probability: sig.probability, evidence: sig.evidence, candidates: sig.candidates } : null,
      forecast: pred ? { predictedValue: pred.predictedValue, lowerBound: pred.lowerBound, upperBound: pred.upperBound, slopePer24h: pred.slopePer24h, timeToLimitH: pred.timeToLimitH, horizonH: pred.horizonH } : null,
      risk: risk ? { score: risk.riskScore, level: risk.riskLevel, decision: risk.decision, reasons: risk.reasons } : null,
      modelVersions: { anomaly: `${MODEL_A.name} ${MODEL_A.version}`, drift: `${MODEL_DRIFT.name} ${MODEL_DRIFT.version}` },
      dataset: "DS-SYN-2026-0142",
      disclaimer: "Prototype engineering assessment for decision support. Candidate mechanisms are model-derived and require engineering validation. Not an official ISRO document.",
    },
    generatedBy: guard.user.name,
    modelVersion: `${MODEL_A.name} ${MODEL_A.version}`,
  }).returning();
  await db.insert(auditLog).values({
    userId: guard.user.uid, userName: guard.user.name, action: "REPORT_GENERATED", objectType: "report",
    objectId: row.reportCode,
    detail: { component: comp.componentCode, type: row.reportType, model: row.modelVersion },
  });
  return NextResponse.json({ ok: true, id: row.id, code: row.reportCode });
}

import { NextResponse } from "next/server";
import { db } from "@/db";
import { anomalies, auditLog, components, feedback, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { MODEL_A } from "@/lib/ml/pipeline";

export const dynamic = "force-dynamic";

const LABELS = ["CONFIRMED_ANOMALY", "FALSE_POSITIVE", "WRONG_FAILURE_MODE", "NEEDS_MORE_TESTING"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.componentCode || !LABELS.includes(body.label))
    return NextResponse.json({ error: "componentCode + valid label required" }, { status: 400 });
  const [comp] = await db.select().from(components).where(eq(components.componentCode, body.componentCode));
  if (!comp) return NextResponse.json({ error: "component not found" }, { status: 404 });
  let [user] = await db.select().from(users).limit(1);
  if (body.userName) {
    const [u] = await db.select().from(users).where(eq(users.name, body.userName));
    if (u) user = u;
  }
  await db.insert(feedback).values({
    componentId: comp.id, userId: user?.id ?? 1,
    originalLabel: comp.decision ?? "UNSET", correctedLabel: body.label,
    comment: body.comment ?? null, modelVersion: MODEL_A.version,
  });
  const [an] = await db.select().from(anomalies).where(eq(anomalies.componentId, comp.id)).orderBy(desc(anomalies.createdAt)).limit(1);
  if (an) await db.update(anomalies).set({ isProcessed: true, feedbackLabel: body.label }).where(eq(anomalies.id, an.id));
  await db.insert(auditLog).values({
    userId: user?.id, userName: user?.name ?? "QA", action: "FEEDBACK_SUBMIT", objectType: "component",
    objectId: comp.componentCode,
    detail: { original: comp.decision, corrected: body.label, comment: body.comment ?? null, modelVersion: MODEL_A.version, queuedForRetraining: true },
  });
  return NextResponse.json({ ok: true, queued: "feedback_queue", note: "Stored in controlled feedback queue — no automatic retraining." });
}

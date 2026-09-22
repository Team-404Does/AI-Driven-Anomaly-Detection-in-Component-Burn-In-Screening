// Operator / expert triage feedback. The acting user always comes from the session,
// never from the request body - an audit trail must not be client-assertable.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { anomalies, auditLog, components, feedback } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { MODEL_A } from "@/lib/ml/pipeline";
import { isExpert, requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const LABELS = ["CONFIRMED_ANOMALY", "FALSE_POSITIVE", "WRONG_FAILURE_MODE", "NEEDS_MORE_TESTING"];

export async function POST(req: Request) {
  const guard = await requireApiRole();
  if (!guard.user) return guard.res;
  const body = await req.json().catch(() => null);
  if (!body?.componentCode || !LABELS.includes(body.label))
    return NextResponse.json({ error: "componentCode + valid label required" }, { status: 400 });
  const [comp] = await db.select().from(components).where(eq(components.componentCode, body.componentCode));
  if (!comp) return NextResponse.json({ error: "component not found" }, { status: 404 });

  // Both roles may record a triage outcome; only an expert's counts as a disposition.
  const authority = isExpert(guard.user) ? "authoritative-disposition" : "operator-recommendation";

  await db.insert(feedback).values({
    componentId: comp.id,
    userId: guard.user.uid,
    originalLabel: comp.decision ?? "UNSET",
    correctedLabel: body.label,
    comment: body.comment ?? null,
    modelVersion: MODEL_A.version,
  });
  const [an] = await db.select().from(anomalies).where(eq(anomalies.componentId, comp.id)).orderBy(desc(anomalies.createdAt)).limit(1);
  if (an) await db.update(anomalies).set({ isProcessed: true, feedbackLabel: body.label }).where(eq(anomalies.id, an.id));
  await db.insert(auditLog).values({
    userId: guard.user.uid,
    userName: guard.user.name,
    action: "FEEDBACK_SUBMIT",
    objectType: "component",
    objectId: comp.componentCode,
    detail: {
      original: comp.decision,
      corrected: body.label,
      comment: body.comment ?? null,
      modelVersion: MODEL_A.version,
      authority,
      queuedForRetraining: true,
    },
  });
  return NextResponse.json({
    ok: true,
    queued: "feedback_queue",
    authority,
    note: "Stored in controlled feedback queue - no automatic retraining.",
  });
}

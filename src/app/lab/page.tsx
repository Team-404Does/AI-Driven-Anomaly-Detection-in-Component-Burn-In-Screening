import { PageHead } from "@/components/ui";
import { getActiveBatch } from "@/lib/queries";
import { db } from "@/db";
import { components } from "@/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import LabClient from "@/components/lab-client";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const batch = await getActiveBatch();
  if (!batch) return null;
  // interesting candidates: flagged first, then stable healthy, plus any hidden
  const flagged = await db.select().from(components)
    .where(and(eq(components.batchId, batch.id), isNotNull(components.anomalyScore)))
    .orderBy(desc(components.anomalyScore)).limit(12);
  const healthy = await db.select().from(components)
    .where(and(eq(components.batchId, batch.id), eq(components.status, "healthy")))
    .orderBy(sql`random()`).limit(6);
  return (
    <div className="fade-in space-y-3">
      <PageHead
        title="Prediction Lab — Drift Forecasting & What-If Simulator"
        sub="Observed history → 168h projection with uncertainty, then stress-scenario simulation. All outputs are model-derived estimates with explicit assumptions."
      />
      <LabClient
        candidates={[...flagged, ...healthy].map((c) => ({
          code: c.componentCode, status: c.status, as: c.anomalyScore, driftRisk: c.driftRisk, decision: c.decision,
        }))}
      />
    </div>
  );
}

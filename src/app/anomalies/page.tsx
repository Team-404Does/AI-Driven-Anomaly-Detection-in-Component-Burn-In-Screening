import { PageHead } from "@/components/ui";
import { getActiveBatch, getAnomalyQueue, getEquipmentEvents } from "@/lib/queries";
import Triage from "@/components/triage";

export const dynamic = "force-dynamic";

export default async function AnomaliesPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = await searchParams;
  const batch = await getActiveBatch();
  if (!batch) return null;
  const queue = await getAnomalyQueue(batch.id);
  const events = await getEquipmentEvents(batch.id);
  return (
    <div className="fade-in space-y-3">
      <PageHead
        title="Anomaly Triage Workspace"
        sub="Ranked queue with failure-signature attribution, lot/equipment correlation and human-in-the-loop labels. Labels feed the controlled retraining queue — the model never silently retrains."
      />
      <Triage
        initialMode={sp.mode ?? "all"}
        batchCode={batch.batchCode}
        events={events.map((e) => ({ id: e.id, type: e.eventType, channel: e.channelId, lot: e.lotId, confidence: e.confidence, assessment: e.assessment ?? "", affected: e.affectedCount }))}
        rows={queue.map(({ a, c, sig, pred }) => ({
          aid: a.id, code: c.componentCode, score: a.anomalyScore, severity: a.severity, hour: a.hour,
          confidence: a.confidence ?? 0.7, status: c.status, decision: c.decision, lot: c.lotId, wafer: c.waferId,
          socket: c.socketId, channel: c.channelId, driftRisk: c.driftRisk, hidden: c.hiddenAnomaly,
          signature: sig?.signature ?? null, sigProb: sig?.probability ?? null,
          staticSig: a.signature, processed: a.isProcessed, feedbackLabel: a.feedbackLabel,
          ttl: pred?.timeToLimitH ?? null, riskScore: c.riskScore ?? 0,
          explanation: a.explanation as any,
        }))}
      />
    </div>
  );
}

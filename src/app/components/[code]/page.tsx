import { notFound } from "next/navigation";
import { getPassport, batchKbMarginals, getActiveBatch } from "@/lib/queries";
import PassportClient from "@/components/passport-client";

export const dynamic = "force-dynamic";

export default async function PassportPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const data = await getPassport(code);
  if (!data) notFound();
  const { comp, tel, ans, preds, sigs, risks, fbs, reps, peer, peerTel, lotRows, lotStats, audits } = data;
  const batch = await getActiveBatch();
  const corridor = batch ? await batchKbMarginals(batch.id) : [];

  return (
    <PassportClient
      comp={{
        code: comp.componentCode, sourceCode: comp.sourceComponentCode, mfr: comp.manufacturer, lot: comp.lotId, wafer: comp.waferId,
        socket: comp.socketId, channel: comp.channelId, status: comp.status, decision: comp.decision,
        staticLimit: comp.staticLeakLimitUa,
        health: comp.healthScore, as: comp.anomalyScore, driftRisk: comp.driftRisk,
        riskScore: comp.riskScore, riskLevel: comp.riskLevel, staticResult: comp.staticResult,
        dynamicResult: comp.dynamicResult, hidden: comp.hiddenAnomaly, feature: comp.featureJson as any,
        driftSlope: comp.driftSlope, batch: batch?.batchCode ?? "",
      }}
      tel={tel.map((t) => ({ h: t.hour, l: t.leakageUa, v: t.vthMv, r: t.rdsMohm, t: t.chamberTempC }))}
      peer={peer ? { code: peer.componentCode, tel: peerTel.map((t) => ({ h: t.hour, l: t.leakageUa })) } : null}
      corridor={corridor.map((c) => ({ h: c.hour, med: +(+c.med).toFixed(3), p16: +(+c.p16).toFixed(3), p84: +(+c.p84).toFixed(3), p003: +(+c.p003).toFixed(3), p998: +(+c.p998).toFixed(3) }))}
      anomaly={ans[0] ? { id: ans[0].id, hour: ans[0].hour, score: ans[0].anomalyScore, severity: ans[0].severity, explanation: ans[0].explanation as any, confidence: ans[0].confidence, detector: ans[0].detectorName } : null}
      pred={preds[0] ? { pv: preds[0].predictedValue, lo: preds[0].lowerBound, hi: preds[0].upperBound, slope: preds[0].slopePer24h, ttl: preds[0].timeToLimitH, conf: preds[0].confidence, curve: preds[0].curve as any[] } : null}
      sig={sigs[0] ? { top: sigs[0].signature, prob: sigs[0].probability, conf: sigs[0].confidenceText, evidence: sigs[0].evidence as string[], candidates: sigs[0].candidates as any[] } : null}
      risk={risks[0] ? { score: risks[0].riskScore, level: risks[0].riskLevel, decision: risks[0].decision, reasons: risks[0].reasons as any, conf: risks[0].confidence } : null}
      lotInfo={{ rows: lotRows, avgScore: +(lotStats?.avgScore ?? 0).toFixed(3), avgDrift: +(lotStats?.avgDrift ?? 0).toFixed(4) }}
      feedbacks={fbs.map((f) => ({ id: f.id, orig: f.originalLabel, corr: f.correctedLabel, comment: f.comment, at: f.createdAt?.toISOString() }))}
      reports={reps.map((r) => ({ id: r.id, code: r.reportCode, type: r.reportType, title: r.title, at: r.createdAt?.toISOString() }))}
      audits={audits.map((a) => ({ id: a.id, action: a.action, by: a.userName, at: a.createdAt?.toISOString(), detail: a.detail as any }))}
    />
  );
}

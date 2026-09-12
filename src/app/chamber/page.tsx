import { getActiveBatch, getChamber, getEquipmentEvents } from "@/lib/queries";
import { db } from "@/db";
import { telemetry, components } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import ChamberView from "@/components/chamber-view";
import { PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ChamberPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const sp = await searchParams;
  const batch = await getActiveBatch();
  if (!batch) return <div className="text-fog">No batch loaded.</div>;
  const rack = Math.min(7, Math.max(0, Number(sp.r ?? 0)));
  const comps = await getChamber(batch.id, rack);
  const ids = comps.map((c) => c.id);

  let telStats: any[] = [];
  if (ids.length) {
    telStats = await db.select({
      componentId: telemetry.componentId,
      meanTemp: sql<number>`avg(${telemetry.chamberTempC})`,
      maxLeak: sql<number>`max(${telemetry.leakageUa})`,
      lastLeak: sql<number>`(array_agg(${telemetry.leakageUa} ORDER BY ${telemetry.hour} DESC))[1]`,
    }).from(telemetry).where(inArray(telemetry.componentId, ids)).groupBy(telemetry.componentId);
  }
  const events = await getEquipmentEvents(batch.id);
  const stats: any = batch.stats ?? {};

  return (
    <div className="fade-in">
      <PageHead
        title="Live Chamber — 8×16 Spatial Intelligence"
        sub="Rack-level socket map with temperature, anomaly, drift and equipment-risk overlays. Click any socket for its Digital Passport."
      />
      <ChamberView
        batchCode={batch.batchCode}
        rack={rack}
        comps={comps.map((c) => ({
          id: c.id, code: c.componentCode, row: c.chamberRow, col: c.chamberCol, socket: c.socketId,
          lot: c.lotId, wafer: c.waferId, channel: c.channelId, status: c.status, decision: c.decision,
          anomalyScore: c.anomalyScore, driftSlope: c.driftSlope, riskLevel: c.riskLevel, hidden: c.hiddenAnomaly,
        }))}
        telStats={Object.fromEntries(telStats.map((t) => [t.componentId, { meanTemp: +(+t.meanTemp).toFixed(2), maxLeak: +(+t.maxLeak).toFixed(3), lastLeak: +(t.lastLeak ?? 0).toFixed(3) }]))}
        equipChannels={events.filter((e) => e.eventType === "INSTRUMENTATION_EVENT").map((e) => e.channelId)}
        channels={stats.channels ?? []}
      />
    </div>
  );
}

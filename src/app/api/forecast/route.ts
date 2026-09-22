import { NextResponse } from "next/server";
import { db } from "@/db";
import { components, predictions, telemetry } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireApiRole();
  if (!guard.user) return guard.res;
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const [comp] = await db.select().from(components).where(eq(components.componentCode, code));
  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [tel, [pred]] = await Promise.all([
    db.select().from(telemetry).where(eq(telemetry.componentId, comp.id)).orderBy(asc(telemetry.hour)),
    db.select().from(predictions).where(eq(predictions.componentId, comp.id)).limit(1),
  ]);
  return NextResponse.json({
    comp: {
      code: comp.componentCode, status: comp.status, decision: comp.decision, as: comp.anomalyScore,
      driftRisk: comp.driftRisk, riskScore: comp.riskScore, socket: comp.socketId, lot: comp.lotId,
    },
    tel: tel.map((t) => ({ h: t.hour, l: t.leakageUa, t: t.chamberTempC })),
    pred: pred ? { pv: pred.predictedValue, lo: pred.lowerBound, hi: pred.upperBound, slope: pred.slopePer24h, ttl: pred.timeToLimitH, conf: pred.confidence, curve: pred.curve } : null,
  });
}

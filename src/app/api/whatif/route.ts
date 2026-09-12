// What-If stress simulator — Arrhenius + voltage acceleration applied to the stored
// drift model. All outputs are model-derived estimates with explicit assumptions.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, components, predictions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { arrFactor } from "@/lib/sim/generator";
import { MODEL_DRIFT } from "@/lib/ml/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.componentCode) return NextResponse.json({ error: "componentCode required" }, { status: 400 });
  const tempC = Math.max(85, Math.min(175, Number(body.tempC ?? 125)));
  const voltage = Math.max(10, Math.min(45, Number(body.voltage ?? 28)));
  const durationH = Math.max(24, Math.min(672, Number(body.durationH ?? 336)));

  const [comp] = await db.select().from(components).where(eq(components.componentCode, body.componentCode));
  if (!comp) return NextResponse.json({ error: "component not found" }, { status: 404 });
  const [pred] = await db.select().from(predictions).where(and(eq(predictions.componentId, comp.id), eq(predictions.parameter, "leakage_ua")));

  const afT = arrFactor(tempC);                    // vs 125°C reference (arrFactor(125) = 1)
  const afV = Math.pow(voltage / 28, 3.1);         // empirical voltage acceleration
  const AF = afT * afV;
  const durFactor = durationH / 336;

  const base = pred?.predictedValue ?? 0;
  const predictedDrift = base * Math.pow(AF, 0.85) * Math.pow(durFactor, 0.62);
  const baseDrift = base;
  const riskBefore = comp.riskScore ?? 0;
  const driftShare = predictedDrift / Math.max(2.2, 5.0);
  const riskAfter = Math.round(Math.min(100, Math.max(0,
    riskBefore * 0.45 + 55 * Math.min(1, driftShare) + (predictedDrift > 5 ? 25 : 0))));

  const expectedAnomalies = Math.max(0, Math.round((AF - 1) * 9 * durFactor + (predictedDrift > 3.2 ? 2 : 0)));
  const recommendation =
    riskAfter >= 80 ? "Projected CRITICAL envelope — do not extend stress; isolate and disposition via NCR."
    : riskAfter >= 60 ? "Elevated projected risk — recommend engineering review before extending this profile."
    : AF < 0.7 ? "Reduced stress marginally lowers anomaly rate but extends effective test time ~1/AF — poor screen efficiency."
    : AF > 1.6 ? "Aggressive acceleration: est. screen-time saving " + Math.round((1 - 1 / AF) * 100) + "% with elevated overstress risk. Requires validation runs."
    : "Profile within validated envelope — moderate acceleration, acceptable screen efficiency.";

  const payload = {
    scenario: { component: comp.componentCode, tempC, voltage, durationH },
    baseline: { tempC: 125, voltage: 28, horizonH: 336, predictedDrift: +baseDrift.toFixed(3), riskScore: riskBefore },
    predicted: {
      accelerationFactor: +AF.toFixed(3),
      predictedDrift: +predictedDrift.toFixed(3),
      riskBefore, riskAfter,
      expectedAnomalies,
      driftRisk: predictedDrift > 4.5 ? "HIGH" : predictedDrift > 2.8 ? "MEDIUM" : "LOW",
    },
    recommendation,
    modelVersion: `${MODEL_DRIFT.name} ${MODEL_DRIFT.version}`,
    assumptions: [
      "Arrhenius temperature acceleration, Ea = 0.7 eV",
      "Voltage acceleration exponent γ = 3.1 (empirical)",
      "Extrapolation beyond 336h is a model-derived estimate, not a mission guarantee",
      "No interaction terms between temperature and voltage in prototype",
    ],
  };
  await db.insert(auditLog).values({
    userName: "OPERATOR", action: "WHAT_IF_RUN", objectType: "component",
    objectId: comp.componentCode, detail: { tempC, voltage, durationH, AF: +AF.toFixed(3), riskAfter, model: payload.modelVersion },
  });
  return NextResponse.json(payload);
}

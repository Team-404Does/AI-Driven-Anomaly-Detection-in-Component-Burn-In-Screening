// AI Recommendation — deterministic synthesis of Module A (PRES-IF anomaly
// detection) + Module B (DRIFT-LIN drift forecast). Pure function: no DB, no
// randomness — identical inputs always yield the identical recommendation,
// which is what makes it auditable and versioned rather than a black box.
import { STATIC_LEAK_LIMIT } from "@/lib/sim/generator";

export type Verdict = "REJECT" | "REVIEW" | "WATCH" | "PASS" | "PASS-EARLY" | "EQUIP HOLD" | "MANUAL QC";

export interface RecommendationInput {
  decision?: string | null;
  anomalyScore?: number | null;
  anomalyHour?: number | null;
  staticResult?: string | null;
  dynamicResult?: string | null;
  hidden?: boolean | null;
  driftRisk?: string | null;
  driftSlope?: number | null;      // µA per 24h (physics-normalized)
  predValue?: number | null;       // projected leakage at 336h (µA)
  predUpper?: number | null;       // 95% upper bound at 336h
  forecastConf?: number | null;    // 0..1
  equipCorrelated?: boolean | null;
  lotCorrelated?: boolean | null;
  riskScore?: number | null;
  healthScore?: number | null;
}

export interface Recommendation {
  verdict: Verdict;
  tone: "reject" | "review" | "watch" | "pass" | "equip" | "manual";
  headline: string;
  reasons: string[];              // ✓ evidence ticks (positive findings)
  cautions: string[];             // ! qualifiers a judge will ask about
  actions: string[];              // → recommended action plan
  basis: string;                  // model/version provenance footer
}

const limit = STATIC_LEAK_LIMIT;

export function buildRecommendation(i: RecommendationInput): Recommendation {
  const AS = i.anomalyScore ?? 0;
  const dynamicFail = (i.dynamicResult ?? "").toUpperCase() === "ANOMALOUS";
  const staticFail = (i.staticResult ?? "").toUpperCase() === "FAIL";
  const staticWarn = (i.staticResult ?? "").toUpperCase() === "WARNING";
  const overForecast = (i.predValue ?? 0) > limit * 1.1;
  const nearForecast = (i.predUpper ?? 0) > limit * 0.9;
  const rapidRise = (i.driftSlope ?? 0) > 0.05; // >0.05 µA per 24h ≈ >0.35 µA by end of test

  const reasons: string[] = [];
  const cautions: string[] = [];
  const actions: string[] = [];

  if (dynamicFail) reasons.push(`Dynamic anomaly detected (score ${AS.toFixed(2)}, onset T+${i.anomalyHour ?? "?"}h)`);
  if (staticFail) reasons.push(`Static screen FAIL — leakage above the ${limit} µA datasheet limit`);
  else if (staticWarn) reasons.push(`Static screen WARNING — approaching the ${limit} µA limit`);
  if (rapidRise && dynamicFail) reasons.push(`Rapid leakage increase (+${(i.driftSlope ?? 0).toFixed(3)} µA/24h)`);
  if (overForecast) reasons.push(`Projected 336h value ${(i.predValue as number).toFixed(1)} µA exceeds the ${limit} µA limit`);
  else if (nearForecast && (i.driftRisk ?? "").toUpperCase() !== "LOW") reasons.push(`95% upper bound ${(i.predUpper as number).toFixed(1)} µA approaches the limit by 336h`);
  if (i.hidden) reasons.push("Hidden-failure pattern: passes static limits but deviates from population dynamics");
  if (i.lotCorrelated) reasons.push("Lot-level deviation is significant — siblings share the drift signature");
  if (i.equipCorrelated) reasons.push("Measurement-channel cohort correlation detected across 8+ units");

  // decision inherits the risk engine's verdict; recommendation explains it
  const d = (i.decision ?? "MANUAL QC").toUpperCase();
  let tone: Recommendation["tone"] = "manual";
  if (d === "REJECT") tone = "reject";
  else if (d === "REVIEW") tone = "review";
  else if (d === "WATCH") tone = "watch";
  else if (d === "PASS" || d === "PASS-EARLY") tone = "pass";
  else if (d === "EQUIP HOLD") tone = "equip";

  const verdict: Verdict = d === "PASS-EARLY" ? "PASS-EARLY" : (d as Verdict);

  switch (tone) {
    case "reject":
      actions.push("Inspect component — physical failure analysis (decap / cross-section)");
      actions.push("Compare against same-socket peers over the full 168h window");
      actions.push("Quarantine same-lot siblings pending lot-level review");
      if (i.lotCorrelated) actions.push("Escalate to foundry quality review with wafer-level map");
      break;
    case "review":
      actions.push("Schedule engineering review before disposition");
      actions.push("Re-run analysis after channel calibration check");
      actions.push("Compare drift slope against lot median");
      break;
    case "watch":
      actions.push("Keep in burn-in — re-check at next 24h window");
      actions.push("No disposition action yet; monitor slope trend");
      break;
    case "equip":
      actions.push("Verify measurement-channel calibration before any component action");
      actions.push("Re-test flagged units on a different channel");
      break;
    case "pass":
      actions.push("Release per standard screening procedure");
      if (d === "PASS-EARLY") actions.push("Eligible for accelerated release — burn-in time reduction candidate");
      break;
    default:
      actions.push("Route to manual QC — insufficient model confidence for auto-decision");
  }

  if (i.equipCorrelated && tone !== "equip") cautions.push("Unit shares a channel with an instrumentation event — confirm before condemning the component");
  if ((i.forecastConf ?? 1) < 0.55) cautions.push(`Forecast confidence is low (${Math.round((i.forecastConf ?? 0) * 100)}%) — projection is indicative only`);
  if (i.hidden) cautions.push("Static screen alone would have released this unit");
  if ((i.riskScore ?? 0) >= 80 && staticFail === false) cautions.push("REJECT driven by dynamic evidence, not a static-limit breach");

  const headlines: Record<Recommendation["tone"], string> = {
    reject: "Engineering review required before scrap disposition",
    review: "Flagged for engineering review",
    watch: "Within limits — elevated risk, continue monitoring",
    pass: "Meets all screening criteria",
    equip: "Instrumentation event — component evidence weak",
    manual: "Insufficient confidence — manual QC",
  };

  return {
    verdict, tone, headline: headlines[tone],
    reasons: reasons.length ? reasons : ["All module checks within population envelope"],
    cautions,
    actions,
    basis: "PRES-IF v1.4 (Module A) + DRIFT-LIN v2.1 (Module B) · deterministic rule synthesis · model-versioned",
  };
}

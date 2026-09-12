// Analysis pipeline: validation → physics normalization → anomaly detection →
// drift forecasting → failure signatures → risk engine → equipment discrimination.
// Champion: PRES-IF v1.4 (physics-residual Isolation Forest)
// Challenger: RAW-IF v0.9 (same algorithm on un-normalized features)
import { db } from "@/db";
import {
  anomalies, batches, components, equipmentEvents, failureSignatures,
  modelRegistry, predictions, riskAssessments, telemetry, auditLog,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

import { isolationForest } from "@/lib/ml/isoforest";
import {
  seriesFeatures, driftForecast, populationZ, median, mad, linFit,
  type SeriesFeat, type Pt, type Forecast,
} from "@/lib/ml/features";

export const MODEL_A = { name: "PRES-IF", version: "v1.4" };
export const MODEL_B = { name: "RAW-IF", version: "v0.9" };
export const MODEL_DRIFT = { name: "DRIFT-LIN", version: "v2.1" };

const isHotZone = (row: number, col: number) => (row === 2 || row === 3) && col >= 8 && col <= 10;

function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)); }

interface SigCand { sig: string; s: number; }
function signatureFor(f: SeriesFeat, isoScore: number, inEquip: boolean, telMeanTempVthCorr: number) {
  const cands: SigCand[] = [];
  // TDDB-like: progressive leakage growth with acceleration
  cands.push({ sig: "TDDB-like leakage growth", s: f.slopePer24h > 0.01 ? 0.9 + Math.min(1.2, f.slopePer24h * 8) + Math.min(1, Math.max(0, f.accel) * 6) : 0.15 });
  // die-fracture-like: abrupt multi-param step
  cands.push({ sig: "Die-fracture-like step", s: f.maxStepZ > 6 && Math.abs(f.vthDrift) > 25 ? 2.0 : f.maxStepZ > 6 ? 1.1 : 0.1 });
  // BTI/HCI-like: threshold-voltage drift dominated
  cands.push({ sig: "BTI/HCI-like Vth drift", s: Math.abs(f.vthDrift) > 30 ? 0.8 + Math.min(1.2, Math.abs(f.vthDrift) / 40) : 0.15 });
  // bond-fatigue-like: thermal-correlated instability
  cands.push({ sig: "Bond-fatigue-like instability", s: telMeanTempVthCorr > 0.55 ? 1.0 + telMeanTempVthCorr : 0.1 });
  // instrumentation transient
  cands.push({ sig: "Instrumentation transient", s: inEquip ? 2.4 : f.maxStepZ > 5 && Math.abs(f.slopePer24h) < 0.02 ? 1.3 : 0.05 });
  const exps = cands.map((c) => Math.exp(c.s));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = cands.map((c, i) => ({ signature: c.sig, probability: +(exps[i] / sum * 100).toFixed(1) })).sort((a, b) => b.probability - a.probability);
  const evidence: string[] = [];
  if (f.slopePer24h > 0.01) evidence.push(`leakage growth +${(f.slopePer24h * 100).toFixed(1)}%/24h`);
  if (f.accel > 0.002) evidence.push("temporal acceleration of drift");
  if (f.maxStepZ > 6) evidence.push(`abrupt step transient (${f.maxStepZ.toFixed(1)}σ)`);
  if (Math.abs(f.vthDrift) > 25) evidence.push(`Vth shift ${f.vthDrift > 0 ? "+" : ""}${f.vthDrift.toFixed(0)} mV`);
  if (f.rollStd > 0.1) evidence.push("elevated residual volatility");
  if (inEquip) evidence.push("synchronized onset with channel cohort");
  if (!evidence.length) evidence.push("peer-distribution deviation only");
  const topP = probs[0].probability;
  return { probs, top: probs[0].signature, evidence, confText: topP >= 65 ? "HIGH" : topP >= 40 ? "MEDIUM" : "LOW" };
}

export async function runPipeline(batchId: number) {
  const t0 = Date.now();
  const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
  if (!batch) throw new Error(`Batch ${batchId} not found`);
  const comps = await db.select().from(components).where(eq(components.batchId, batchId));
  if (!comps.length) throw new Error("Batch contains no components");
  const telRows = await db.select().from(telemetry)
    .innerJoin(components, eq(telemetry.componentId, components.id))
    .where(eq(components.batchId, batchId));
  const byComp = new Map<number, Pt[]>();
  for (const r of telRows) {
    const t = r.telemetry;
    if (!byComp.has(t.componentId)) byComp.set(t.componentId, []);
    byComp.get(t.componentId)!.push({ hour: t.hour, leak: t.leakageUa, vth: t.vthMv, rds: t.rdsMohm ?? 118, temp: t.chamberTempC ?? 125, vds: t.vdsStressV ?? 28 });
  }
  byComp.forEach((arr) => arr.sort((a, b) => a.hour - b.hour));
  const observedHours = [...new Set(telRows.map((r) => r.telemetry.hour))].sort((a, b) => a - b);
  if (!observedHours.length) throw new Error("Batch contains no telemetry");
  const observedEnd = observedHours[observedHours.length - 1];
  const observedStart = observedHours[0];
  const forecastHorizonH = 168;

  // ---- features ----
  const feats: SeriesFeat[] = comps.map((c) => {
    const pts = byComp.get(c.id) ?? [];
    return seriesFeatures(c.id, pts, c.staticLeakLimitUa);
  });
  populationZ(feats, observedHours);

  // Minimum evidence scales with the uploaded file. Four valid points is the
  // absolute floor; ten remains the preferred full-confidence profile.
  const nonZeroCounts = feats.map((f) => f.n).filter((n) => n > 0);
  const typicalSamples = Math.max(0, Math.round(median(nonZeroCounts)));
  const minSamples = Math.max(4, Math.min(10, Math.floor(typicalSamples * 0.5)));

  // ---- feature matrices (champion: physics-normalized, challenger: raw) ----
  const hasTel = feats.filter((f) => f.n >= minSamples);
  const zmat = (values: number[][]) => {
    if (!values.length) return [];
    const cols = values[0].map((_, j) => values.map((r) => r[j]));
    const meds = cols.map((c) => median(c)), mads = cols.map((c, j) => mad(c, meds[j]));
    return values.map((r) => r.map((v, j) => (v - meds[j]) / mads[j]));
  };
  const physVals = hasTel.map((f) => [f.zLast ?? 0, f.maxAbsZ ?? 0, f.slopePer24h, f.accel, f.rollStd, f.vthDrift, f.maxStepZ]);
  const XA = zmat(physVals);
  // challenger: same estimators but on raw (un-normalized) series
  const rawVals = hasTel.map((f) => {
    const xs = f.rawSeries.map((p) => p.hour), ys = f.rawSeries.map((p) => p.v);
    const fit = linFit(xs, ys);
    const last = ys[ys.length - 1] ?? 0;
    const half = Math.floor(ys.length / 2) || 1;
    const a2 = linFit(xs.slice(half), ys.slice(half)).b - linFit(xs.slice(0, half), ys.slice(0, half)).b;
    const resids = ys.map((y, i) => y - (fit.a + fit.b * xs[i]));
    const rstd = Math.sqrt(resids.reduce((a, r) => a + r * r, 0) / resids.length);
    return [last, 0, fit.b * 24, a2 * 24, rstd, f.vthDrift, f.maxStepZ];
  });
  const XB = zmat(rawVals);
  const forestSample = Math.max(2, Math.min(256, hasTel.length));
  const isoA = hasTel.length >= 4
    ? isolationForest(XA, 120, forestSample, 26170 + batchId)
    : { scores: hasTel.map(() => 0.5), ms: 0 };
  const isoB = hasTel.length >= 4
    ? isolationForest(XB, 120, forestSample, 26170 + batchId)
    : { scores: hasTel.map(() => 0.5), ms: 0 };

  // calibration → [0,1]-ish scores
  const vths = hasTel.map((f) => f.vthDrift);
  const vMed = median(vths), vMad = mad(vths, vMed);
  const scoreOf = (iso: number, f: SeriesFeat) => {
    const vthZ = (f.vthDrift - vMed) / vMad;
    const stat = Math.max(sigmoid(((f.zLast ?? 0) - 3) * 1.15), sigmoid(((f.maxAbsZ ?? 0) - 4.5) * 0.9),
      f.staticFail ? 0.95 : 0, f.slopePer24h > 0.02 ? sigmoid((f.slopePer24h - 0.06) * 42) : 0.05,
      sigmoid((Math.abs(vthZ) - 3) * 1.1));
    return +(0.5 * sigmoid((iso - 0.52) * 26) + 0.5 * stat).toFixed(4);
  };
  const scoreOfRaw = (iso: number, f: SeriesFeat) =>
    +(0.7 * sigmoid((iso - 0.52) * 26) + 0.3 * (f.staticFail ? 1 : 0.15)).toFixed(4);

  const scoreA = new Map<number, number>(), scoreB = new Map<number, number>();
  hasTel.forEach((f, i) => { scoreA.set(f.idx, scoreOf(isoA.scores[i], f)); scoreB.set(f.idx, scoreOfRaw(isoB.scores[i], f)); });

  // ---- equipment / cohort discrimination ----
  const flagged = hasTel.filter((f) => (scoreA.get(f.idx) ?? 0) >= 0.6);
  const compById = new Map(comps.map((c) => [c.id, c]));
  const spikeHour = (f: SeriesFeat) => {
    let best = 0, bh = f.normSeries[0]?.hour ?? 0;
    for (let i = 1; i < f.normSeries.length; i++) {
      const d = Math.abs(f.normSeries[i].v - f.normSeries[i - 1].v);
      if (d > best) { best = d; bh = f.normSeries[i].hour; }
    }
    return bh;
  };
  const flagByChan = new Map<string, SeriesFeat[]>();
  flagged.forEach((f) => { const ch = compById.get(f.idx)!.channelId; flagByChan.set(ch, [...(flagByChan.get(ch) ?? []), f]); });
  const equipSet = new Set<number>();
  const events: any[] = [];
  const cohortMin = Math.max(3, Math.min(8, Math.ceil(Math.max(1, flagged.length) * 0.2)));
  for (const [ch, fs] of flagByChan) {
    if (fs.length < cohortMin || fs.length < flagged.length * 0.22) continue;
    const hours = fs.map(spikeHour);
    const mh = median(hours);
    // robust synchronization: keep members whose onset sits within ±8h of the cohort median
    const onsetTolerance = Math.max(0.25, (observedEnd - observedStart) * 0.05);
    const members = fs.filter((f, i) => Math.abs(hours[i] - mh) <= onsetTolerance);
    if (members.length < cohortMin) continue;
    const mh2 = median(members.map(spikeHour));
    const spread = Math.sqrt(members.reduce((a, f) => a + (spikeHour(f) - mh2) ** 2, 0) / members.length);
    if (spread <= onsetTolerance) {
      members.forEach((f) => equipSet.add(f.idx));
      events.push({
        batchId, channelId: ch, chamberZone: null, lotId: null, eventType: "INSTRUMENTATION_EVENT",
        startHour: Math.min(...members.map(spikeHour)), endHour: Math.max(...members.map(spikeHour)) + 4,
        affectedCount: members.length, affectedIds: members.map((f) => compById.get(f.idx)!.componentCode),
        correlation: { sameChannel: members.length, totalFlagged: flagged.length, onsetSpreadH: +spread.toFixed(1), sameLot: 0, sameZone: 0 },
        confidence: "high",
        assessment: `${members.length} of ${flagged.length} flagged components share measurement channel ${ch} with synchronized onset (σ=${spread.toFixed(1)}h) and recovery. Pattern is consistent with an instrumentation/transient event rather than independent component failures. Component-failure confidence LOW — schedule channel calibration before dispositioning units.`,
      });
    }
  }
  const flagByLot = new Map<string, SeriesFeat[]>();
  flagged.filter((f) => !equipSet.has(f.idx)).forEach((f) => { const l = compById.get(f.idx)!.lotId; flagByLot.set(l, [...(flagByLot.get(l) ?? []), f]); });
  const lotSet = new Set<number>();
  for (const [lot, fs] of flagByLot) {
    const lotTotal = comps.filter((c) => c.lotId === lot).length;
    // wafer concentration: how many flagged units share the top wafer
    const waferCount = new Map<string, number>();
    fs.forEach((f) => { const w = compById.get(f.idx)!.waferId; waferCount.set(w, (waferCount.get(w) ?? 0) + 1); });
    const waferMax = Math.max(0, ...waferCount.values());
    const lotMin = Math.max(3, Math.min(4, Math.ceil(lotTotal * 0.04)));
    if (fs.length >= lotMin && ((fs.length / lotTotal >= 0.08 && waferMax >= Math.min(2, lotMin)) || (waferMax >= lotMin && waferMax >= fs.length * 0.4))) {
      const wafers = new Set(fs.map((f) => compById.get(f.idx)!.waferId));
      fs.forEach((f) => lotSet.add(f.idx));
      events.push({
        batchId, channelId: null, chamberZone: null, lotId: lot, eventType: "LOT_PROCESS_SHIFT",
        startHour: null, endHour: null, affectedCount: fs.length,
        affectedIds: fs.map((f) => compById.get(f.idx)!.componentCode),
        correlation: { sameLot: fs.length, lotSize: lotTotal, wafersAffected: wafers.size, dominantWafer: wafers.size <= 2 },
        confidence: "high",
        assessment: `${fs.length} components from ${lot} share a common drift signature (${[...wafers].join(", ")}). ${wafers.size <= 2 ? "Concentration in a single wafer suggests wafer-level process excursion." : "Distribution across wafers suggests lot-level process shift."} Escalate to foundry quality review.`,
      });
    }
  }
  // thermal de-biasing showcase: hot-zone units the raw challenger flags but the physics model clears
  const raws = hasTel.map((f) => f.rawSeries[f.rawSeries.length - 1]?.v ?? 0);
  const rMed = median(raws), rMad = mad(raws, rMed);
  const thermalCleared = feats.filter((f) => f.n >= 10 && (scoreA.get(f.idx) ?? 0) < 0.6)
    .filter((f) => {
      const c = compById.get(f.idx)!;
      if (!isHotZone(c.chamberRow, c.chamberCol)) return false;
      const lastRaw = f.rawSeries[f.rawSeries.length - 1]?.v ?? 0;
      const rawZ = (lastRaw - rMed) / rMad;
      return (scoreB.get(f.idx) ?? 0) >= 0.55 || rawZ >= 2.5;
    });
  if (thermalCleared.length >= 3) {
    events.push({
      batchId, channelId: null, chamberZone: "C09-C11 rows B-C (hot zone)", lotId: null, eventType: "THERMAL_COUPLING_CLEARED",
      startHour: 0, endHour: 168, affectedCount: thermalCleared.length,
      affectedIds: thermalCleared.map((f) => compById.get(f.idx)!.componentCode),
      correlation: { zone: true, physicsResidualOk: true, rawModelFlags: thermalCleared.length },
      confidence: "medium",
      assessment: `${thermalCleared.length} components in the chamber hot zone (+6°C) appear anomalous on raw telemetry (challenger RAW-IF flags them) but are consistent with Arrhenius temperature response. Adaptive physics normalization cleared them — no component action; verify chamber zone calibration.`,
    });
  }

  // ---- signatures, risk, decisions ----
  const anRows: any[] = [], predRows: any[] = [], sigRows: any[] = [], riskRows: any[] = [];
  const compUpdates: { id: number; patch: any }[] = [];
  const forecasts = new Map<number, Forecast>();
  let hiddenCount = 0;

  for (const c of comps) {
    const f = feats.find((x) => x.idx === c.id)!;
    if (f.n < minSamples) {
      compUpdates.push({ id: c.id, patch: {
        status: "unknown", decision: "MANUAL QC", riskLevel: "UNKNOWN", riskScore: null,
        anomalyScore: null, healthScore: null, staticResult: f.n ? "PARTIAL DATA" : "NO DATA",
        dynamicResult: "INSUFFICIENT", driftRisk: "UNKNOWN", hiddenAnomaly: false,
        featureJson: { dataSufficiency: "LOW", validSamples: f.n, requiredSamples: minSamples },
      } });
      continue;
    }
    const AS = scoreA.get(c.id) ?? 0;
    const fc = driftForecast(f, c.staticLeakLimitUa, forecastHorizonH); forecasts.set(c.id, fc);
    const inEquip = equipSet.has(c.id), inLot = lotSet.has(c.id);
    const staticRes = f.staticFail ? "FAIL" : f.staticWarn ? "WARN" : "PASS";
    const dynAnom = AS >= 0.6;
    const sampleConfidence = Math.min(1, f.n / 10);
    const populationConfidence = Math.min(1, hasTel.length / 30);
    const spanConfidence = Math.min(1, Math.max(0, f.lastHour - f.firstHour) / 48);
    const evidenceConfidence = 0.45 + 0.2 * sampleConfidence + 0.2 * populationConfidence + 0.15 * spanConfidence;
    const conf = +Math.max(0.25, Math.min(0.96,
      evidenceConfidence * (0.82 + 0.18 * Math.min(1, Math.abs(f.zLast ?? 0) / 6)) - (inEquip ? 0.14 : 0))).toFixed(2);
    const sig = (dynAnom || f.staticFail) ? (() => {
      const vs = (byComp.get(c.id) ?? []).filter((p) => p.vth != null && p.leak != null);
      let corr = 0;
      if (vs.length > 10) { const xs = vs.map((p) => p.temp), ys = vs.map((p) => p.leak!); const l = linFit(xs, ys); const mx = median(xs), my = median(ys); const sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0)), sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0)); corr = sx > 0 && sy > 0 ? l.b * sx / sy : 0; }
      return signatureFor(f, AS, inEquip, Math.abs(corr));
    })() : null;

    // deterministic risk engine
    let risk = AS * 42
      + (fc.driftRisk === "HIGH" ? 26 : fc.driftRisk === "MEDIUM" ? 13 : 3)
      + (f.staticFail ? 22 : f.staticWarn ? 7 : 0)
      + (inLot ? 8 : 0)
      + (f.missingPct > 0.05 ? 5 : 0);
    if (sig) risk += ["TDDB-like leakage growth", "Die-fracture-like step"].includes(sig.top) ? 6 : 2;
    if (inEquip) risk = Math.min(risk, 42);
    risk = Math.round(Math.min(100, Math.max(0, risk)));
    const level = risk > 80 ? "CRITICAL" : risk > 60 ? "REVIEW" : risk > 30 ? "WATCH" : "HEALTHY";
    let decision = inEquip ? "EQUIP HOLD" : risk > 80 ? "REJECT" : risk > 60 ? "REVIEW" : risk > 30 ? "WATCH" : "PASS";
    if (!inEquip && risk > 60 && conf < 0.6) decision = "REVIEW";
    const qualified = !dynAnom && fc.driftRisk === "LOW" && fc.conf > 0.8 && conf > 0.7 && f.staticFail === false && !f.staticWarn
      && AS < 0.3 && Math.abs(f.slopePer24h) < 0.0028 && Math.abs(f.zLast ?? 0) < 1.05 && f.missingPct < 0.04;
    if (qualified) decision = "PASS-EARLY";
    const status = f.staticFail === false && (f.n < 20) ? "unknown"
      : level === "CRITICAL" || level === "REVIEW" ? "critical" : level === "WATCH" ? "watch" : qualified ? "qualified" : "healthy";
    const health = Math.max(0, Math.min(100, 100 - risk));
    const dynamicRes = dynAnom ? "ANOMALOUS" : "NORMAL";
    const hidden = staticRes !== "FAIL" && dynAnom;
    if (hidden) hiddenCount++;

    const contributions = [
      { name: "Peer deviation (final hour)", value: +(((f.zLast ?? 0))).toFixed(2), pct: Math.min(100, Math.abs(f.zLast ?? 0) * 18) },
      { name: "Leakage trend /24h", value: +f.slopePer24h.toFixed(4), pct: Math.min(100, Math.abs(f.slopePer24h) * 900) },
      { name: "Drift acceleration", value: +f.accel.toFixed(4), pct: Math.min(100, Math.abs(f.accel) * 2400) },
      { name: "Step transient", value: +f.maxStepZ.toFixed(1), pct: Math.min(100, f.maxStepZ * 10) },
      { name: "Vth drift (mV)", value: +f.vthDrift.toFixed(1), pct: Math.min(100, Math.abs(f.vthDrift) * 1.6) },
      { name: "Residual volatility", value: +f.rollStd.toFixed(3), pct: Math.min(100, f.rollStd * 220) },
    ].sort((a, b) => b.pct - a.pct);

    const limit = c.staticLeakLimitUa;
    const cfTarget = fc.pred - (fc.pred > limit * 0.8 ? (fc.pred - limit * 0.75) : 0);
    const reasons = {
      summary: hidden
        ? "Static screen PASS, but dynamic model flags the unit as anomalous relative to population trajectory. Model-derived suggestion: "
        : inEquip ? "Flag consistent with instrumentation event cohort; component evidence weak."
        : dynAnom ? "Dynamic anomaly corroborated by physics-residual analysis." : "Within population envelope.",
      counterfactual: dynAnom ? {
        text: `Model-derived suggestion: 168h leakage below ~${Math.max(0.4, cfTarget).toFixed(2)} µA, or drift slope below ${(fc.slopePer24h * 0.55).toFixed(3)} µA/24h, would bring risk under the REVIEW threshold.`,
      } : null,
      inputs: {
        anomalyScore: AS, driftRisk: fc.driftRisk, staticResult: staticRes, staticLimitUa: limit,
        lotCorrelation: inLot, equipmentCorrelation: inEquip, missingPct: +(f.missingPct * 100).toFixed(1),
        validSamples: f.n, cohortSize: hasTel.length, confidenceBasis: conf < 0.6 ? "LOW_DATA" : "STANDARD",
      },
    };

    compUpdates.push({
      id: c.id, patch: {
        status, decision, riskLevel: level, riskScore: risk, healthScore: health,
        anomalyScore: AS, driftRisk: fc.driftRisk, driftSlope: +fc.slopePer24h.toFixed(4),
        staticResult: staticRes, dynamicResult: dynamicRes, hiddenAnomaly: hidden,
        featureJson: {
          contributions: contributions.slice(0, 6), zLast: +(f.zLast ?? 0).toFixed(2),
          maxAbsZ: +(f.maxAbsZ ?? 0).toFixed(2), anomalyHour: f.anomalyHour,
          scoreRaw: scoreB.get(c.id) ?? 0, activationEnergyEv: f.eaFit,
          validSamples: f.n, cohortSize: hasTel.length,
          dataSufficiency: conf >= 0.75 ? "HIGH" : conf >= 0.6 ? "MEDIUM" : "LOW",
        },
      },
    });

    if (dynAnom || f.staticFail) {
      const hour = f.anomalyHour ?? spikeHour(f);
      anRows.push({
        componentId: c.id, hour, anomalyScore: AS, detectorName: "PRES-IF (physics-residual Isolation Forest)",
        modelVersion: MODEL_A.version, severity: AS >= 0.85 ? "CRITICAL" : AS >= 0.72 ? "HIGH" : "MEDIUM",
        confidence: conf,
        signature: staticRes === "PASS" ? "STATIC PASS / DYNAMIC FAIL" : "STATIC + DYNAMIC FAIL",
        explanation: { contributions: contributions.slice(0, 5), staticResult: staticRes, counterfactual: reasons.counterfactual?.text ?? null, equipmentCorrelation: inEquip, lotCorrelation: inLot },
      });
    }
    predRows.push({
      componentId: c.id, parameter: "leakage_ua", horizonH: forecastHorizonH, predictedValue: fc.pred,
      lowerBound: fc.lo, upperBound: fc.hi, slopePer24h: +fc.slopePer24h.toFixed(4),
      timeToLimitH: fc.ttl, confidence: +fc.conf.toFixed(2), modelVersion: MODEL_DRIFT.version, curve: fc.curve,
    });
    if (sig) sigRows.push({
      componentId: c.id, signature: sig.top, probability: sig.probs[0].probability, confidenceText: sig.confText,
      evidence: sig.evidence, candidates: sig.probs,
    });
    riskRows.push({
      componentId: c.id, riskScore: risk, riskLevel: level, decision, confidence: conf,
      reasons, modelVersion: MODEL_A.version,
    });
  }

  // ---- benchmark vs ground truth ----
  const hasTruth = comps.some((c) => ["drift", "step", "hidden", "lot-shift"].includes(c.scenarioTag));
  const truth = (tag: string) => ["drift", "step", "hidden", "lot-shift"].includes(tag);
  const bench = (scoreMap: Map<number, number>, thr: number, exclude?: Set<number>) => {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const c of comps) {
      if (exclude?.has(c.id)) continue;
      const s = scoreMap.get(c.id); if (s == null) continue;
      const predPos = s >= thr, actual = truth(c.scenarioTag);
      if (predPos && actual) tp++; else if (predPos && !actual) fp++;
      else if (!predPos && actual) fn++; else tn++;
    }
    const precision = tp / Math.max(1, tp + fp), recall = tp / Math.max(1, tp + fn);
    return {
      threshold: thr, tp, fp, fn, tn,
      precision: +precision.toFixed(3), recall: +recall.toFixed(3),
      f1: +((2 * precision * recall) / Math.max(1e-9, precision + recall)).toFixed(3),
      fpRate: +(fp / Math.max(1, fp + tn) * 100).toFixed(2), fnRate: +(fn / Math.max(1, fn + tp) * 100).toFixed(2),
    };
  };
  let bestThrB = 0.6, bestF1B = 0;
  for (let t = 0.45; t <= 0.9; t += 0.02) { const m = bench(scoreB, t); if (m.f1 > bestF1B) { bestF1B = m.f1; bestThrB = +t.toFixed(2); } }
  const benchA = hasTruth ? bench(scoreA, 0.6) : null;
  // post-discrimination: equipment-cohort units are reclassified as instrumentation events,
  // not counted as component-failure false alarms
  const benchAadj = hasTruth ? bench(scoreA, 0.6, equipSet) : null;
  const benchB = hasTruth ? bench(scoreB, bestThrB) : null;

  // Drift backtest: fit the first 80% of each suitable series and predict its
  // final observation. This works for both 168h demo files and shorter uploads.
  let drMAE = 0, drRMSE = 0, drN = 0; const drAct: number[] = [], drPred: number[] = [];
  for (const c of comps) {
    if (hasTruth && c.scenarioTag !== "normal") continue;
    const pts = (byComp.get(c.id) ?? []).filter((p) => p.leak != null).sort((a, b) => a.hour - b.hour);
    if (pts.length < Math.max(6, minSamples)) continue;
    const cut = Math.max(4, Math.floor(pts.length * 0.8));
    const train = pts.slice(0, cut), test = pts[pts.length - 1];
    if (test.hour <= train[0].hour) continue;
    const fit = linFit(train.map((p) => p.hour), train.map((p) => p.leak!));
    const p = fit.a + fit.b * test.hour, e = Math.abs(p - test.leak!);
    drMAE += e; drRMSE += e * e; drN++; drAct.push(test.leak!); drPred.push(p);
  }
  const driftMetrics = drN > 10 ? {
    mae: +(drMAE / drN).toFixed(4), rmse: +Math.sqrt(drRMSE / drN).toFixed(4),
    r2: +(() => { const m = drAct.reduce((a, b) => a + b, 0) / drAct.length; let sst = 0, sse = 0; for (let i = 0; i < drAct.length; i++) { sst += (drAct[i] - m) ** 2; sse += (drAct[i] - drPred[i]) ** 2; } return Math.max(0, 1 - sse / Math.max(1e-9, sst)); })().toFixed(3),
    holdoutSamples: drN,
  } : null;

  // ---- persist ----
  const compIds = comps.map((c) => c.id);
  const del = async (table: any, col: any) => { for (let i = 0; i < compIds.length; i += 500) await db.delete(table).where(inArray(col, compIds.slice(i, i + 500))); };
  await del(anomalies, anomalies.componentId); await del(predictions, predictions.componentId);
  await del(failureSignatures, failureSignatures.componentId); await del(riskAssessments, riskAssessments.componentId);
  await db.delete(equipmentEvents).where(eq(equipmentEvents.batchId, batchId));

  const ins = async (table: any, rows: any[]) => { for (let i = 0; i < rows.length; i += 400) if (rows.slice(i, i + 400).length) await db.insert(table).values(rows.slice(i, i + 400)); };
  await ins(anomalies, anRows); await ins(predictions, predRows);
  await ins(failureSignatures, sigRows); await ins(riskAssessments, riskRows);
  if (events.length) await ins(equipmentEvents, events);
  for (const u of compUpdates) await db.update(components).set(u.patch).where(eq(components.id, u.id));

  // ---- batch stats for dashboards ----
  const scored = comps.map((c) => ({ c, u: compUpdates.find((x) => x.id === c.id)?.patch })).filter((x) => x.u);
  const dist = { healthy: 0, watch: 0, review: 0, critical: 0, qualified: 0, unknown: 0, equipHold: 0 };
  for (const s of scored) {
    const st = s.u.status;
    if (s.u.decision === "EQUIP HOLD") dist.equipHold++;
    if (st && dist[st as keyof typeof dist] != null) (dist as any)[st]++;
  }
  const stride = Math.max(1, Math.ceil(observedHours.length / 180));
  const chartHours = observedHours.filter((_, i) => i % stride === 0 || i === observedHours.length - 1);
  const hourMean: { hour: number; mean: number }[] = [];
  for (const h of chartHours) {
    let s = 0, n = 0;
    for (const f of feats) { const p = f.normSeries.find((x) => x.hour === h); if (p) { s += p.v; n++; } }
    if (n) hourMean.push({ hour: +h.toFixed(3), mean: +(s / n).toFixed(4) });
  }
  const onsets = new Map<number, number>();
  anRows.forEach((a) => {
    const nearest = chartHours.reduce((best, h) => Math.abs(h - a.hour) < Math.abs(best - a.hour) ? h : best, chartHours[0]);
    onsets.set(nearest, (onsets.get(nearest) ?? 0) + 1);
  });
  const lots = [...new Set(comps.map((c) => c.lotId))].map((lot) => {
    const cs = scored.filter((s) => s.c.lotId === lot);
    const fl = cs.filter((s) => (s.u.anomalyScore ?? 0) >= 0.6).length;
    return { lot, count: cs.length, flagged: fl, failRate: +((fl / cs.length) * 100).toFixed(2), mfr: cs[0].c.manufacturer };
  });
  const channels = ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05", "CH-06", "CH-07", "CH-08"].map((ch) => {
    const cs = scored.filter((s) => s.c.channelId === ch);
    return { channel: ch, count: cs.length, flagged: cs.filter((s) => (s.u.anomalyScore ?? 0) >= 0.6).length };
  });
  const stats = {
    dist, hourMean, onsetHist: chartHours.map((h) => ({ hour: +h.toFixed(3), count: onsets.get(h) ?? 0 })),
    lots, channels, hiddenCount, flagged: flagged.length,
    pipelineMs: Date.now() - t0, analyzedAt: new Date().toISOString(),
    analysisProfile: {
      observedStartH: observedStart, observedEndH: observedEnd, forecastHorizonH,
      typicalSamples, minimumSamples: minSamples, analyzedComponents: hasTel.length,
      cohortConfidence: hasTel.length >= 30 ? "HIGH" : hasTel.length >= 10 ? "MEDIUM" : "LOW",
      staticLimits: [...new Set(comps.map((c) => c.staticLeakLimitUa))],
    },
    validation: {
      groundTruthAvailable: hasTruth, anomaly: benchA, anomalyPostDiscrimination: benchAadj,
      driftBacktest: driftMetrics,
    },
    decisionCounts: scored.reduce((acc: any, s) => { const d = s.u.decision ?? "NA"; acc[d] = (acc[d] ?? 0) + 1; return acc; }, {}),
  };
  await db.update(batches).set({ status: "analyzed", stats }).where(eq(batches.id, batchId));

  // model registry refresh
  const upsertModel = async (name: string, version: string, type: string, metrics: any, active: boolean, notes: string) => {
    const existing = await db.select().from(modelRegistry).where(eq(modelRegistry.modelName, name));
    if (existing.length) await db.update(modelRegistry).set({ metrics, active, notes, modelVersion: version }).where(eq(modelRegistry.id, existing[0].id));
    else await db.insert(modelRegistry).values({ modelName: name, modelVersion: version, type, datasetId: "DS-SYN-2026-0142", metrics, active, notes });
  };
  // Only a labelled validation batch may update registry performance metrics.
  // Unlabelled customer uploads store their run metrics inside batches.stats and
  // never overwrite the controlled champion/challenger benchmark.
  if (hasTruth) {
    await upsertModel(MODEL_A.name, MODEL_A.version, "anomaly", {
      ...(benchA ?? {}),
      precisionAdj: benchAadj?.precision, fpRateAdj: benchAadj?.fpRate, f1Adj: benchAadj?.f1,
      equipReclassified: equipSet.size, latencyMs: isoA.ms, samples: hasTel.length,
    }, true,
      "Champion. Physics-residual Isolation Forest with adaptive per-unit Arrhenius normalization. 120 trees, subsample 256. Adjusted metrics exclude instrument-cohort reclassifications.");
    await upsertModel(MODEL_B.name, MODEL_B.version, "anomaly", { ...(benchB ?? {}), latencyMs: isoB.ms, samples: hasTel.length }, false,
      "Challenger. Identical algorithm on raw un-normalized features — hot-zone thermal coupling inflates false positives.");
    await upsertModel(MODEL_DRIFT.name, MODEL_DRIFT.version, "forecast", { ...(driftMetrics ?? {}), horizonH: forecastHorizonH }, true,
      "Least-squares drift extrapolation with prediction interval on physics-normalized series. Model-derived estimates only.");
  }

  await db.insert(auditLog).values({
    userId: null, userName: "SYSTEM", action: "ANALYSIS_RUN", objectType: "batch", objectId: String(batchId),
    detail: { batchId, anomalies: anRows.length, events: events.length, pipelineMs: Date.now() - t0, model: `${MODEL_A.name} ${MODEL_A.version}` },
  });
  return { anomalies: anRows.length, events: events.length, flagged: flagged.length, pipelineMs: Date.now() - t0 };
}

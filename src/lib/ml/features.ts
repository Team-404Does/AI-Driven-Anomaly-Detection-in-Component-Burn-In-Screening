// Physics-informed feature extraction + drift forecasting.
import { arrFactor, STATIC_LEAK_LIMIT, K_B, T_REF_K, EA } from "@/lib/sim/generator";

export interface Pt { hour: number; leak: number | null; vth: number | null; rds: number; temp: number; vds: number; }
export interface SeriesFeat {
  idx: number;
  last: number; firstHour: number; lastHour: number;
  normSeries: { hour: number; v: number }[];   // physics-normalized leakage
  rawSeries: { hour: number; v: number }[];
  slopePer24h: number; accel: number; rollStd: number;
  vthDrift: number; maxStepZ: number; staticFail: boolean; staticWarn: boolean;
  missingPct: number; n: number; eaFit?: number;
  // population-relative, filled later
  maxAbsZ?: number; zLast?: number; anomalyHour?: number | null;
}
export interface Forecast {
  hour168: number; pred: number; lo: number; hi: number; slopePer24h: number;
  ttl: number | null; driftRisk: "LOW" | "MEDIUM" | "HIGH"; r2: number; conf: number;
  curve: { hour: number; pred: number; lo: number; hi: number }[];
}
export interface CompAnalysis {
  idx: number; feat: SeriesFeat; iso: number; isoRaw: number; score: number; scoreRaw: number;
  forecast: Forecast; riskScore: number; riskLevel: string; decision: string;
  health: number; summary: string; contributions: { name: string; value: number; pct: number }[];
  signatureTop?: string;
}

export const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mad = (a: number[], med: number) => Math.max(1e-9, 1.4826 * median(a.map((x) => Math.abs(x - med))));

export function linFit(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxx > 0 ? sxy / sxx : 0, a = my - b * mx;
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) { const r = ys[i] - (a + b * xs[i]); sse += r * r; sst += (ys[i] - my) ** 2; }
  return { a, b, r2: sst > 0 ? Math.max(0, 1 - sse / sst) : 0, rmse: Math.sqrt(sse / Math.max(1, n - 2)) };
}

const GAMMA_V = 3.1; // empirical voltage acceleration exponent
export const normLeak = (leak: number, temp: number, vds: number) =>
  leak / (arrFactor(temp) * Math.pow(vds / 28, GAMMA_V));

export function seriesFeatures(idx: number, pts: Pt[], maxHour: number): SeriesFeat {
  const clean = pts.filter((p) => p.leak != null && p.leak > 0);
  // Adaptive Arrhenius normalization: estimate each unit's effective activation energy
  // η = d ln I / d(1/T) with shrinkage toward the population prior (Ea = 0.7 eV).
  // Units genuinely driven by temperature (hot-zone coupling) get their own Ea fit,
  // so the residual is flat → environment false-alarms are suppressed.
  let ea = EA;
  if (clean.length >= 12) {
    const xs = clean.map((p) => 1 / T_REF_K - 1 / (p.temp + 273.15));
    const ys = clean.map((p) => Math.log(p.leak!) - GAMMA_V * Math.log(p.vds / 28));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    if (sxx > 1e-16) {
      const fit = linFit(xs, ys);
      const se = fit.rmse / Math.sqrt(sxx);
      const tstat = se > 0 ? Math.abs(fit.b) / se : 0;
      const shrink = Math.max(0, Math.min(1, (tstat - 3) / 7));
      const eaHat = fit.b * K_B;
      ea = EA + Math.max(-0.35, Math.min(0.55, eaHat - EA)) * shrink;
    }
  }
  const normSeries = clean.map((p) => ({
    hour: p.hour,
    v: (p.leak! / Math.pow(p.vds / 28, GAMMA_V)) / arrFactor(p.temp, ea),
  }));
  const rawSeries = clean.map((p) => ({ hour: p.hour, v: p.leak! }));
  const xs = normSeries.map((p) => p.hour), ys = normSeries.map((p) => p.v);
  const fit = linFit(xs, ys);
  const slopePer24h = fit.b * 24;
  const half = Math.floor(clean.length / 2) || 1;
  const f1 = linFit(xs.slice(0, half), ys.slice(0, half));
  const f2 = linFit(xs.slice(half), ys.slice(half));
  const accel = (f2.b - f1.b) * 24;
  const resids = normSeries.map((p, i) => p.v - (fit.a + fit.b * xs[i]));
  let maxStep = 0;
  for (let i = 1; i < resids.length; i++) maxStep = Math.max(maxStep, Math.abs(resids[i] - resids[i - 1]));
  const rollStd = Math.sqrt(resids.reduce((a, r) => a + r * r, 0) / Math.max(1, resids.length));
  const vths = pts.filter((p) => p.vth != null).map((p) => p.vth!);
  const vthDrift = vths.length > 1 ? vths[vths.length - 1] - vths[0] : 0;
  const maxLeak = Math.max(0, ...pts.map((p) => p.leak ?? 0));
  const miss = pts.length ? pts.filter((p) => p.leak == null).length / pts.length : 1;
  return {
    idx, last: ys[ys.length - 1] ?? 0, firstHour: xs[0] ?? 0, lastHour: xs[xs.length - 1] ?? 0,
    normSeries, rawSeries, slopePer24h, accel, rollStd, vthDrift, eaFit: +ea.toFixed(3),
    maxStepZ: rollStd > 0 ? maxStep / rollStd : 0,
    staticFail: maxLeak > STATIC_LEAK_LIMIT, staticWarn: maxLeak > STATIC_LEAK_LIMIT * 0.72,
    missingPct: miss, n: clean.length && xs[xs.length - 1] >= maxHour - 8 ? clean.length : 0,
  };
}

export function driftForecast(f: SeriesFeat): Forecast {
  const xs = f.normSeries.map((p) => p.hour), ys = f.normSeries.map((p) => p.v);
  const fit = linFit(xs, ys);
  const n = xs.length;
  const H = 336; // +168h beyond 168h test
  const se = fit.rmse * Math.sqrt(1 + 1 / Math.max(2, n));
  const mk = (hour: number) => {
    const p = fit.a + fit.b * hour;
    const spread = 1.96 * se * Math.sqrt(1 + (hour - xs[xs.length - 1]) / 200);
    return { hour, pred: +p.toFixed(4), lo: +Math.max(0, p - spread).toFixed(4), hi: +(p + spread).toFixed(4) };
  };
  const end = mk(H);
  const ttl = fit.b > 1e-5 && fit.a < STATIC_LEAK_LIMIT
    ? (STATIC_LEAK_LIMIT - fit.a) / fit.b : null;
  let driftRisk: Forecast["driftRisk"] = "LOW";
  if (end.hi > STATIC_LEAK_LIMIT * 0.9 || (ttl != null && ttl < H)) driftRisk = "HIGH";
  else if (end.hi > STATIC_LEAK_LIMIT * 0.6 || (ttl != null && ttl < H * 2)) driftRisk = "MEDIUM";
  const conf = Math.max(0.32, Math.min(0.97, 0.52 + 0.40 * Math.max(0, 1 - f.rollStd * 9) + Math.min(0.05, fit.r2 * 0.05) - (driftRisk === "HIGH" ? 0.06 : 0)));
  return {
    hour168: end.hi, pred: end.pred, lo: end.lo, hi: end.hi,
    slopePer24h: fit.b * 24, ttl, driftRisk, r2: fit.r2, conf,
    curve: [mk(0), mk(56), mk(112), mk(168), mk(224), mk(280), mk(336)],
  };
}

// population-relative z scoring at each hour (physics residual vs peers)
export function populationZ(all: SeriesFeat[], hours: number[]) {
  const perHour = new Map<number, number[]>();
  for (const f of all) for (const p of f.normSeries) {
    if (!perHour.has(p.hour)) perHour.set(p.hour, []);
    perHour.get(p.hour)!.push(p.v);
  }
  const stats = new Map<number, { med: number; mad: number }>();
  for (const h of hours) {
    const arr = perHour.get(h) ?? [];
    const med = median(arr);
    stats.set(h, { med, mad: mad(arr, med) });
  }
  for (const f of all) {
    let maxAbsZ = 0, zLast = 0, anomalyHour: number | null = null;
    let runLen = 0;
    for (const p of f.normSeries) {
      const s = stats.get(p.hour);
      if (!s) continue;
      const z = (p.v - s.med) / s.mad;
      if (Math.abs(z) > Math.abs(maxAbsZ)) maxAbsZ = z;
      zLast = z;
      if (Math.abs(z) > 4) { runLen++; if (runLen >= 2 && anomalyHour == null) anomalyHour = p.hour - 4; }
      else runLen = 0;
    }
    f.maxAbsZ = maxAbsZ; f.zLast = zLast; f.anomalyHour = anomalyHour;
  }
  return stats;
}

export const FEATURE_DEFS: { key: string; name: string; w: number }[] = [
  { key: "zLast", name: "Peer deviation (final)", w: 1.0 },
  { key: "maxAbsZ", name: "Peak residual z", w: 0.9 },
  { key: "slopePer24h", name: "Leakage trend /24h", w: 1.0 },
  { key: "accel", name: "Drift acceleration", w: 0.8 },
  { key: "rollStd", name: "Residual volatility", w: 0.7 },
  { key: "vthDrift", name: "Vth drift", w: 0.85 },
  { key: "maxStepZ", name: "Step transient", w: 0.9 },
  { key: "missingPct", name: "Missing telemetry", w: 0.4 },
];

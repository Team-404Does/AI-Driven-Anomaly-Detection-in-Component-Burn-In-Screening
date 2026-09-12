// Synthetic burn-in batch generator — SIH26170 demo dataset DS-SYN-2026-0142.
// 1,000 components × 43 hourly-4h samples. Controlled injected scenarios with
// ground-truth labels for evaluation (blueprint §37).

export type Scenario = "normal" | "drift" | "step" | "hidden" | "lot-shift" | "equip" | "thermal";

export interface SimComponent {
  code: string; lot: string; wafer: string; mfr: string;
  rack: number; row: number; col: number; socket: string; channel: string;
  tag: Scenario; baseLeak: number;
}
export interface SimTelemetry {
  idx: number; hour: number; leak: number | null; vth: number | null; rds: number;
  temp: number; vds: number; channel: string;
}

// deterministic RNG
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rng: () => number) => {
  const u = Math.max(rng(), 1e-9), v = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export const K_B = 8.617e-5;            // Boltzmann, eV/K
export const EA = 0.7;                  // activation energy, eV (leakage)
export const T_REF_K = 273.15 + 125;
export const arrFactor = (tempC: number, ea = EA) =>
  Math.exp((ea / K_B) * (1 / T_REF_K - 1 / (tempC + 273.15)));

export const STATIC_LEAK_LIMIT = 5.0;   // µA datasheet-style screen limit
export const VTH_MIN = 800, VTH_MAX = 900; // mV

export const TEST_START = new Date("2026-02-09T04:00:00Z");
export const HOURS: number[] = [];
for (let h = 0; h <= 168; h += 4) HOURS.push(h);

const LOTS = ["LOT-2035", "LOT-2036", "LOT-2037", "LOT-2038", "LOT-2039", "LOT-2040"];
const LOT_WT = [0.30, 0.18, 0.12, 0.15, 0.10, 0.15];
const WAFER_PREFIX: Record<string, string> = {
  "LOT-2035": "E", "LOT-2036": "F", "LOT-2037": "G", "LOT-2038": "H", "LOT-2039": "J", "LOT-2040": "K",
};
const LOT_MFR: Record<string, string> = {
  "LOT-2035": "SCL", "LOT-2036": "SCL", "LOT-2037": "SCL", "LOT-2038": "BEL", "LOT-2039": "BEL", "LOT-2040": "SCL",
};
const isHotZone = (row: number, col: number) => (row === 2 || row === 3) && col >= 8 && col <= 10;

export function generateBatch(seed = 26170): { comps: SimComponent[]; tel: SimTelemetry[]; quality: any } {
  const rng = mulberry32(seed);
  const N = 1000;

  // lot assignment with weights
  const lotOf = (i: number) => {
    let r = ((i * 2654435761) % 1000) / 1000, acc = 0;
    for (let k = 0; k < LOTS.length; k++) { acc += LOT_WT[k]; if (r < acc) return LOTS[k]; }
    return LOTS[LOTS.length - 1];
  };

  // scenario indices
  const tags = new Map<number, Scenario>();
  tags.set(42, "step");
  tags.set(77, "hidden");
  const equipIdx: number[] = [];
  for (let i = 0; i < 256 && equipIdx.length < 12; i++) if (i % 16 === 6 || i % 16 === 14) equipIdx.push(i);
  equipIdx.forEach((i) => tags.set(i, "equip"));
  const thermalIdx: number[] = [];
  for (let i = 0; i < 1000 && thermalIdx.length < 4; i++) {
    const row = (i % 128) >> 4, col = i % 16;
    if (isHotZone(row, col) && !tags.has(i)) thermalIdx.push(i);
  }
  thermalIdx.forEach((i) => tags.set(i, "thermal"));
  for (const i of [301, 389, 452, 517, 610, 733, 812, 940]) if (!tags.has(i)) tags.set(i, "drift");
  const shiftIdx: number[] = [];
  for (let i = 130; i < 400 && shiftIdx.length < 5; i++) if (!tags.has(i) && lotOf(i) === "LOT-2036") shiftIdx.push(i);
  shiftIdx.forEach((i) => tags.set(i, "lot-shift"));
  const noDataIdx = new Set([5, 133, 512, 678, 903, 977]);

  const comps: SimComponent[] = [];
  for (let i = 0; i < N; i++) {
    const rack = i >> 7, row = (i % 128) >> 4, col = i % 16;
    const lot = lotOf(i);
    const wp = WAFER_PREFIX[lot];
    let wafer = `WFR-${wp}0${1 + (i * 7919) % 6}`;
    if (tags.get(i) === "lot-shift") wafer = shiftIdx.indexOf(i) < 4 ? `WFR-${wp}02` : `WFR-${wp}05`;
    let base = 1.35 * Math.exp(gauss(rng) * 0.23);
    base = Math.min(2.9, Math.max(0.5, base));
    if (tags.get(i) === "thermal") base = 1.55 + rng() * 0.55;    // population-typical base, high true Ea
    if (tags.get(i) === "hidden") base = 2.8;
    if (tags.get(i) === "step") base = 1.5;
    comps.push({
      code: `COMP-${String(i + 1).padStart(5, "0")}`, lot, wafer, mfr: LOT_MFR[lot],
      rack, row, col,
      socket: `R${rack + 1}-${"ABCDEFGH"[row]}${String(col + 1).padStart(2, "0")}`,
      channel: `CH-0${(col % 8) + 1}`, tag: tags.get(i) ?? "normal", baseLeak: base,
    });
  }

  const tel: SimTelemetry[] = [];
  const driftSlope = [0.0022, 0.0026, 0.0032, 0.0038, 0.0028, 0.0042, 0.0024, 0.0050]; // per hour fraction
  let driftSeen = 0;
  let missing = 0, total = 0;

  for (let i = 0; i < N; i++) {
    if (noDataIdx.has(i)) continue;
    const c = comps[i];
    const tag = c.tag;
    const vthBase = 850 + gauss(rng) * 9 + (c.mfr === "BEL" ? 6 : 0) + (c.lot === "LOT-2036" ? 8 : 0);
    const rdsBase = 118 + gauss(rng) * 3.6;
    const hot = isHotZone(c.row, c.col);
    const sBase = tag === "drift" ? driftSlope[driftSeen++ % driftSlope.length] : 0;

    for (const h of HOURS) {
      const temp = 125 + (hot ? 6 : 0) + 1.2 * Math.sin((2 * Math.PI * h) / 48 + c.rack * 0.9) + gauss(rng) * 0.35;
      const vds = 28 + gauss(rng) * 0.15;
      let leak = c.baseLeak * arrFactor(temp, tag === "thermal" ? 0.9 : EA);
      leak *= 1 + gauss(rng) * 0.015;
      let vth = vthBase - 0.005 * h + gauss(rng) * 2.2;
      let rds = rdsBase + 0.08 * (temp - 125) + gauss(rng) * 0.8;

      if (tag === "drift") leak *= 1 + sBase * h;
      if (tag === "hidden") {
        const g = 0.014 * Math.pow(h / 24, 1.5) + (h > 96 ? 0.008 * Math.pow((h - 96) / 24, 2) : 0);
        leak *= 1 + g;
      }
      if (tag === "step" && h >= 96) { leak = Math.min(12, c.baseLeak * 3.2 + gauss(rng) * 0.2); vth -= 40; rds += 9; }
      if (tag === "lot-shift") vth += 55 * (1 - Math.exp(-h / 60));
      if (tag === "equip" && h >= 88 && h <= 92) { leak += 2.1 + gauss(rng) * 0.15; vth += 35 + gauss(rng) * 3; }

      total++;
      let l: number | null = +leak.toFixed(4), v: number | null = +vth.toFixed(2);
      if (rng() < 0.012) { l = null; missing++; } else if (rng() < 0.004) { v = null; missing++; }
      tel.push({ idx: i, hour: h, leak: l, vth: v, rds: +rds.toFixed(3), temp: +temp.toFixed(3), vds: +vds.toFixed(3), channel: c.channel });
    }
  }

  const missPct = (missing / total) * 100;
  const quality = {
    score: +(97.5 - missPct * 1.6).toFixed(1),
    missingPct: +missPct.toFixed(2),
    duplicatePct: 0.0,
    unknownUnitsPct: 0.0,
    timestampIssuePct: 0.18,
    totalRows: total,
    note: "0.18% out-of-order timestamps re-sequenced at ingest; missing samples flagged, not imputed.",
  };
  return { comps, tel, quality };
}

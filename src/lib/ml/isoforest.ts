// Minimal, deterministic Isolation Forest (Liu et al. 2008) in TypeScript.
import { mulberry32 } from "@/lib/sim/generator";

interface Node { left?: Node; right?: Node; splitF?: number; splitV?: number; size: number; }

export interface IsoForestResult { scores: number[]; ms: number; }

function buildTree(X: number[][], idx: number[], depth: number, maxDepth: number, rng: () => number): Node {
  const n = idx.length;
  if (n <= 1 || depth >= maxDepth) return { size: n };
  const F = X[0].length;
  const mins = new Array(F).fill(Infinity), maxs = new Array(F).fill(-Infinity);
  for (const i of idx) for (let f = 0; f < F; f++) {
    const v = X[i][f];
    if (v < mins[f]) mins[f] = v;
    if (v > maxs[f]) maxs[f] = v;
  }
  const feats: number[] = [];
  for (let f = 0; f < F; f++) if (maxs[f] - mins[f] > 1e-12) feats.push(f);
  if (!feats.length) return { size: n };
  const f = feats[Math.floor(rng() * feats.length)];
  const v = mins[f] + rng() * (maxs[f] - mins[f]);
  const li: number[] = [], ri: number[] = [];
  for (const i of idx) (X[i][f] < v ? li : ri).push(i);
  return { size: n, splitF: f, splitV: v, left: buildTree(X, li, depth + 1, maxDepth, rng), right: buildTree(X, ri, depth + 1, maxDepth, rng) };
}

function pathLength(x: number[], node: Node, depth: number): number {
  if (!node.left && !node.right) return depth + cFactor(node.size);
  return pathLength(x, x[node.splitF!] < node.splitV! ? node.left! : node.right!, depth + 1);
}
const cFactor = (n: number) => (n <= 1 ? 0 : n <= 2 ? 1 : 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n);

export function isolationForest(X: number[][], nTrees = 120, sampleSize = 256, seed = 42): IsoForestResult {
  const t0 = Date.now();
  const n = X.length;
  if (n === 0) return { scores: [], ms: 0 };
  const rng = mulberry32(seed);
  const maxDepth = Math.ceil(Math.log2(sampleSize));
  const trees: Node[] = [];
  for (let t = 0; t < nTrees; t++) {
    const idx: number[] = [];
    for (let s = 0; s < Math.min(sampleSize, n); s++) idx.push(Math.floor(rng() * n));
    trees.push(buildTree(X, idx, 0, maxDepth, rng));
  }
  const c = cFactor(sampleSize) || 1;
  const scores = X.map((x) => {
    let s = 0;
    for (const tr of trees) s += pathLength(x, tr, 0);
    return Math.pow(2, -(s / nTrees) / c);
  });
  return { scores, ms: Date.now() - t0 };
}

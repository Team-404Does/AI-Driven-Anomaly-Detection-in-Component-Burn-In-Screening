"use client";

import { useEffect, useRef, useState } from "react";
import { cn, dt } from "@/lib/utils";
import { Card, CardHead, Empty } from "@/components/ui";
import { History, Search } from "lucide-react";

interface Row { date: string; batch: string; result: string; health: number | null; score: number | null; units?: number }

const RESULT_STYLE: Record<string, string> = {
  REJECT: "text-red-300", REVIEW: "text-purple-300", WATCH: "text-amber-300",
  "EQUIP HOLD": "text-cyan-300", "MANUAL QC": "text-fog", "PASS-EARLY": "text-sky-300", PASS: "text-emerald-300",
};

function healthTone(h: number | null) {
  if (h == null) return "text-fog";
  if (h >= 85) return "text-emerald-300";
  if (h >= 65) return "text-amber-300";
  return "text-red-300";
}

interface Query { mode: "part" | "lot"; q: string; days: number }

export default function HistoryExplorer({ lots, defaultPart }: { lots: string[]; defaultPart?: string }) {
  const [mode, setMode] = useState<"part" | "lot">("part");
  const [part, setPart] = useState(defaultPart ?? "");
  const [lot, setLot] = useState(lots[0] ?? "");
  const [days, setDays] = useState(90);
  const [active, setActive] = useState<Query | null>(null);
  const [data, setData] = useState<{ key: string; rows: Row[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const key = active ? `${active.mode}:${active.q}:${active.days}` : "";
  const loading = !!active && data?.key !== key && !err;

  const run = () => {
    const q = mode === "part" ? part.trim() : lot;
    if (!q) { setErr(mode === "part" ? "Enter a part ID (e.g. BENCH-00043)" : "Pick a lot"); return; }
    setErr(null);
    setActive({ mode, q, days });
  };

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    abort.current?.abort();
    abort.current = ctrl;
    fetch(`/api/history?${active.mode}=${encodeURIComponent(active.q)}&days=${active.days}`, { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "query failed");
        setErr(null);
        setData({ key: `${active.mode}:${active.q}:${active.days}`, rows: j.rows ?? [] });
      })
      .catch((e: any) => {
        if (e.name === "AbortError") return;
        setErr(e.message ?? "query failed");
        setData(null);
      });
    return () => ctrl.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key fully identifies the query

  return (
    <Card>
      <CardHead
        title="Historical analysis"
        sub="prior burn-in campaigns for this part or lot — cross-batch view"
        right={<History size={13} className="text-fog" />}
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-fog">Search by</div>
          <div className="flex overflow-hidden rounded-md border border-line">
            {(["part", "lot"] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setErr(null); }}
                className={cn("px-3 py-1.5 font-mono text-[11px] transition-colors", mode === m ? "bg-sky-400/15 text-sky-200" : "bg-panel2 text-fog hover:text-snow")}>
                {m === "part" ? "Part ID" : "Lot ID"}
              </button>
            ))}
          </div>
        </div>
        {mode === "part" ? (
          <div className="min-w-[200px] flex-1">
            <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-fog">Part ID</div>
            <input value={part} onChange={(e) => setPart(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="e.g. BENCH-00043"
              className="w-full rounded-md border border-line bg-panel2 px-2.5 py-1.5 font-mono text-[12px] text-snow outline-none placeholder:text-fog/60 focus:border-sky-400/40" />
          </div>
        ) : (
          <div className="min-w-[160px] flex-1">
            <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-fog">Lot ID</div>
            <select value={lot} onChange={(e) => setLot(e.target.value)}
              className="w-full rounded-md border border-line bg-panel2 px-2.5 py-1.5 font-mono text-[12px] text-snow outline-none focus:border-sky-400/40">
              {lots.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-fog">Burn-in period</div>
          <div className="flex gap-1">
            {[30, 90, 180, 365].map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={cn("rounded border px-2.5 py-1.5 font-mono text-[10.5px] transition-colors", days === d ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-line bg-panel2 text-fog hover:text-snow")}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={run} className="btn btn-primary mb-0.5">
          <Search size={12} /> Run query
        </button>
      </div>

      <div>
        {err && <div className="px-4 py-3 text-[11.5px] text-red-300">{err}</div>}
        {loading && <div className="px-4 py-6 text-center text-[11.5px] text-fog">Querying campaign archive…</div>}
        {data && data.key === key && data.rows.length === 0 && <Empty msg="No prior campaigns found in the selected window." />}
        {data && data.key === key && data.rows.length > 0 && (
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[9.5px] uppercase tracking-wider text-fog">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Campaign</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Health</th>
                <th className="px-4 py-2 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.rows.map((r, i) => (
                <tr key={r.batch + i} className="transition-colors hover:bg-panel2">
                  <td className="px-4 py-2 font-mono text-fog">{dt(r.date)}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-snow">
                    {r.batch}{r.units ? <span className="ml-1.5 text-[9.5px] text-fog">({r.units} units)</span> : null}
                  </td>
                  <td className={cn("px-4 py-2 font-mono text-[11px] font-medium", RESULT_STYLE[r.result] ?? "text-fog")}>{r.result}</td>
                  <td className="px-4 py-2"><span className={cn("tabular font-mono text-[12px]", healthTone(r.health))}>{r.health ?? "—"}</span></td>
                  <td className="px-4 py-2">
                    <div className="flex h-4 items-end gap-[3px]">
                      {data.rows.slice(Math.max(0, i - 5), i + 1).map((x, k) => (
                        <div key={k} className={cn("w-1 rounded-sm", (x.health ?? 0) >= 85 ? "bg-emerald-400/70" : (x.health ?? 0) >= 65 ? "bg-amber-400/70" : "bg-red-400/70")}
                          style={{ height: `${Math.max(15, Math.min(100, x.health ?? 40))}%` }} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!active && !err && (
          <div className="px-4 py-6 text-center text-[11.5px] text-fog">
            Select a part or lot and run the query to see previous tests, results and health scores.
          </div>
        )}
      </div>
    </Card>
  );
}

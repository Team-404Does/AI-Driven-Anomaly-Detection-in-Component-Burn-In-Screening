import Link from "next/link";
import { Card, CardHead, PageHead, StatusPill, DecisionPill, Mono, Meter, Empty } from "@/components/ui";
import { getActiveBatch, getComponents, getLotOptions } from "@/lib/queries";
import HistoryExplorer from "@/components/history-explorer";
import { cn, fmt } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ComponentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const batch = await getActiveBatch();
  if (!batch) return null;
  const stats: any = batch.stats ?? {};
  const { rows, total, page, pages } = await getComponents(batch.id, {
    q: sp.q, status: sp.status, lot: sp.lot, decision: sp.decision, hidden: sp.hidden === "1", page: Number(sp.page ?? 1),
  });
  const qs = (patch: Record<string, string | number | undefined>) => {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(sp)) if (v != null) merged[k] = String(v);
    for (const [k, v] of Object.entries(patch)) merged[k] = String(v ?? "");
    const p = new URLSearchParams(merged);
    [...p.keys()].forEach((k) => !p.get(k) && p.delete(k));
    return `/components?${p.toString()}`;
  };

  const lots = await getLotOptions();

  return (
    <div className="fade-in space-y-3">
      <PageHead title="Component Registry" sub="Searchable registry across the batch — click a component for its permanent Digital Passport." />
      <Card>
        <CardHead
          title={`${total.toLocaleString()} units`}
          sub="sorted by risk score"
          right={
            <form action="/components" className="flex items-center gap-1.5">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-fog" />
                <input name="q" defaultValue={sp.q} placeholder="code / socket / lot" className="w-44 rounded border border-line bg-panel2 py-1 pl-6 pr-2 font-mono text-[11px] text-snow outline-none placeholder:text-fog" />
              </div>
              <select name="status" defaultValue={sp.status ?? ""} className="rounded border border-line bg-panel2 px-2 py-1 text-[11px] text-snow outline-none">
                <option value="">any status</option><option value="healthy">healthy</option><option value="watch">watch</option><option value="critical">critical</option><option value="qualified">qualified</option><option value="unknown">unknown</option>
              </select>
              <select name="lot" defaultValue={sp.lot ?? ""} className="rounded border border-line bg-panel2 px-2 py-1 font-mono text-[11px] text-snow outline-none">
                <option value="">all lots</option>
                {(stats.lots ?? []).map((l: any) => <option key={l.lot} value={l.lot}>{l.lot}</option>)}
              </select>
              <select name="decision" defaultValue={sp.decision ?? ""} className="rounded border border-line bg-panel2 px-2 py-1 text-[11px] text-snow outline-none">
                <option value="">any decision</option>
                {["PASS", "PASS-EARLY", "WATCH", "REVIEW", "REJECT", "EQUIP HOLD", "MANUAL QC"].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <label className="flex items-center gap-1 text-[10.5px] text-fog"><input type="checkbox" name="hidden" value="1" defaultChecked={sp.hidden === "1"} /> static-pass / AI-fail</label>
              <button className="rounded border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] text-sky-200">Apply</button>
            </form>
          }
        />
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-fog">
              {["Component", "Socket", "Lot / Wafer", "Status", "AS", "Drift", "Risk", "Decision", ""].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {rows.map((c) => (
              <tr key={c.id} className="transition-colors hover:bg-panel2">
                <td className="px-4 py-2">
                  <Link href={`/components/${c.componentCode}`} className="flex items-center gap-1.5 font-mono text-sky-300 hover:text-sky-200">
                    {c.componentCode}
                    {c.hiddenAnomaly && <span className="h-1.5 w-1.5 rounded-full bg-purple-300" title="static-pass / dynamic-fail" />}
                  </Link>
                </td>
                <td className="px-4 py-2 font-mono text-fog">{c.socketId}</td>
                <td className="px-4 py-2 font-mono text-[10.5px] text-fog">{c.lotId} · {c.waferId}</td>
                <td className="px-4 py-2"><StatusPill status={c.status} /></td>
                <td className={cn("tabular px-4 py-2 font-mono", (c.anomalyScore ?? 0) >= 0.6 ? "text-amber-300" : "text-fog")}>{fmt(c.anomalyScore)}</td>
                <td className={cn("tabular px-4 py-2 font-mono", c.driftRisk === "HIGH" ? "text-red-300" : c.driftRisk === "MEDIUM" ? "text-amber-300" : "text-fog")}>{c.driftRisk}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2"><Meter value={c.riskScore ?? 0} /><span className="tabular w-7 font-mono text-[10px] text-fog">{c.riskScore ?? "—"}</span></div>
                </td>
                <td className="px-4 py-2"><DecisionPill decision={c.decision} /></td>
                <td className="px-4 py-2 text-right"><Link href={`/components/${c.componentCode}`} className="text-[10.5px] text-sky-300 hover:underline">passport →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty msg="No components match the filters." />}
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-fog">
          <span className="font-mono">page {page} / {pages}</span>
          <div className="flex gap-1.5">
            <Link href={qs({ page: page - 1 })} className={cn("rounded border border-line bg-panel2 p-1", page <= 1 && "pointer-events-none opacity-40")}><ChevronLeft size={13} /></Link>
            <Link href={qs({ page: page + 1 })} className={cn("rounded border border-line bg-panel2 p-1", page >= pages && "pointer-events-none opacity-40")}><ChevronRight size={13} /></Link>
          </div>
        </div>
      </Card>

      <HistoryExplorer lots={lots} />
    </div>
  );
}

import Link from "next/link";
import { Card, CardHead, PageHead, ChartLegend, ChartNote } from "@/components/ui";
import EChart, { AXIS, TOOLTIP } from "@/components/echart";
import { getActiveBatch, getGenealogy } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { GitBranch, Factory } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function GenealogyPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const sp = await searchParams;
  const batch = await getActiveBatch();
  if (!batch) return null;
  const tree = await getGenealogy(batch.id);
  const selLot = sp.lot ?? tree.slice().sort((a: any, b: any) => b.flagged / b.count - a.flagged / a.count)[0]?.lot;
  const lot = tree.find((l: any) => l.lot === selLot) ?? tree[0];
  const mfrs = [...new Map(tree.map((l: any) => [l.mfr, { mfr: l.mfr, lots: tree.filter((x: any) => x.mfr === l.mfr) }])).values()] as any[];

  const rateOpt = {
    grid: { left: 90, right: 30, top: 10, bottom: 28 },
    // descriptor → client-side formatter (functions can't cross the RSC boundary)
    tooltip: { ...TOOLTIP, formatter: { __fn: { use: "formatter", desc: { kind: "percent" } } } },
    xAxis: { type: "value", ...AXIS, name: "% of lot flagged →", nameLocation: "middle" as const, nameGap: 24 },
    yAxis: { type: "category", data: tree.map((l: any) => l.lot), ...AXIS, name: "lot", nameGap: 44, nameLocation: "middle" as const },
    series: [{
      type: "bar", barWidth: 12,
      data: tree.map((l: any) => ({ value: +((l.flagged / l.count) * 100).toFixed(2), itemStyle: { color: l.lot === selLot ? "#fbbf24" : "#38bdf877" } })),
    }],
  };

  return (
    <div className="fade-in space-y-3">
      <PageHead title="Lot / Wafer Genealogy" sub="Manufacturer → lot → wafer → component lineage with risk propagation. Useful for fault attribution and traceability." />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_300px]">
        <Card>
          <CardHead title="Lineage graph" sub="node size = unit count · tone = flagged share" />
          <div className="space-y-6 overflow-x-auto p-5">
            {mfrs.map((M: any) => (
              <div key={M.mfr}>
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-md border border-line2 bg-panel2 px-2.5 py-1.5">
                    <Factory size={13} className="text-sky-300" />
                    <span className="font-mono text-[12px] text-snow">{M.mfr}</span>
                  </div>
                  <div className="h-px flex-1 bg-line" />
                  <span className="font-mono text-[10px] text-fog">{M.lots.reduce((a: number, l: any) => a + l.count, 0)} units · {M.lots.length} lots</span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {M.lots.map((L: any) => {
                    const rate = L.flagged / L.count;
                    const sel = L.lot === selLot;
                    return (
                      <Link key={L.lot} href={`/genealogy?lot=${L.lot}`}
                        className={cn("rounded-md border p-3 transition-colors", sel ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-line bg-panel2 hover:border-line2")}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[12px] text-snow">{L.lot}</span>
                          <span className={cn("font-mono text-[10px]", rate > 0.02 ? "text-amber-300" : "text-emerald-300")}>{(rate * 100).toFixed(1)}% flagged</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {L.wafers.map((W: any) => (
                            <span key={W.wafer} title={`${W.wafer} · ${W.count} units · ${W.flagged} flagged`}
                              className={cn("rounded border px-1.5 py-0.5 font-mono text-[9px]",
                                W.flagged > 0 ? "border-red-400/30 bg-red-400/10 text-red-300" : "border-line text-fog")}>
                              {W.wafer.replace("WFR-", "")}
                              {W.flagged > 0 ? ` ×${W.flagged}` : ""}
                            </span>
                          ))}
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded bg-[#141b26]">
                          <div className={cn("h-full", rate > 0.02 ? "bg-amber-400/80" : "bg-emerald-400/60")} style={{ width: `${Math.max(3, rate * 100 * 4)}%` }} />
                        </div>
                        <div className="mt-1 font-mono text-[9.5px] text-fog">{L.count} units · {L.wafers.length} wafers</div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHead title="Flag rate by lot" sub="share of each lot's units the engine flagged" />
            <EChart option={rateOpt} height={190} />
            <ChartLegend items={[{ label: "selected lot", color: "#fbbf24" }, { label: "other lots", color: "#38bdf877" }]} />
            <ChartNote>Longer bar = larger share of that lot was flagged. A lot standing far right of its siblings is a process-shift suspect — click it in the lineage graph to drill into wafer-level propagation.</ChartNote>
          </Card>
          <Card>
            <CardHead title={`${selLot ?? "Lot"} risk propagation`} sub="wafer-level drill-down" />
            <div className="space-y-1.5 p-3">
              {(lot?.wafers ?? []).map((W: any) => (
                <Link key={W.wafer} href={`/components?lot=${lot.lot}`}
                  className="flex items-center gap-2 rounded border border-line bg-panel2 px-2.5 py-2 hover:border-line2">
                  <GitBranch size={11} className={W.flagged > 0 ? "text-red-300" : "text-fog"} />
                  <span className="font-mono text-[11px] text-snow">{W.wafer}</span>
                  <span className="ml-auto font-mono text-[10px] text-fog">{W.count}u · {W.flagged} flagged</span>
                </Link>
              ))}
              <p className="pt-1 text-[10px] leading-relaxed text-fog">
                Shared signatures across a wafer suggest process excursions (mask/etch/doping); across wafers of one lot, lot-level
                shifts (anneal, implant dose); across unrelated lots, test equipment or environment — the discrimination engine uses this ordering.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

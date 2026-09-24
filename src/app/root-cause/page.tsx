import Link from "next/link";
import { Card, CardHead, PageHead, Empty, ChartNote } from "@/components/ui";
import EChart, { TOOLTIP } from "@/components/echart";
import { getActiveBatch, getEquipmentEvents } from "@/lib/queries";
import { db } from "@/db";
import { components, failureSignatures } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { ShieldQuestion, GitBranch, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RootCausePage() {
  const batch = await getActiveBatch();
  if (!batch) return null;
  const sigs = await db.select({ s: failureSignatures, c: components })
    .from(failureSignatures).innerJoin(components, eq(failureSignatures.componentId, components.id))
    .where(eq(components.batchId, batch.id)).orderBy(desc(failureSignatures.probability));
  const events = await getEquipmentEvents();

  const bySig = new Map<string, number>();
  sigs.forEach(({ s }) => bySig.set(s.signature, (bySig.get(s.signature) ?? 0) + 1));
  const pieOpt = {
    tooltip: { ...TOOLTIP, formatter: { __fn: { use: "formatter", desc: { kind: "sigPie" } } } },
    series: [{
      type: "pie", radius: ["52%", "78%"],
      label: { color: "#8b95a5", fontSize: 10, formatter: "{b}\n{c}" },
      labelLine: { lineStyle: { color: "#243042" } },
      data: [...bySig.entries()].map(([name, value], i) => ({
        name, value, itemStyle: { color: ["#f87171", "#fbbf24", "#c084fc", "#38bdf8", "#22d3ee", "#34d399"][i % 6] },
      })),
    }],
  };

  return (
    <div className="fade-in space-y-3">
      <PageHead
        title="Root Cause — Failure Fingerprint Engine"
        sub="Candidate mechanisms (TDDB-like, BTI/HCI-like, die-fracture-like, bond-fatigue-like, instrumentation) ranked by pattern evidence. These are model-derived hypotheses consistent with observed signatures — not certified physical diagnoses."
      />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card>
          <CardHead title="Signature distribution" sub={`how often each candidate mechanism appears across ${sigs.length} attributed components`} />
          {sigs.length ? (
            <>
              <EChart option={pieOpt} height={270} />
              <ChartNote tone="amber">Slice size = number of components whose telemetry best matches that mechanism&apos;s fingerprint. These are pattern-matched hypotheses ranked by evidence — the table below shows who and why; physical confirmation requires failure analysis.</ChartNote>
            </>
          ) : <Empty msg="No signatures attributed." />}
        </Card>

        <Card className="xl:col-span-2">
          <CardHead title="Fault-discrimination logic" sub="how the engine separates component vs lot vs equipment vs environment" />
          <div className="p-4">
            <div className="flex items-center gap-2 font-mono text-[11px] text-snow">
              <div className="rounded border border-line2 bg-panel2 px-2.5 py-1.5">{sigs.length} anomalous units</div>
              <span className="text-fog">→</span>
              <span className="text-fog">correlate:</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {[
                { q: "same lot / wafer?", yes: "LOT_PROCESS_SHIFT", got: events.find((e) => e.eventType === "LOT_PROCESS_SHIFT"), cls: "border-purple-400/30 text-purple-200" },
                { q: "same measurement channel?", yes: "INSTRUMENTATION_EVENT", got: events.find((e) => e.eventType === "INSTRUMENTATION_EVENT"), cls: "border-cyan-400/30 text-cyan-200" },
                { q: "same chamber zone + thermal?", yes: "THERMAL_COUPLING_CLEARED", got: events.find((e) => e.eventType === "THERMAL_COUPLING_CLEARED"), cls: "border-amber-400/30 text-amber-200" },
                { q: "synchronized onset ±8h?", yes: "transient/event logic", got: null, cls: "border-line2 text-fog" },
                { q: "isolated & persistent?", yes: "component-level mechanism", got: { assessment: `${sigs.length} attributed to component mechanisms` }, cls: "border-red-400/30 text-red-200" },
                { q: "physics residual clean?", yes: "environment de-bias", got: { assessment: "hot-zone units cleared by Arrhenius normalization" }, cls: "border-emerald-400/30 text-emerald-200" },
              ].map((n) => (
                <div key={n.q} className={`rounded-md border bg-panel2 p-2.5 ${n.cls}`}>
                  <div className="font-mono text-[11px]">{n.q}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-80">YES → {n.yes}</div>
                  {n.got && <div className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-fog">{n.got.assessment}</div>}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Ranked attribution table" sub="confidence-banded; language intentionally non-certifying" />
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-fog">
              {["Component", "Most consistent signature", "Prob", "Confidence", "Evidence", "Context"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {sigs.slice(0, 24).map(({ s, c }) => (
              <tr key={s.id} className="hover:bg-panel2">
                <td className="px-4 py-2"><Link href={`/components/${c.componentCode}`} className="font-mono text-sky-300 hover:text-sky-200">{c.componentCode}</Link></td>
                <td className="max-w-[220px] truncate px-4 py-2 text-snow">{s.signature}</td>
                <td className="tabular px-4 py-2 font-mono text-amber-300">{s.probability}%</td>
                <td className="px-4 py-2 font-mono text-[10px] text-fog">{s.confidenceText}</td>
                <td className="max-w-[300px] truncate px-4 py-2 text-fog">{(s.evidence as string[])?.join("; ")}</td>
                <td className="px-4 py-2 text-[10.5px] text-fog">{c.decision === "EQUIP HOLD" ? "equipment cohort" : c.lotId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-[11px] leading-relaxed text-fog">
        <ShieldQuestion size={14} className="mt-0.5 shrink-0 text-amber-300" />
        <span>Signatures are <b className="text-snow">candidate mechanisms</b> inferred from statistical patterns (growth shape, acceleration, temperature sensitivity, cohort synchronization). Confirming a physical root cause requires failure analysis (FA) — decapsulation, microscopy, EMMI — outside this software-in-the-loop prototype.</span>
      </div>
    </div>
  );
}

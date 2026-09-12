import Link from "next/link";
import { Card, CardHead, PageHead, Tag, Mono, Empty } from "@/components/ui";
import { getModels, getAudit, getFeedbackAll, getActiveBatch } from "@/lib/queries";
import { cn, dt, fmt } from "@/lib/utils";
import { Cpu, GitCommitVertical, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const batch = await getActiveBatch();
  const models = await getModels();
  const page = Math.max(1, Number(sp.page ?? 1));
  const audit = await getAudit(page, 26);
  const fbs = batch ? await getFeedbackAll(batch.id) : [];

  return (
    <div className="fade-in space-y-3">
      <PageHead title="Audit & Model Governance" sub="Model registry with measured benchmarks, decision thresholds (config-validated), human feedback queue and the immutable decision trail." />

      {/* model benchmark cards */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {models.map((m) => {
          const met: any = m.metrics ?? {};
          const isAnom = m.type === "anomaly";
          return (
            <Card key={m.id} className={cn(m.active && "border-emerald-400/20")}>
              <CardHead
                title={m.modelName}
                sub={m.type === "anomaly" ? "Isolation Forest family" : "drift forecast"}
                right={m.active ? <Tag tone="text-emerald-300 border-emerald-400/30 bg-emerald-400/10">ACTIVE</Tag> : <Tag>challenger</Tag>}
              />
              <div className="space-y-2 p-4">
                <div className="flex items-baseline gap-2 font-mono">
                  <span className="text-[15px] text-snow">{m.modelVersion}</span>
                  <span className="text-[10px] text-fog">{m.datasetId}</span>
                </div>
                {isAnom ? (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["F1", met.f1], ["Precision", met.precision], ["Recall", met.recall],
                      ["FP rate", met.fpRate != null ? `${met.fpRate}%` : "—"],
                      ["F1 adj*", met.f1Adj], ["FP adj*", met.fpRateAdj != null ? `${met.fpRateAdj}%` : "—"],
                    ].map(([k, v]) => (
                      <div key={k as string} className="rounded border border-line bg-panel2 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wider text-fog">{k}</div>
                        <div className={cn("tabular mt-0.5 font-mono text-[14px]", m.active ? "text-emerald-300" : "text-snow")}>{v ?? "—"}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {[["MAE", met.mae], ["RMSE", met.rmse], ["R²", met.r2]].map(([k, v]) => (
                      <div key={k as string} className="rounded border border-line bg-panel2 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wider text-fog">{k}</div>
                        <div className="tabular mt-0.5 font-mono text-[14px] text-emerald-300">{v ?? "—"}</div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] leading-relaxed text-fog">{m.notes}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead title="Audit trail" sub="append-only · every decision, label, simulation and report is versioned and attributable" />
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-fog">
                {["Timestamp", "Actor", "Action", "Object", "Detail"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {audit.rows.map((a) => (
                <tr key={a.id} className="hover:bg-panel2">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-fog">{dt(a.createdAt)}</td>
                  <td className="px-4 py-2 font-mono text-[10.5px] text-snow">{a.userName ?? "system"}</td>
                  <td className="px-4 py-2">
                    <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]",
                      a.action.includes("REPORT") ? "border-red-400/25 bg-red-400/10 text-red-300"
                      : a.action.includes("FEEDBACK") ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                      : a.action.includes("WHAT_IF") ? "border-purple-400/25 bg-purple-400/10 text-purple-300"
                      : "border-line bg-panel2 text-fog")}>
                      {a.action}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {a.objectType === "component"
                      ? <Link className="font-mono text-[10.5px] text-sky-300 hover:underline" href={`/components/${a.objectId}`}>{a.objectId}</Link>
                      : <span className="font-mono text-[10.5px] text-fog">{a.objectId}</span>}
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-2 font-mono text-[10px] text-fog">
                    {a.detail ? JSON.stringify(a.detail).slice(0, 90) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-fog">
            <span className="font-mono">{audit.total.toLocaleString()} events · page {audit.page}/{audit.pages}</span>
            <div className="flex gap-1.5">
              <Link href={`/audit?page=${page - 1}`} className={cn("rounded border border-line bg-panel2 p-1", page <= 1 && "pointer-events-none opacity-40")}><ChevronLeft size={13} /></Link>
              <Link href={`/audit?page=${page + 1}`} className={cn("rounded border border-line bg-panel2 p-1", page >= audit.pages && "pointer-events-none opacity-40")}><ChevronRight size={13} /></Link>
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHead title="Decision policy (risk engine vR1)" sub="deterministic layer after ML — configurable, validated on DS-SYN-2026-0142" />
            <div className="space-y-1.5 p-4 font-mono text-[11px]">
              {[["0–30", "HEALTHY / PASS", "#34d399"], ["31–60", "WATCH", "#fbbf24"], ["61–80", "REVIEW (human)", "#c084fc"], ["81–100", "CRITICAL / REJECT", "#f87171"]].map(([b, l, c]) => (
                <div key={l} className="flex items-center gap-2 rounded border border-line bg-panel2 px-2.5 py-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c as string }} />
                  <span className="w-14 text-fog">{b}</span><span>{l}</span>
                </div>
              ))}
              <p className="pt-1 text-[10px] leading-relaxed text-fog">Inputs: anomaly score · drift risk · static status · lot/wafer correlation · equipment signal · missing-data penalty. ML prediction ≠ operational policy.</p>
            </div>
          </Card>
          <Card>
            <CardHead title="Human feedback queue" sub="labels staged for controlled retraining" />
            <div className="divide-y divide-line">
              {fbs.slice(0, 8).map(({ f, c }) => (
                <div key={f.id} className="px-4 py-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <GitCommitVertical size={11} className="text-fog" />
                    <Link href={`/components/${c.componentCode}`} className="font-mono text-sky-300 hover:underline">{c.componentCode}</Link>
                    <span className="ml-auto font-mono text-[9.5px] text-fog">{dt(f.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 pl-[19px] font-mono text-[10px] text-fog">{f.originalLabel} → <span className="text-emerald-300">{f.correctedLabel}</span></div>
                </div>
              ))}
              {fbs.length === 0 && <Empty msg="No engineer labels yet." />}
            </div>
            <div className="border-t border-line px-4 py-2 text-[10px] leading-relaxed text-fog">
              <ShieldCheck size={10} className="mr-1 inline text-emerald-300" />
              Retraining is a gated, versioned process — labels never auto-mutate the active model.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

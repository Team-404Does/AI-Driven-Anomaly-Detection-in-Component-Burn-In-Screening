import { notFound } from "next/navigation";
import { getReport } from "@/lib/queries";
import { dt, fmt, cn } from "@/lib/utils";
import PrintButton from "@/components/print-button";
import { STATUS_META } from "@/lib/utils";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex border-b border-line/60 py-[7px] last:border-0 print:border-neutral-200">
      <span className="w-44 shrink-0 text-[10px] uppercase tracking-wider text-fog print:text-neutral-500">{label}</span>
      <span className="text-[12px] text-snow print:text-black">{children}</span>
    </div>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getReport(Number(id));
  if (!data) notFound();
  const { report, pass } = data;
  const c: any = report.content ?? {};
  const comp = pass?.comp;
  const tel = pass?.tel ?? [];

  // inline SVG observed trace for the print document
  const W = 560, H = 130;
  const leaks = tel.filter((t: any) => t.leakageUa != null);
  const maxY = Math.max(5.5, ...leaks.map((t: any) => t.leakageUa!)) * 1.1;
  const x = (h: number) => 34 + (h / 168) * (W - 42);
  const y = (v: number) => H - 18 - (v / maxY) * (H - 30);
  const path = leaks.map((t: any, i: number) => `${i === 0 ? "M" : "L"}${x(t.hour).toFixed(1)},${y(t.leakageUa!).toFixed(1)}`).join(" ");

  const section = "rounded-lg border border-line bg-panel p-4 print-card";
  return (
    <div className="fade-in mx-auto max-w-3xl space-y-4 print:max-w-none">
      <div className="no-print flex items-center justify-between">
        <div className="font-mono text-[12px] text-fog">report/{report.reportCode}</div>
        <PrintButton />
      </div>

      <div className="print-dark-text space-y-4 bg-panel p-1 print:bg-white">
        {/* header */}
        <div className="flex items-start justify-between border-b-2 border-line2 pb-4 print:border-neutral-800">
          <div>
            <div className="text-[9px] uppercase tracking-[0.22em] text-fog">SIH26170 · Component Reliability Intelligence Platform (prototype)</div>
            <h1 className="mt-1 text-[21px] font-semibold tracking-tight text-snow">{report.title}</h1>
            <div className="mt-1 font-mono text-[11px] text-fog">{report.reportCode} · generated {dt(report.createdAt)} · by {report.generatedBy}</div>
          </div>
          <div className="rounded border border-line2 px-2.5 py-1.5 text-center">
            <div className="font-mono text-[10px] text-fog">FORM</div>
            <div className="font-mono text-[13px] text-snow">{report.reportType}</div>
          </div>
        </div>

        {comp && (
          <div className={section}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fog">1 · Identification</h2>
            <div className="grid grid-cols-2 gap-x-8">
              <div>
                <Row label="Component">{comp.componentCode}</Row>
                <Row label="Manufacturer">{comp.manufacturer}</Row>
                <Row label="Lot / Wafer">{comp.lotId} / {comp.waferId}</Row>
                <Row label="Socket / Channel">{comp.socketId} / {comp.channelId}</Row>
              </div>
              <div>
                <Row label="Static screen">{comp.staticResult}</Row>
                <Row label="Dynamic model">{comp.dynamicResult}</Row>
                <Row label="Decision">{comp.decision}</Row>
                <Row label="Risk score">{comp.riskScore != null ? `${comp.riskScore}/100 · ${comp.riskLevel}` : "—"}</Row>
              </div>
            </div>
          </div>
        )}

        <div className={section}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fog">2 · Observed telemetry — leakage (µA) vs static limit</h2>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            <rect x="0" y="0" width={W} height={H} fill="none" />
            <line x1={34} x2={W - 8} y1={y(5)} y2={y(5)} stroke="#f87171" strokeDasharray="5 4" strokeWidth="1" />
            <text x={W - 12} y={y(5) - 4} fill="#f87171" fontSize="9" textAnchor="end" fontFamily="monospace">STATIC LIMIT 5.0 µA</text>
            {c.anomaly && <line x1={x(c.anomaly.hour)} x2={x(c.anomaly.hour)} y1={8} y2={H - 18} stroke="#fb923c" strokeWidth="1" />}
            <path d={path} fill="none" stroke="#dce3ec" strokeWidth="1.4" className="print:[stroke:#111]" />
            {[0, 84, 168].map((h) => <text key={h} x={x(h)} y={H - 4} fill="#8b95a5" fontSize="9" textAnchor="middle" fontFamily="monospace">{h}h</text>)}
          </svg>
          {c.anomaly && (
            <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
              {[["Onset", `T+${c.anomaly.hour}h`], ["Anomaly score", fmt(c.anomaly.score)], ["Severity", c.anomaly.severity], ["Detector", "PRES-IF v1.4"]].map(([k, v]) => (
                <div key={k} className="rounded border border-line p-2 print:border-neutral-300"><div className="text-[9px] uppercase tracking-wider text-fog">{k}</div><div className="mt-0.5 font-mono text-[12px]">{String(v)}</div></div>
              ))}
            </div>
          )}
        </div>

        <div className={section}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fog">3 · Evidence — why flagged</h2>
          <div className="space-y-1.5">
            {(c.anomaly?.explanation?.contributions ?? []).slice(0, 5).map((x: any) => (
              <div key={x.name} className="flex items-center gap-3">
                <span className="w-48 text-[11px] text-fog">{x.name}</span>
                <div className="h-1.5 flex-1 rounded bg-[#141b26] print:bg-neutral-200"><div className="h-full rounded bg-amber-500/80" style={{ width: `${Math.min(100, x.pct)}%` }} /></div>
                <span className="w-14 text-right font-mono text-[10px] text-fog">{x.pct >= 66 ? "HIGH" : x.pct >= 30 ? "MEDIUM" : "LOW"}</span>
              </div>
            ))}
            {!c.anomaly && <p className="text-[11px] text-fog">No anomaly on record — report documents a clean disposition.</p>}
            {c.anomaly?.explanation?.counterfactual && <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-fog print:border-neutral-200">{c.anomaly.explanation.counterfactual}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className={section}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fog">4 · Candidate mechanism</h2>
            {c.signature ? (
              <>
                <div className="font-mono text-[13px] text-amber-200 print:text-amber-700">{c.signature.top} — {c.signature.probability}%</div>
                <div className="mt-1.5 space-y-1">
                  {(c.signature.evidence ?? []).map((e: string) => <div key={e} className="text-[11px] text-fog">– {e}</div>)}
                </div>
                <div className="mt-2 space-y-1 border-t border-line pt-2 print:border-neutral-200">
                  {(c.signature.candidates ?? []).slice(0, 3).map((x: any) => (
                    <div key={x.signature} className="flex justify-between font-mono text-[10px] text-fog"><span>{x.signature}</span><span>{x.probability}%</span></div>
                  ))}
                </div>
              </>
            ) : <p className="text-[11px] text-fog">No signature above attribution threshold.</p>}
          </div>
          <div className={section}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fog">5 · 168h forecast</h2>
            {c.forecast ? (
              <div className="space-y-1 font-mono text-[11.5px]">
                <div className="flex justify-between"><span className="text-fog">predicted</span><span>{fmt(c.forecast.predictedValue)} µA</span></div>
                <div className="flex justify-between"><span className="text-fog">95% interval</span><span>{fmt(c.forecast.lowerBound)}–{fmt(c.forecast.upperBound)}</span></div>
                <div className="flex justify-between"><span className="text-fog">rate /24h</span><span>{fmt(c.forecast.slopePer24h, 4)} µA</span></div>
                <div className="flex justify-between"><span className="text-fog">est. time-to-limit</span><span>{c.forecast.timeToLimitH ? `~${Math.round(c.forecast.timeToLimitH)}h` : "> horizon"}</span></div>
              </div>
            ) : <p className="text-[11px] text-fog">No forecast available.</p>}
          </div>
        </div>

        <div className={section}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fog">6 · Disposition</h2>
          <p className="text-[12px] leading-relaxed">{c.disposition}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-8">
            <Row label="Anomaly model">{c.modelVersions?.anomaly}</Row>
            <Row label="Drift model">{c.modelVersions?.drift}</Row>
            <Row label="Dataset">{c.dataset}</Row>
            <Row label="Audit ref">report:{report.reportCode}</Row>
          </div>
        </div>

        <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-fog print:border-neutral-300 print:text-neutral-500">
          {c.disclaimer} Generated automatically by the CRIP prototype; every figure originates from stored pipeline
          outputs with model + data version pinning. Distribution restricted to program QA engineering.
        </p>
      </div>
    </div>
  );
}

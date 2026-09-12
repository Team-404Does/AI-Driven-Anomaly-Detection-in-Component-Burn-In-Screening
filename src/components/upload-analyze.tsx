"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RefreshCw, UploadCloud, X, AlertTriangle } from "lucide-react";

export default function UploadAnalyze({ batchId }: { batchId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "analyze" | "upload">(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const steps = [
    "Data validation & unit normalization",
    "Physics normalization (Arrhenius / voltage)",
    "Dynamic anomaly detection (PRES-IF v1.4)",
    "Drift forecasting with uncertainty",
    "Cohort / equipment discrimination",
    "Risk, signatures & audit persistence",
  ];

  const run = async (kind: "analyze" | "upload", file?: File) => {
    setBusy(kind);
    setOpen(true);
    setProgress([]);
    setResult(null);
    setError(null);
    let index = 0;
    const timer = window.setInterval(() => {
      if (index < steps.length - 1) {
        const next = steps[index++];
        if (next) setProgress((current) => [...current, next]);
      }
    }, 420);
    try {
      const response = kind === "analyze"
        ? await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchId }),
          })
        : await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "text/csv; charset=utf-8", "X-File-Name": encodeURIComponent(file!.name) },
            body: await file!.text(),
          });
      const payload = await response.json().catch(() => ({ error: `Server returned HTTP ${response.status}` }));
      if (!response.ok) throw payload;
      setProgress(steps);
      setResult(payload);
      router.refresh();
    } catch (failure: any) {
      setError({
        message: failure?.error ?? failure?.message ?? "The operation failed.",
        stage: failure?.stage ?? (kind === "upload" ? "UPLOAD" : "ANALYSIS"),
        quality: failure?.quality,
      });
    } finally {
      window.clearInterval(timer);
      setBusy(null);
    }
  };

  const resetPicker = () => {
    setResult(null);
    setError(null);
    setProgress([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => run("analyze")}
        disabled={!!busy}
        className="flex items-center gap-1.5 rounded-md border border-line2 bg-panel2 px-3 py-1.5 text-[11.5px] text-snow transition-colors hover:border-sky-400/40 disabled:opacity-50"
      >
        <RefreshCw size={12} className={busy === "analyze" ? "animate-spin" : ""} /> Re-run analysis
      </button>
      <button
        onClick={() => { resetPicker(); setOpen(true); }}
        disabled={!!busy}
        className="flex items-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-[11.5px] text-sky-200 transition-colors hover:bg-sky-400/15 disabled:opacity-50"
      >
        <UploadCloud size={12} /> Upload CSV
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="slide-up max-h-[85vh] w-[560px] overflow-y-auto rounded-lg border border-line2 bg-panel shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-3">
              <div className="text-[13px] font-medium">
                {busy ? "Analyzing batch…" : result ? "Analysis complete" : error ? "Import needs attention" : "Upload burn-in CSV"}
              </div>
              {!busy && <button onClick={() => setOpen(false)} className="text-fog hover:text-snow"><X size={14} /></button>}
            </div>
            <div className="p-4">
              {busy ? (
                <div className="space-y-1.5 font-mono text-[11.5px]">
                  {steps.map((step, i) => {
                    const complete = progress.includes(step);
                    const active = i === progress.length;
                    return (
                      <div key={step} className={`flex items-center gap-2 ${complete ? "text-emerald-300" : active ? "text-snow" : "text-fog/50"}`}>
                        <span className={active ? "pulse-dot text-sky-300" : ""}>{complete ? "✓" : active ? "⟳" : "○"}</span>
                        <span>{step}</span>
                      </div>
                    );
                  })}
                </div>
              ) : result ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-md border border-emerald-400/25 bg-emerald-400/10 p-3 text-emerald-200">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                    <div>
                      <div className="font-mono text-[12px]">{result.batchCode ?? "Batch"} analyzed</div>
                      <div className="mt-0.5 text-[10.5px] text-emerald-200/75">
                        {result.flagged ?? 0} flagged · {result.anomalies ?? 0} anomaly records · {result.events ?? 0} systemic events
                      </div>
                    </div>
                  </div>
                  {result.quality && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          ["Quality", `${result.quality.score}%`],
                          ["Readiness", result.quality.readiness ?? "—"],
                          ["Components", result.quality.components ?? "—"],
                          ["Telemetry rows", result.quality.totalRows?.toLocaleString() ?? "—"],
                          ["Missing leakage", `${result.quality.missingPct}%`],
                          ["Typical samples", result.quality.typicalSamples ?? "—"],
                        ].map(([label, value]) => (
                          <div key={label as string} className="rounded border border-line bg-panel2 p-2">
                            <div className="text-[9px] uppercase tracking-wider text-fog">{label}</div>
                            <div className="mt-0.5 font-mono text-[13px] text-snow">{value}</div>
                          </div>
                        ))}
                      </div>
                      {!!result.quality.warnings?.length && (
                        <div className="rounded border border-amber-400/25 bg-amber-400/[0.07] p-2.5">
                          <div className="mb-1 text-[10px] uppercase tracking-wider text-amber-300">Engineering warnings</div>
                          {result.quality.warnings.map((warning: string) => <div key={warning} className="mt-1 text-[10.5px] leading-relaxed text-fog">• {warning}</div>)}
                        </div>
                      )}
                    </>
                  )}
                  <button onClick={() => setOpen(false)} className="w-full rounded border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-[11.5px] text-sky-200">Open active batch dashboard</button>
                </div>
              ) : error ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 p-3 text-red-200">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <div><div className="font-mono text-[10px] uppercase">{error.stage}</div><div className="mt-1 text-[11.5px] leading-relaxed">{error.message}</div></div>
                  </div>
                  <button onClick={resetPicker} className="w-full rounded border border-line2 bg-panel2 px-3 py-2 text-[11.5px] text-snow">Choose another file</button>
                </div>
              ) : (
                <>
                  <div className="mb-3 text-[11.5px] leading-relaxed text-fog">
                    Accepts common aliases such as <span className="font-mono text-snow">component_id / dut_id</span>,
                    <span className="font-mono text-snow"> elapsed_hours / timestamp</span>, and explicit leakage units
                    <span className="font-mono text-snow"> A / mA / µA / nA</span>. Both wide and parameter/value/unit long formats are supported.
                  </div>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line2 bg-panel2 px-4 py-8 text-fog transition-colors hover:border-sky-400/40 hover:text-snow"
                  >
                    <UploadCloud size={22} />
                    <span className="text-[12px]">Click to select a CSV</span>
                    <span className="font-mono text-[10px]">max 40 MB · quoted CSV supported · no silent imputation</span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => { const file = event.target.files?.[0]; if (file) run("upload", file); }}
                  />
                  <div className="mt-3 rounded border border-line bg-panel2 p-2 text-[10px] leading-relaxed text-fog">
                    Required concepts: component identifier, elapsed time or timestamp, and leakage measurement. Add
                    <span className="font-mono text-snow"> static_limit_ua</span> for device-specific screening; otherwise the clearly reported prototype default is 5 µA.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

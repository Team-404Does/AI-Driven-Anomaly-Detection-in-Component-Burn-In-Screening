"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, UploadCloud, X } from "lucide-react";

export default function UploadAnalyze({ batchId }: { batchId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "analyze" | "upload">(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<any>(null);
  const [schemaMap, setSchemaMap] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const steps = [
    "Data validation", "Physics normalization (Arrhenius / voltage)", "Anomaly detection (PRES-IF v1.4)",
    "Drift forecasting (DRIFT-LIN v2.1)", "Root-cause signatures", "Risk & decision engine",
  ];

  const run = async (kind: "analyze" | "upload", file?: File) => {
    setBusy(kind); setProgress([]); setQuality(null); setSchemaMap(null); setError(null);
    let i = 0;
    const timer = setInterval(() => { if (i < steps.length) { setProgress((p) => [...p, steps[i++]]); } }, 420);
    let failed = false;
    try {
      const sendCsv = async (file: File) => {
        const buf = await file.arrayBuffer();
        if (typeof CompressionStream !== "undefined") {
          const cs = new CompressionStream("gzip");
          new Blob([buf]).stream().pipeThrough(cs);
          const gz = await new Response(cs.readable).arrayBuffer();
          // Vercel caps request bodies at ~4.5 MB — raw CSVs over that 413 before
          // our code runs, so compress and let the API gunzip
          if (gz.byteLength >= buf.byteLength) return { body: buf, gz: false };
          return { body: gz, gz: true };
        }
        return { body: buf, gz: false };
      };
      const { body, gz } = kind === "upload" ? await sendCsv(file!) : { body: undefined, gz: false };
      const res = kind === "analyze"
        ? await fetch("/api/analyze", { method: "POST", body: JSON.stringify({ batchId }) })
        : await fetch("/api/upload", {
            method: "POST",
            body: body as ArrayBuffer,
            headers: gz ? { "Content-Encoding": "gzip", "Content-Type": "text/csv" } : { "Content-Type": "text/csv" },
          });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        const msg = res.status === 413
          ? "File too large for the hosting platform's request limit — even compressed. Split the CSV (e.g. by lot or hour range) or remove optional columns and try again."
          : j.error || `Upload failed (HTTP ${res.status}) — nothing was saved. Try a smaller CSV or re-run the analysis.`;
        setError(msg);
        failed = true;
        return;
      }
      if (j.quality) setQuality(j.quality);
      if (j.schemaMapping) setSchemaMap(j.schemaMapping);
    } catch (e: any) {
      setError(e?.message || "Network error during upload.");
      failed = true;
      return;
    } finally {
      clearInterval(timer);
      setProgress(steps);
      // on failure keep the modal open so the error is actually seen —
      // silently closing looked like "the upload did nothing"
      setTimeout(() => {
        setBusy(null);
        if (!failed) { setOpen(false); router.refresh(); }
      }, failed ? 200 : 900);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => run("analyze")} disabled={!!busy}
        className="btn btn-ghost"
      >
        <RefreshCw size={12} className={busy === "analyze" ? "animate-spin" : ""} /> Re-run analysis
      </button>
      <button
        onClick={() => setOpen(true)} disabled={!!busy}
        className="btn btn-primary"
      >
        <UploadCloud size={12} /> Upload CSV
      </button>

      {(open || busy) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="slide-up w-[520px] rounded-lg border border-line2 bg-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-[13px] font-medium">{busy ? "Analyzing batch…" : "Upload burn-in CSV"}</div>
              {!busy && <button onClick={() => setOpen(false)} className="text-fog hover:text-snow"><X size={14} /></button>}
            </div>
            <div className="p-4">
              {busy ? (
                <div className="space-y-1.5 font-mono text-[11.5px]">
                  {progress.map((s, i) => (
                    <div key={s} className="flex items-center gap-2 text-fog">
                      <span className={i === progress.length - 1 && busy ? "pulse-dot text-sky-300" : "text-emerald-400"}>{i === progress.length - 1 && busy ? "⟳" : "✓"}</span>
                      <span className={i === progress.length - 1 && busy ? "text-snow" : ""}>{s}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="mb-3 text-[11.5px] leading-relaxed text-fog">
                    Expected columns: <span className="font-mono text-snow">component_code, hour, leakage_ua</span>
                    {" "}· optional: <span className="font-mono text-snow">lot_id, wafer_id, manufacturer, channel_id, vth_mv, rds_mohm, chamber_temp_c, vds_stress_v, rack, chamber_row, chamber_col</span>.
                    File is validated before analysis — nothing silent-fails.
                  </div>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line2 bg-panel2 px-4 py-8 text-fog transition-colors hover:border-sky-400/40 hover:text-snow"
                  >
                    <UploadCloud size={22} />
                    <span className="text-[12px]">Drop CSV here or click to browse</span>
                    <span className="font-mono text-[10px]">max 40 MB · validated → physics-normalized → analyzed</span>
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) run("upload", f); }} />
                </>
              )}
              {error && !busy && (
                <div className="mt-3 rounded-md border border-red-400/30 bg-red-400/10 p-3 font-mono text-[11px] text-red-200">
                  {error}
                </div>
              )}
              {schemaMap && !busy && (
                <div className="mt-3 rounded-md border border-sky-400/25 bg-sky-400/10 p-3 font-mono text-[11px] text-sky-200">
                  SCHEMA AUTO-MAP — {schemaMap.join(" · ")}
                </div>
              )}
              {quality && !busy && (
                <div className="mt-3 rounded-md border border-emerald-400/25 bg-emerald-400/10 p-3 font-mono text-[11px] text-emerald-200">
                  DATA QUALITY {quality.score}% — missing {quality.missingPct}% · duplicates {quality.duplicatePct}% · rows {quality.totalRows?.toLocaleString()} · components {quality.components ?? "—"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

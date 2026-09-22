"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";

export default function ReportGenerator({ candidates }: { candidates: Array<{ code: string; decision: string | null; risk: number | null }> }) {
  const router = useRouter();
  const [code, setCode] = useState(candidates[0]?.code ?? "");
  const [type, setType] = useState("NCR");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const generate = async () => {
    if (!code) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componentCode: code, type }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Report generation failed");
      setMessage(`${payload.code} generated`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report generation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select value={code} onChange={(event) => setCode(event.target.value)} className="rounded border border-line bg-panel2 px-2 py-1.5 font-mono text-[10.5px] text-snow outline-none">
        {candidates.map((candidate) => (
          <option key={candidate.code} value={candidate.code}>
            {candidate.code} · {candidate.decision ?? "UNSET"} · risk {candidate.risk ?? "—"}
          </option>
        ))}
      </select>
      <select value={type} onChange={(event) => setType(event.target.value)} className="rounded border border-line bg-panel2 px-2 py-1.5 text-[10.5px] text-snow outline-none">
        <option value="NCR">NCR-style</option>
        <option value="EAR">Engineering assessment</option>
      </select>
      <button onClick={generate} disabled={busy || !code} className="flex items-center gap-1.5 rounded border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-[10.5px] text-sky-200 disabled:opacity-50">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <FilePlus2 size={11} />} Generate
      </button>
      {message && <span className="font-mono text-[9.5px] text-fog">{message}</span>}
    </div>
  );
}

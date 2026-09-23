"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Grid3X3, BarChart3, Boxes, AlertTriangle, FlaskConical,
  GitBranch, FileText, ClipboardList, Activity, Search, Radio, Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard, key: "G" },
  { href: "/chamber", label: "Live Chamber", icon: Grid3X3, key: "C" },
  { href: "/analytics", label: "Batch Analytics", icon: BarChart3, key: "B" },
  { href: "/components", label: "Components", icon: Boxes, key: "M" },
  { href: "/anomalies", label: "Anomalies", icon: AlertTriangle, key: "A" },
  { href: "/lab", label: "Prediction Lab", icon: FlaskConical, key: "P" },
  { href: "/root-cause", label: "Root Cause", icon: Activity, key: "R" },
  { href: "/genealogy", label: "Genealogy", icon: GitBranch, key: "N" },
  { href: "/reports", label: "Reports", icon: FileText, key: "T" },
  { href: "/audit", label: "Audit & Models", icon: ClipboardList, key: "U" },
];

interface BatchLite { id: number; batchCode: string; status: string; componentCount: number; }

export function Shell({ children, batches }: { children: React.ReactNode; batches: BatchLite[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "/") { e.preventDefault(); setPaletteOpen(true); }
      const map: Record<string, string> = { g: "/", c: "/chamber", a: "/anomalies", p: "/lab", b: "/analytics" };
      if (!e.metaKey && !e.ctrlKey && map[e.key.toLowerCase()]) router.push(map[e.key.toLowerCase()]);
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => { if (paletteOpen) setTimeout(() => inputRef.current?.focus(), 30); }, [paletteOpen]);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.length < 2) { setResults([]); return; }
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((x) => x.json());
      setResults(r.results ?? []);
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const active = batches[0];

  return (
    <div className="min-h-screen bg-ink text-snow">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[216px] flex-col border-r border-line bg-panel">
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-line2 bg-panel2">
            <Cpu size={16} className="text-sky-300" />
          </div>
          <div>
            <div className="font-mono text-[12px] font-semibold tracking-wider text-snow">CRIP · v0.9.3</div>
            <div className="text-[10px] tracking-wide text-fog">Component Reliability Intelligence</div>
          </div>
        </div>
        <div className="px-3 pt-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2 rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-[11px] text-fog transition-colors hover:border-line2 hover:text-snow"
          >
            <Search size={12} /> Search components <kbd className="ml-auto">/</kbd>
          </button>
        </div>
        <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {NAV.map((n) => {
            const isActive = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href} href={n.href}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[12px] transition-all",
                  isActive ? "border border-line2 bg-panel2 text-snow" : "border border-transparent text-fog hover:bg-panel2 hover:text-snow",
                )}
              >
                <n.icon size={14} className={isActive ? "text-sky-300" : "text-fog group-hover:text-snow"} />
                <span className="flex-1">{n.label}</span>
                <kbd className="opacity-0 transition-opacity group-hover:opacity-100">{n.key}</kbd>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2 text-[10px] text-fog">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            PIPELINE <span className="font-mono text-snow">PRES-IF v1.4</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-fog">
            <Radio size={10} /> OFFLINE PROFILE · POSTGRES · NO EXTERNAL CALLS
          </div>
        </div>
      </aside>

      {/* Topbar */}
      <header className="fixed left-[216px] right-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-panel/85 px-5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-fog">Active batch</span>
          <span className="rounded border border-line2 bg-panel2 px-2 py-0.5 font-mono text-[12px] text-sky-300">
            {active?.batchCode ?? "—"}
          </span>
          <span className="text-[11px] text-fog">{active ? `${active.componentCount.toLocaleString()} units · ${active.status}` : ""}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-[11px] text-fog md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> burn-in T+168h complete
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-line2 bg-panel2 font-mono text-[10px] text-snow">RN</div>
          <div className="text-right leading-tight">
            <div className="text-[11px] text-snow">R. Nair</div>
            <div className="text-[9px] uppercase tracking-wider text-fog">QA Lead</div>
          </div>
        </div>
      </header>

      <main className="blueprint ml-[216px] min-h-screen px-5 pb-16 pt-[72px]">{children}</main>

      {/* Command palette */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[14vh] backdrop-blur-sm" onClick={() => setPaletteOpen(false)}>
          <div className="slide-up w-[560px] overflow-hidden rounded-lg border border-line2 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
              <Search size={14} className="text-fog" />
              <input
                ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search components — COMP-00077…"
                className="w-full bg-transparent font-mono text-[13px] text-snow outline-none placeholder:text-fog"
              />
              <kbd>ESC</kbd>
            </div>
            <div className="max-h-[320px] overflow-y-auto p-1.5">
              {results.map((r) => (
                <button
                  key={r.code}
                  onClick={() => { setPaletteOpen(false); router.push(`/components/${r.code}`); }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-panel2"
                >
                  <span className="font-mono text-[12px] text-sky-300">{r.code}</span>
                  <span className="font-mono text-[11px] text-fog">{r.socket} · {r.lot}</span>
                  <span className={cn("ml-auto font-mono text-[10px] uppercase", r.status === "critical" ? "text-red-300" : r.status === "watch" ? "text-amber-300" : "text-emerald-300")}>{r.status}</span>
                </button>
              ))}
              {q.length >= 2 && results.length === 0 && <div className="px-3 py-4 text-[12px] text-fog">No matches in registry.</div>}
              {q.length < 2 && (
                <div className="px-3 py-3">
                  <div className="mb-2 text-[10px] uppercase tracking-widest text-fog">Jump to</div>
                  <div className="grid grid-cols-2 gap-1">
                    {NAV.map((n) => (
                      <button key={n.href} onClick={() => { setPaletteOpen(false); router.push(n.href); }}
                        className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-fog hover:bg-panel2 hover:text-snow">
                        <n.icon size={13} /> {n.label} <kbd className="ml-auto">{n.key}</kbd>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

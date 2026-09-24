import { buildRecommendation, type RecommendationInput } from "@/lib/recommend";
import { Sparkles, Check, AlertTriangle, ArrowRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const TONE = {
  reject: { banner: "border-red-400/30 bg-gradient-to-br from-red-400/[0.12] via-red-400/[0.05] to-transparent", text: "text-red-200", chip: "bg-red-400/15 text-red-200 border-red-400/40", tick: "text-red-300", dot: "bg-red-400", glow: "shadow-[0_0_44px_-12px_rgb(248_113_113/0.4)]" },
  review: { banner: "border-purple-400/30 bg-gradient-to-br from-purple-400/[0.12] via-purple-400/[0.05] to-transparent", text: "text-purple-200", chip: "bg-purple-400/15 text-purple-200 border-purple-400/40", tick: "text-purple-300", dot: "bg-purple-400", glow: "shadow-[0_0_44px_-12px_rgb(192_132_252/0.4)]" },
  watch: { banner: "border-amber-400/30 bg-gradient-to-br from-amber-400/[0.12] via-amber-400/[0.05] to-transparent", text: "text-amber-200", chip: "bg-amber-400/15 text-amber-200 border-amber-400/40", tick: "text-amber-300", dot: "bg-amber-400", glow: "" },
  pass: { banner: "border-emerald-400/30 bg-gradient-to-br from-emerald-400/[0.12] via-emerald-400/[0.05] to-transparent", text: "text-emerald-200", chip: "bg-emerald-400/15 text-emerald-200 border-emerald-400/40", tick: "text-emerald-300", dot: "bg-emerald-400", glow: "" },
  equip: { banner: "border-cyan-400/30 bg-gradient-to-br from-cyan-400/[0.12] via-cyan-400/[0.05] to-transparent", text: "text-cyan-200", chip: "bg-cyan-400/15 text-cyan-200 border-cyan-400/40", tick: "text-cyan-300", dot: "bg-cyan-400", glow: "" },
  manual: { banner: "border-line2 bg-gradient-to-br from-white/[0.05] to-transparent", text: "text-snow", chip: "bg-panel2 text-fog border-line2", tick: "text-fog", dot: "bg-fog", glow: "" },
} as const;

export default function AIRecommendation({ input, compact }: { input: RecommendationInput; compact?: boolean }) {
  const rec = buildRecommendation(input);
  const t = TONE[rec.tone];
  const Icon = rec.tone === "reject" || rec.tone === "review" ? AlertTriangle : rec.tone === "pass" ? Check : Info;

  return (
    <div className={cn("overflow-hidden rounded-lg border", t.banner, t.glow)}>
      <div className="flex items-center gap-2 border-b border-line/60 px-4 py-2">
        <Sparkles size={12} className={t.tick} />
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-fog">AI Recommendation</span>
        <span className="ml-auto font-mono text-[9px] text-fog">deterministic · explainable · versioned</span>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn("inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-[15px] font-semibold tracking-wide", t.chip)}>
            <Icon size={15} /> {rec.verdict}
          </span>
          <span className={cn("text-[12px]", t.text)}>{rec.headline}</span>
        </div>

        {!compact && (
          <div className={cn("mt-4 grid gap-4", rec.cautions.length ? "md:grid-cols-3" : "md:grid-cols-2")}>
            <div>
              <div className="mb-1.5 text-[9.5px] font-medium uppercase tracking-[0.14em] text-fog">Reasons</div>
              <ul className="space-y-1.5">
                {rec.reasons.map((r) => (
                  <li key={r} className="flex gap-2 text-[11px] leading-snug text-snow/90">
                    <Check size={11} className={cn("mt-0.5 shrink-0", t.tick)} /> {r}
                  </li>
                ))}
              </ul>
            </div>
            {rec.cautions.length > 0 && (
              <div>
                <div className="mb-1.5 text-[9.5px] font-medium uppercase tracking-[0.14em] text-fog">Cautions</div>
                <ul className="space-y-1.5">
                  {rec.cautions.map((c) => (
                    <li key={c} className="flex gap-2 text-[11px] leading-snug text-amber-200/90">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-300" /> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[9.5px] font-medium uppercase tracking-[0.14em] text-fog">Recommended action</div>
              <ul className="space-y-1.5">
                {rec.actions.map((a, idx) => (
                  <li key={a} className="flex gap-2 text-[11px] leading-snug text-snow/90">
                    <ArrowRight size={11} className={cn("mt-0.5 shrink-0", t.tick)} />
                    <span><span className="mr-1.5 font-mono text-[9px] text-fog">{idx + 1}.</span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-line/60 pt-2 font-mono text-[9px] leading-relaxed text-fog">{rec.basis}</div>
      </div>
    </div>
  );
}

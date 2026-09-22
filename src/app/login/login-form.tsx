"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/roles";
import type { DemoAccount } from "@/lib/demo-accounts";

const ROLE_ORDER: Role[] = ["expert", "worker"];

const FIELD =
  "w-full rounded-md border border-line bg-panel2 px-2.5 py-2 font-mono text-[12px] text-snow outline-none transition-colors focus:border-line2";

export function LoginForm({ accounts }: { accounts: DemoAccount[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `Sign-in failed (HTTP ${res.status}).`);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <section className="rounded-lg border border-line bg-panel p-5">
        <h1 className="text-[15px] font-semibold text-snow">Sign in</h1>
        <p className="mt-1 text-[11px] text-fog">
          Role-based access — dispositions require the industrial-expert role.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-fog">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              placeholder="name@qa.example"
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-fog">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              placeholder="password"
              className={FIELD}
            />
          </label>
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-[11px] text-red-300">
              <AlertTriangle size={12} /> {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md border border-line2 bg-panel2 px-3 py-2 text-[12px] text-snow transition-colors hover:border-sky-400/40 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-line bg-panel p-5">
        <h2 className="text-[13px] font-semibold text-snow">Demo accounts</h2>
        <p className="mt-1 text-[11px] text-fog">
          Seeded reference credentials — select one to fill the form.
        </p>
        <div className="mt-3 space-y-2">
          {accounts.map((a) => (
            <button
              key={a.email}
              type="button"
              onClick={() => {
                setEmail(a.email);
                setPassword(a.password);
                setError(null);
              }}
              className="w-full rounded-md border border-line bg-panel2/60 px-3 py-2 text-left transition-colors hover:border-line2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11.5px] text-snow">{a.email}</span>
                <span className="ml-auto rounded border border-line2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fog">
                  {ROLE_LABELS[a.role]}
                </span>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-fog">
                {a.password} · {a.name} · {a.title}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-2 border-t border-line pt-3">
          {ROLE_ORDER.map((r) => (
            <div key={r}>
              <div className="text-[10px] uppercase tracking-[0.14em] text-sky-300">{ROLE_LABELS[r]}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-fog">{ROLE_DESCRIPTIONS[r]}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

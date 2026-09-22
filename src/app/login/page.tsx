import { redirect } from "next/navigation";
import { Cpu } from "lucide-react";
import { getSession } from "@/lib/auth";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — CRIP" };

// Lives outside the (app) route group on purpose: no sidebar, and no database work
// beyond the session lookup, so the login screen renders even before seeding.
export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <div className="blueprint flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl">
        <header className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line2 bg-panel">
            <Cpu size={18} className="text-sky-300" />
          </div>
          <div>
            <div className="font-mono text-[14px] font-semibold tracking-wider text-snow">CRIP · v0.9.3</div>
            <div className="text-[11px] tracking-wide text-fog">
              Component Reliability Intelligence Platform · SIH26170
            </div>
          </div>
        </header>
        <LoginForm accounts={DEMO_ACCOUNTS} />
        <p className="mt-4 text-[10.5px] leading-relaxed text-fog">
          Prototype with synthetic demonstration data (DS-SYN-2026-0142). Screening output is decision support — final
          component disposition remains with authorized QA engineering.
        </p>
      </div>
    </div>
  );
}

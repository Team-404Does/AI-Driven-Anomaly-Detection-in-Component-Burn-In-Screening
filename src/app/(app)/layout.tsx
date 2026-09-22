import type { ReactNode } from "react";
import { Shell } from "@/components/nav";
import { ensureSeeded } from "@/lib/seed";
import { getBatches } from "@/lib/queries";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Every page in this route group requires a session. Gating happens here, once,
// rather than in each page - so the pages themselves stay untouched.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  await ensureSeeded();
  const batches = (await getBatches()).map((b) => ({
    id: b.id, batchCode: b.batchCode, status: b.status, componentCount: b.componentCount,
  }));
  return (
    <Shell user={{ name: user.name, email: user.email, role: user.role }} batches={batches}>
      {children}
    </Shell>
  );
}

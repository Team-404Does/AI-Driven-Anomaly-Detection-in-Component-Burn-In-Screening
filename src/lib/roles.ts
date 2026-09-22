// Role vocabulary shared by server and client code.
//
// Deliberately free of server-only imports (next/headers, node:crypto), so client
// components can read the labels and capability text without pulling lib/auth - and
// its Node runtime dependencies - into the browser bundle.
export const ROLES = { EXPERT: "expert", WORKER: "worker" } as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  expert: "Industrial Expert",
  worker: "Burn-In Operator",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  expert:
    "Full disposition authority: release, hold or reject units, issue NCR / engineering assessments, and reseed the reference dataset.",
  worker:
    "Chamber and screening operations: monitor burn-in, upload export files, run analysis, and submit triage feedback for expert review.",
};

export function asRole(value: unknown): Role {
  return value === ROLES.EXPERT ? ROLES.EXPERT : ROLES.WORKER;
}

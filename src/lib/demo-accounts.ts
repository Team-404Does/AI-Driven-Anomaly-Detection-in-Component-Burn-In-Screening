// Demo accounts: seeded into the database and shown on the login screen.
//
// Deliberately separate from lib/seed.ts (which imports the database) so the login
// page can display these credentials without pulling database code into its render.
import type { Role } from "@/lib/roles";

export interface DemoAccount {
  name: string;
  email: string;
  role: Role;
  title: string;
  password: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { name: "R. Nair", email: "r.nair@qa.example", role: "expert", title: "QA Lead", password: "expert#26170" },
  { name: "A. Kulkarni", email: "a.kulkarni@qa.example", role: "expert", title: "Reliability Engineer", password: "reliability#26170" },
  { name: "S. Iyer", email: "s.iyer@qa.example", role: "worker", title: "Burn-In Operator", password: "worker#26170" },
];

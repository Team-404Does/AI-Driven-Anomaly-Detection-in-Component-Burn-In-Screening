import "dotenv/config";
import { ensureSeeded } from "@/lib/seed";

const force = process.argv.includes("--force");
ensureSeeded(force)
  .then((r) => { console.log("SEED RESULT", JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error("SEED FAILED", e); process.exit(1); });

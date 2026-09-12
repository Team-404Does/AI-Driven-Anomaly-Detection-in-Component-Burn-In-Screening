"use client";

import { Printer } from "lucide-react";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-[11.5px] text-sky-200 hover:bg-sky-400/15"
    >
      <Printer size={13} /> Export PDF (print)
    </button>
  );
}

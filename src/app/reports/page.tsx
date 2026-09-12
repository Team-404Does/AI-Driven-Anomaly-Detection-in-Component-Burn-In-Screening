import Link from "next/link";
import { Card, CardHead, PageHead, Empty, Tag } from "@/components/ui";
import { getActiveBatch, getComponents, getReports } from "@/lib/queries";
import { dt } from "@/lib/utils";
import { FileText, ArrowUpRight } from "lucide-react";
import ReportGenerator from "@/components/report-generator";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const rows = await getReports();
  const batch = await getActiveBatch();
  const candidates = batch ? (await getComponents(batch.id, { pageSize: 40 })).rows : [];
  return (
    <div className="fade-in space-y-3">
      <PageHead
        title="Engineering Reports"
        sub="Prototype NCR-style and engineering-assessment exports with versioned evidence. Generate directly from the active batch or from a Digital Passport."
        right={<ReportGenerator candidates={candidates.map((c) => ({ code: c.componentCode, decision: c.decision, risk: c.riskScore }))} />}
      />
      <Card>
        <CardHead title={`${rows.length} reports`} sub="print-to-PDF via browser — designed as formal engineering documents" />
        <div className="divide-y divide-line">
          {rows.map(({ r, c }) => (
            <Link key={r.id} href={`/reports/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-panel2">
              <div className="flex h-8 w-8 items-center justify-center rounded border border-line bg-panel2">
                <FileText size={14} className={r.reportType === "NCR" ? "text-red-300" : "text-sky-300"} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-snow">{r.title}</div>
                <div className="font-mono text-[10px] text-fog">{r.reportCode} · by {r.generatedBy} · {dt(r.createdAt)}</div>
              </div>
              <Tag tone={r.reportType === "NCR" ? "text-red-300" : "text-sky-300"}>{r.reportType}</Tag>
              {c && <span className="font-mono text-[11px] text-fog">{c.componentCode}</span>}
              <ArrowUpRight size={13} className="text-fog" />
            </Link>
          ))}
          {rows.length === 0 && <Empty msg="No reports yet — open a component passport and generate one." />}
        </div>
      </Card>
    </div>
  );
}

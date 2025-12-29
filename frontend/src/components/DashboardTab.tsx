import { useEffect, useState } from "react";
import MetricCard from "./MetricCard";
import { Sparkles, CalendarRange } from "lucide-react";
import type { Invoice, InvoiceStatus } from "../data/mockInvoices";
import { formatRangeLabel, isInvoiceInDateRange } from "../utils/dateRangeFilter";
import type { DateRangeFilter } from "../utils/dateRangeFilter";
import { getDisplayStatus, getInvoiceDueDate, formatDisplayDate } from "../utils/invoiceDates";

const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const DASHBOARD_RANGE_KEY = "cashflow_dashboard_date_range";

const isOutstanding = (inv: Invoice): boolean => {
  const status = (inv.status || "").toLowerCase();
  return status !== "paid" && status !== "archived" && inv.amount > 0;
};

const statusStyles: Record<string, string> = {
  Overdue: "bg-rose-50 text-rose-700 border-rose-100",
  "Due soon": "bg-amber-50 text-amber-700 border-amber-100",
  Upcoming: "bg-emerald-50 text-emerald-700 border-emerald-100",
  Unpaid: "bg-slate-100 text-slate-700 border-slate-200",
};

type Props = {
  invoices: Invoice[];
};

type CashflowSummaryResponse = {
  metrics: {
    totalOutstanding: number;
    totalPaid: number;
    countOverdue: number;
    countDueSoon: number;
  };
  summary: string;
};

export default function DashboardTab({ invoices }: Props) {
  const [summary, setSummary] = useState<string>("");
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<boolean>(false);
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>(() => {
    const fallback: DateRangeFilter = "all";
    if (typeof window === "undefined") return fallback;
    const stored = window.localStorage.getItem(DASHBOARD_RANGE_KEY);
    const validRanges: DateRangeFilter[] = ["all", "last_30_days", "last_90_days", "next_14_days", "next_3_months"];
    return stored && (validRanges as string[]).includes(stored) ? (stored as DateRangeFilter) : fallback;
  });
  const [metrics, setMetrics] = useState<CashflowSummaryResponse["metrics"] | null>(null);

  const apiBases = (() => {
    if (typeof window === "undefined") return [""];
    const isDev = window.location.port === "5175" || window.location.hostname === "localhost";
    return isDev ? [""] : ["/cashflow-api", "http://185.151.29.141:3002"];
  })();

  useEffect(() => {
    const fetchSummary = async () => {
      setSummaryLoading(true);
      setSummaryError(false);
      try {
        const range = dateRangeFilter || "all";
        const endpoints = apiBases.map((base) => `${base}/api/cashflow-summary?range=${encodeURIComponent(range)}`);
        let success = false;
        let data: CashflowSummaryResponse | null = null;

        for (const url of endpoints) {
          try {
            const res = await fetch(url);
            if (!res.ok) {
              console.error("Cashflow summary request failed", res.status, "at", url);
              continue;
            }
            data = (await res.json()) as CashflowSummaryResponse;
            console.log("Cashflow summary response:", data);
            success = true;
            break;
          } catch (err) {
            console.error("Cashflow summary fetch error at", url, err);
          }
        }

        if (!success || !data) {
          throw new Error("No successful summary response");
        }

        setSummary(data.summary ?? "");
        setMetrics(data.metrics ?? null);
      } catch (err) {
        console.error("Failed to load cashflow summary", err);
        setSummaryError(true);
      } finally {
        setSummaryLoading(false);
      }
    };
    fetchSummary();
  }, [dateRangeFilter]);

  const now = new Date();
  const outstanding = invoices.filter(isOutstanding);
  const payable = outstanding;

  const openInvoicesWithDate = outstanding
    .map((inv) => {
      const due = getInvoiceDueDate(inv);
      return { inv, due };
    })
    .filter((x) => x.due);

  const dueIn7 = openInvoicesWithDate.filter(({ due }) => {
    if (!due) return false;
    const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  });

  const dueIn30 = openInvoicesWithDate.filter(({ due }) => {
    if (!due) return false;
    const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  });

  const overdue = openInvoicesWithDate.filter(({ due }) => {
    if (!due) return false;
    const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff < 0;
  });

  const dueIn7Amount = dueIn7.reduce((sum, item) => sum + item.inv.amount, 0);
  const dueIn30Amount = dueIn30.reduce((sum, item) => sum + item.inv.amount, 0);
  const overdueAmount = overdue.reduce((sum, item) => sum + item.inv.amount, 0);
  const totalOutstandingAmount = outstanding.reduce((sum, inv) => sum + inv.amount, 0);
  const largestOverdue =
    overdue.length > 0
      ? overdue.reduce((prev, curr) => (curr.inv.amount > prev.inv.amount ? curr : prev)).inv
      : null;

  const upcomingNotPaid = outstanding.filter((inv) => {
    const due = getInvoiceDueDate(inv);
    if (!due) return false;
    const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0;
  });
  const largestUpcoming =
    upcomingNotPaid.length > 0
      ? upcomingNotPaid.reduce((prev, curr) => (curr.amount > prev.amount ? curr : prev))
      : null;

  const attentionInvoices = payable
    .filter((inv) => {
      const status = getDisplayStatus(inv, now);
      const due = getInvoiceDueDate(inv);
      if (!due) return false;
      const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      const inWindow = diff <= 30 && diff >= -365; // include overdue too
      return status !== "Paid" && inWindow && isInvoiceInDateRange(inv, dateRangeFilter, now);
    })
    .sort((a, b) => {
      const aDue = getInvoiceDueDate(a)?.getTime() ?? Infinity;
      const bDue = getInvoiceDueDate(b)?.getTime() ?? Infinity;
      return aDue - bDue;
    })
    .slice(0, 7);

  const rangeLabel = formatRangeLabel(dateRangeFilter, now);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-cyan-600">Overview</p>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">A clear, AI-supported view of what&apos;s due, what&apos;s overdue, and where to focus.</p>
        </div>
        <div className="inline-flex items-center rounded-lg border border-cyan-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm">
          <CalendarRange className="mr-2 h-4 w-4 text-cyan-600" />
          <select
            className="bg-transparent focus:outline-none"
            value={dateRangeFilter}
            onChange={(e) => {
              const next = e.target.value as DateRangeFilter;
              setDateRangeFilter(next);
              if (typeof window !== "undefined") {
                window.localStorage.setItem(DASHBOARD_RANGE_KEY, next);
              }
            }}
          >
            <option value="last_30_days">Last 30 days</option>
            <option value="last_90_days">Last 90 days</option>
            <option value="next_14_days">Next 14 days</option>
            <option value="next_3_months">Next 3 months</option>
            <option value="all">All time</option>
          </select>
          <span className="ml-3 text-xs font-medium text-slate-500">{rangeLabel}</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Due in next 7 days"
          amount={currency.format(dueIn7Amount)}
          hint={`${metrics?.countDueSoon ?? dueIn7.length} invoices to keep on track`}
          gradientIndex={0}
        />
        <MetricCard
          title="Due in next 30 days"
          amount={currency.format(dueIn30Amount)}
          hint={`${dueIn30.length} invoices in this window`}
          gradientIndex={1}
        />
        <MetricCard
          title="Overdue"
          amount={currency.format(overdueAmount)}
          hint={`${metrics?.countOverdue ?? overdue.length} invoices to resolve`}
          gradientIndex={2}
        />
        <MetricCard
          title="Largest upcoming bill"
          amount={largestUpcoming ? currency.format(largestUpcoming.amount) : "£0"}
          hint={
            largestUpcoming
              ? `${largestUpcoming.supplier} · Due ${formatDisplayDate(getInvoiceDueDate(largestUpcoming))}`
              : "No large bills this cycle"
          }
          gradientIndex={3}
          kicker="watch"
        />
      </div>

      <div className="space-y-6">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-lg font-semibold text-slate-900">Needs your attention</p>
            <p className="text-sm text-slate-500">Top invoices that are overdue or coming due.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Supplier", "Invoice #", "Amount", "Due", "Status", "Category"].map((col) => (
                    <th key={col} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attentionInvoices.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-semibold text-slate-900">{item.supplier}</td>
                    <td className="px-3 py-2 text-slate-600">{item.invoiceNumber}</td>
                    <td className="px-3 py-2 font-semibold text-slate-900">{currency.format(item.amount)}</td>
                    <td className="px-3 py-2 text-slate-600">{formatDisplayDate(getInvoiceDueDate(item))}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const displayStatus = getDisplayStatus(item, now);
                        return displayStatus !== "Paid" ? (
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              statusStyles[
                                (displayStatus as Extract<InvoiceStatus, "Overdue" | "Due soon" | "Upcoming">) in
                                statusStyles
                                  ? (displayStatus as Extract<InvoiceStatus, "Overdue" | "Due soon" | "Upcoming">)
                                  : "Upcoming"
                              ]
                            }`}
                          >
                            {displayStatus}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{item.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-2xl border border-cyan-100 bg-gradient-to-r from-cyan-50 via-blue-50 to-purple-50 p-4 shadow-[0_18px_28px_rgba(0,184,255,0.12)]">
          <div className="flex flex-col items-center gap-3 text-center text-sm text-slate-800">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/70 text-cyan-600 shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">AI Cash Flow Analysis</p>
              {summaryLoading && <p>Analysing your cashflow…</p>}
              {summaryError && <p className="text-rose-600">AI summary unavailable. Please try again later.</p>}
              {!summaryLoading && !summaryError && (
                <div className="text-left">
                  <p className="text-sm text-slate-600">
                    <strong>AI summary for this period:</strong>
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    <li>• Cash due in the next 30 days: {currency.format(dueIn30Amount)} across {dueIn30.length} invoice(s).</li>
                    <li>
                      • Overdue exposure: {currency.format(overdueAmount)} across {overdue.length} invoice(s)
                      {largestOverdue ? `; largest single bill around ${currency.format(largestOverdue.amount)}.` : "."}
                    </li>
                    <li>
                      • Overall outstanding (overdue + upcoming): {currency.format(totalOutstandingAmount)} – plan cash to comfortably cover this runway.
                    </li>
                  </ul>
                  <p className="mt-2 text-sm text-slate-600">
                    Kalyan AI suggests tackling overdue items first, then scheduling upcoming payments to smooth the next few weeks of cash outflow.
                  </p>
                </div>
              )}
              {!summaryLoading && !summaryError && summary && <p className="whitespace-pre-line">{summary}</p>}
              {!summaryLoading && !summaryError && !summary && (
                <p className="text-slate-700">Summary not available yet. Please try again shortly.</p>
              )}
              <p className="text-slate-600">View the full cashflow timeline in the Cashflow tab for week-by-week detail.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import MetricCard from "./MetricCard";
import { AlertCircle, BarChart3, Gauge, CheckCircle2 } from "lucide-react";
import type { Invoice } from "../data/mockInvoices";
import { getDisplayStatus, getInvoiceDueDate, formatDisplayDate } from "../utils/invoiceDates";

const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

const statusStyles = {
  Overdue: "border-rose-100 bg-rose-50 text-rose-700",
  "Due soon": "border-amber-100 bg-amber-50 text-amber-700",
  Upcoming: "border-emerald-100 bg-emerald-50 text-emerald-700",
  Paid: "border-slate-200 bg-slate-100 text-slate-700",
  Unpaid: "border-slate-200 bg-slate-100 text-slate-700",
} as const;

type Props = {
  invoices: Invoice[];
};

// Risk thresholds for weekly totals
const RISK_THRESHOLDS = {
  high: 6500,
  medium: 3500,
};

const getWeekStart = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sunday
  const offset = (day + 6) % 7; // Monday start
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
};

export default function CashflowTab({ invoices }: Props) {
  const [showAllWeeks, setShowAllWeeks] = useState(false);
  const today = new Date();
  const windowStart = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  const invoicesWithDue = invoices
    .map((inv) => ({ inv, due: getInvoiceDueDate(inv) }))
    .filter((x) => x.due && x.due >= windowStart && x.due <= windowEnd);

  const weeklyBuckets = invoicesWithDue.reduce<Record<string, { total: number; invoices: Invoice[]; label: string }>>(
    (acc, { inv, due }) => {
      if (!due) return acc;
      const weekStart = getWeekStart(due);
      const key = weekStart.toISOString().slice(0, 10);
      const label = `Week of ${formatDisplayDate(weekStart).replace(" 00:00:00", "")}`;
      const bucket = acc[key] ?? { total: 0, invoices: [], label };
      bucket.total += inv.amount;
      bucket.invoices.push(inv);
      acc[key] = bucket;
      return acc;
    },
    {},
  );

  const weekList = useMemo(
    () =>
      Object.entries(weeklyBuckets)
        .map(([key, data]) => {
          const risk =
            data.total >= RISK_THRESHOLDS.high ? "High" : data.total >= RISK_THRESHOLDS.medium ? "Medium" : "Low";
          return {
            weekId: key,
            label: data.label,
            total: data.total,
            invoices: data.invoices,
            risk,
          };
        })
        .sort((a, b) => new Date(a.weekId).getTime() - new Date(b.weekId).getTime()),
    [weeklyBuckets],
  );

  const visibleWeeks = useMemo(
    () => (showAllWeeks ? weekList : weekList.slice(0, 2)),
    [showAllWeeks, weekList],
  );

  const outgoingTrend = weekList.map((w) => ({ label: w.label, amount: w.total }));
  const maxOutgoing = outgoingTrend.length ? Math.max(...outgoingTrend.map((item) => item.amount)) : 1;

  const overdueCount = invoicesWithDue.filter(({ inv, due }) => {
    if (!due) return false;
    const status = getDisplayStatus(inv, today);
    return status === "Overdue";
  }).length;

  const totalOutgoing = invoicesWithDue.reduce((sum, { inv }) => sum + inv.amount, 0);
  const highestWeek = weekList.length ? Math.max(...weekList.map((w) => w.total)) : 0;
  const highestWeekLabel = weekList.length
    ? weekList.reduce((prev, curr) => (curr.total > prev.total ? curr : prev)).label
    : "this range";

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--spa-muted)]">Cash Flow</p>
        <h1 className="text-3xl font-bold text-slate-900">Cashflow</h1>
        <p className="text-slate-500">
          Stay ahead of busy weeks and larger payments.
          {weekList.length > 0 && (
            <span className="ml-1 text-slate-600">
              (
              {formatDisplayDate(new Date(weekList[0].weekId))} –{" "}
              {formatDisplayDate(new Date(weekList[weekList.length - 1].weekId))})
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Total outgoing"
          amount={currency.format(totalOutgoing)}
          hint="Selected date range"
          gradientIndex={0}
          kicker="live"
        />
        <MetricCard
          title="Busiest payment week"
          amount={currency.format(highestWeek)}
          hint="Based on due weeks"
          gradientIndex={1}
        />
        <MetricCard
          title="Overdue invoices"
          amount={`${overdueCount}`}
          hint="Count of overdue invoices"
          gradientIndex={2}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-slate-900">Payment timeline</p>
            <p className="text-sm text-slate-500">A week-by-week view to help you plan supplier payments with confidence.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {outgoingTrend.map((point) => {
              const height = Math.max(40, (point.amount / maxOutgoing) * 160);
              return (
                <div key={point.label} className="flex-1">
                  <div className="flex h-44 items-end justify-center rounded-xl border border-slate-200 bg-white">
                    <div className="w-10 rounded-lg bg-emerald-300" style={{ height }} />
                  </div>
                  <p className="pt-2 text-center text-xs font-semibold text-slate-500">{point.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="pb-2">
            <p className="text-lg font-semibold text-slate-900">By week</p>
            <p className="text-sm text-slate-500">Totals and risk for each week. Drill in to see which invoices drive spend.</p>
          </div>
          <div className="space-y-3">
            {visibleWeeks.map((week) => (
              <div key={week.label} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{week.label}</p>
                    <p className="text-xs text-slate-500">Total due that week</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold text-slate-900">{currency.format(week.total)}</span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        week.risk === "High"
                          ? "border-rose-100 bg-rose-50 text-rose-700"
                          : week.risk === "Medium"
                            ? "border-amber-100 bg-amber-50 text-amber-700"
                            : "border-emerald-100 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {week.risk} risk
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  {week.invoices.map((item, idx) => (
                    <div
                      key={`${item.supplier}-${idx}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--spa-wash)] text-slate-700">
                          <BarChart3 className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.supplier}</p>
                          <p className="text-xs text-slate-500">Due {formatDisplayDate(getInvoiceDueDate(item))}</p>
                        </div>
                      </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{currency.format(item.amount)}</span>
                    {(() => {
                      const displayStatus = getDisplayStatus(item, today);
                      return (
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            statusStyles[displayStatus] || statusStyles.Upcoming
                          }`}
                        >
                          {displayStatus}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                  ))}
                </div>
              </div>
            ))}
            {weekList.length > 2 && (
              <div className="flex justify-center">
                <button
                  type="button"
                  className="mt-2 text-sm font-medium text-slate-700 hover:underline"
                  onClick={() => setShowAllWeeks((prev) => !prev)}
                >
                  {showAllWeeks ? "Show fewer weeks" : "Show all weeks"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-2 text-sm text-slate-800">
            <AlertCircle className="mt-0.5 h-4 w-4 text-rose-500" />
            <p>
              {highestWeekLabel} is the heaviest week ({currency.format(highestWeek)}). Consider staggering large bills to
              smooth cash out.
            </p>
          </div>
          <div className="flex items-start gap-2 text-sm text-slate-800">
            <Gauge className="mt-0.5 h-4 w-4 text-amber-500" />
            <p>Utilities are tracking 12% higher this month. Renegotiate Northwind Utilities or enable autopay with a cap.</p>
          </div>
          <div className="flex items-start gap-2 text-sm text-slate-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
            <p>Use the early-pay discount with Streamline Legal to trim £95 and free cash later in the month.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

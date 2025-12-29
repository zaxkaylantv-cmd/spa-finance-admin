import type { Invoice } from "../data/mockInvoices";

export type DateRangeFilter = "all" | "last_30_days" | "last_90_days" | "next_14_days" | "next_3_months";

const getInvoiceDate = (invoice: Invoice): Date | null => {
  const raw =
    invoice.dueDateIso ??
    (invoice as any).due_date_iso ?? // backward compatibility for backend snake_case
    invoice.due_date ??
    invoice.dueDate ??
    invoice.issueDate ??
    invoice.issue_date;

  if (!raw) return null;
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
};

export const isInvoiceInDateRange = (invoice: Invoice, range: DateRangeFilter, now: Date): boolean => {
  if (range === "all") return true;
  const date = getInvoiceDate(invoice);
  if (!date) return false;

  const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  switch (range) {
    case "last_30_days": {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return date >= start && date <= now;
    }
    case "last_90_days": {
      const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      return date >= start && date <= now;
    }
    case "next_14_days":
      return diffDays >= 0 && diffDays <= 14;
    case "next_3_months":
      return diffDays >= 0 && diffDays <= 90;
    default:
      return true;
  }
};

export const formatRangeLabel = (range: DateRangeFilter, now: Date): string => {
  if (range === "all") return "All time";

  const fmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  if (range === "last_30_days" || range === "last_90_days") {
    const daysBack = range === "last_30_days" ? 30 : 90;
    const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return `${fmt.format(start)} – ${fmt.format(now)}`;
  }

  if (range === "next_14_days") {
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return `${fmt.format(now)} – ${fmt.format(end)}`;
  }

  if (range === "next_3_months") {
    const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    return `${fmt.format(now)} – ${fmt.format(end)}`;
  }

  return "All time";
};

export const parseInvoiceDateForDisplay = (invoice: Invoice): string => {
  const date =
    invoice.dueDateIso ??
    (invoice as any).due_date_iso ??
    invoice.due_date ??
    invoice.dueDate ??
    invoice.issueDate ??
    invoice.issue_date;
  if (!date) return "—";
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

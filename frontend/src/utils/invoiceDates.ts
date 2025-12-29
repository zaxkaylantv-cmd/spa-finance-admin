import type { Invoice } from "../data/mockInvoices";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type DisplayStatus = "Paid" | "Overdue" | "Due soon" | "Upcoming" | "Unpaid";

export const getInvoiceDueDate = (invoice: Invoice): Date | null => {
  const rawCandidates = [
    (invoice as any).dueDateIso,
    (invoice as any).due_date_iso,
    invoice.dueDate,
    (invoice as any).due_date,
  ];

  for (const raw of rawCandidates) {
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
};

export const getInvoiceIssueDate = (invoice: Invoice): Date | null => {
  const raw = invoice.issueDate ?? (invoice as any).issue_date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
};

export const getDisplayStatus = (invoice: Invoice, today: Date): DisplayStatus => {
  const status = (invoice.status || "").trim().toLowerCase();
  if (status === "paid") return "Paid";

  const due = getInvoiceDueDate(invoice);
  if (!due) return "Unpaid";

  const diffDays = (due.getTime() - today.getTime()) / MS_PER_DAY;

  if (diffDays < 0) return "Overdue";
  if (diffDays <= 7) return "Due soon";
  return "Upcoming";
};

export const formatDisplayDate = (date: Date | null): string =>
  date ? date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "No due date";

export const isOpenInvoice = (invoice: Invoice): boolean => getDisplayStatus(invoice, new Date()) !== "Paid";

import { useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud, FileText } from "lucide-react";
import type { Invoice, InvoiceSource, InvoiceStatus } from "../data/mockInvoices";
import type { DateRangeFilter } from "../utils/dateRangeFilter";
import { isInvoiceInDateRange, formatRangeLabel } from "../utils/dateRangeFilter";
import { apiUrl, getApiBase, tryFetchApi } from "../utils/api";

const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const formatCurrency = (value: any) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return currency.format(num);
};
const formatInvoiceDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const getDocKind = (doc: any): "invoice" | "receipt" | "other" => {
  const raw =
    doc?.doc_type ||
    doc?.docType ||
    doc?.doc_kind ||
    doc?.docKind ||
    doc?.kind ||
    doc?.type ||
    doc?.owner_type ||
    doc?.ownerType ||
    "";
  const lower = String(raw || "").toLowerCase();
  if (lower.includes("receipt")) return "receipt";
  if (lower.includes("invoice")) return "invoice";
  return "other";
};
const formatRelativeTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 60000) return diff >= 0 ? "just now" : "soon";
  if (minutes < 60) return `${minutes}m ${suffix}`;
  if (hours < 24) return `${hours}h ${suffix}`;
  return `${days}d ${suffix}`;
};

const formatPollSeconds = (pollSeconds?: number | null) => {
  if (!Number.isFinite(pollSeconds)) return "Every hour";
  const seconds = Number(pollSeconds);
  if (seconds < 60) {
    const secs = Math.round(seconds);
    return `Every ${secs}s`;
  }
  if (seconds < 3600 || seconds === 3600) {
    const minutes = Math.round(seconds / 60);
    return `Every ${minutes} minutes`;
  }
  if (seconds % 3600 === 0) {
    const hours = Math.round(seconds / 3600);
    return `Every ${hours} hours`;
  }
  const hours = Math.round(seconds / 3600);
  return `Every ${hours} hours`;
};

const getIssueDate = (invoice: Invoice): string | undefined => invoice.issue_date ?? invoice.issueDate;
const getDueDate = (invoice: Invoice): string | undefined => invoice.due_date ?? invoice.dueDate;

const statusStyles: Record<InvoiceStatus, string> = {
  Overdue: "bg-rose-50 text-rose-700 border-rose-200",
  "Due soon": "bg-amber-50 text-amber-700 border-amber-200",
  Upcoming: "bg-[color:var(--spa-wash)] text-slate-800 border-[color:var(--spa-border)]",
  Paid: "bg-slate-100 text-slate-700 border-slate-200",
  Archived: "bg-slate-100 text-slate-500 border-slate-200",
  "Needs info": "bg-amber-50 text-amber-700 border-amber-200",
  Captured: "bg-[color:var(--spa-accent-2)] text-slate-800 border-[color:var(--spa-border)]",
};

const sourceStyles: Record<InvoiceSource, string> = {
  Upload: "bg-[color:var(--spa-wash)] text-slate-800 border-[color:var(--spa-border)]",
  Email: "bg-[color:var(--spa-wash)] text-slate-700 border-[color:var(--spa-border)]",
};

const normalizeSource = (value: unknown): InvoiceSource => {
  const valid: InvoiceSource[] = ["Upload", "Email"];
  if (typeof value === "string") {
    const match = valid.find((opt) => opt.toLowerCase() === value.toLowerCase());
    if (match) return match;
  }
  return "Upload";
};

const DOCUMENTS_RANGE_KEY = "cashflow_documents_date_range";

const normalizeDate = (d: Date) => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const computeInvoiceStatus = (invoice: Invoice, today: Date = new Date()): InvoiceStatus => {
  if (invoice.status === "Paid" || invoice.status === "Archived" || invoice.status === "Needs info" || invoice.status === "Captured") {
    return invoice.status;
  }

  const dueRaw = getDueDate(invoice);
  const dueDate = dueRaw ? new Date(dueRaw) : null;

  if (!dueDate || isNaN(dueDate.getTime())) {
    return "Upcoming";
  }

  const todayMid = normalizeDate(today);
  const dueMid = normalizeDate(dueDate);

  if (dueMid.getTime() < todayMid.getTime()) {
    return "Overdue";
  }

  const diffDays = (dueMid.getTime() - todayMid.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays <= 7) {
    return "Due soon";
  }

  return "Upcoming";
};

const getOriginalFileRef = (invoice: Invoice | null | undefined): string | null => {
  if (!invoice) return null;
  return (
    ((invoice as any).file_ref as string | undefined) ||
    ((invoice as any).fileRef as string | undefined) ||
    ((invoice as any).original_file_ref as string | undefined) ||
    null
  );
};

type AiStatus = {
  configured: boolean;
  requiresKey: boolean;
  authorised: boolean;
};

type Props = {
  invoices: Invoice[];
  onMarkPaid: (id: string) => void;
  onArchive: (id: string) => void;
  onInvoiceCreatedFromUpload?: (invoice: Invoice) => void;
  onArchiveInvoice?: (id: number | string) => void;
  onInvoiceUpdated?: (invoice: Invoice) => void;
  appKey: string;
};

export default function DocumentsTab({
  invoices,
  onMarkPaid,
  onArchive,
  onInvoiceCreatedFromUpload,
  onArchiveInvoice,
  onInvoiceUpdated,
  appKey,
}: Props) {
  const now = useMemo(() => new Date(), []);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [emailConnected, setEmailConnected] = useState<boolean>(true);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [emailStatusData, setEmailStatusData] = useState<{
    data: any | null;
    loading: boolean;
    error: string | null;
    lastUpdated: number | null;
  }>({ data: null, loading: true, error: null, lastUpdated: null });
  const [currentDocTab, setCurrentDocTab] = useState<"invoice" | "receipt">("invoice");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<
    {
      id: string;
      kind: "invoice" | "receipt";
      filename: string;
      startedAt: number;
      status: "uploading" | "done" | "failed";
      message?: string;
      invoiceId?: string | number | null;
      receiptId?: string | number | null;
      driveLink?: string | null;
    }[]
  >([]);
  const [isEditing, setIsEditing] = useState(false);
  const [fileRecords, setFileRecords] = useState<any[]>([]);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiActions, setAiActions] = useState<any | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [autoApprovalStatus, setAutoApprovalStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [emailDraftStatus, setEmailDraftStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string } | null>(null);
  const [notesValue, setNotesValue] = useState("");
  const [notesSavedValue, setNotesSavedValue] = useState("");
  const [editValues, setEditValues] = useState({
    supplier: "",
    invoiceNumber: "",
    issue_date: "",
    due_date: "",
    amount: "",
    status: "",
    category: "",
    notes: "",
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState(() => {
    const fallback: DateRangeFilter = "all";
    if (typeof window === "undefined") {
      return {
        status: "All",
        category: "All",
        source: "All",
        supplier: "",
        dateRange: fallback,
      };
    }

    const stored = window.localStorage.getItem(DOCUMENTS_RANGE_KEY);
    const validRanges: DateRangeFilter[] = ["all", "last_30_days", "last_90_days", "next_14_days", "next_3_months"];
    const range = stored && (validRanges as string[]).includes(stored) ? (stored as DateRangeFilter) : fallback;

    return {
      status: "All",
      category: "All",
      source: "All",
      supplier: "",
      dateRange: range,
    };
  });
  const [receipts, setReceipts] = useState<any[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState<boolean>(true);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const dateRangeLabel = useMemo(() => formatRangeLabel(filters.dateRange, now), [filters.dateRange, now]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const receiptFileInputRef = useRef<HTMLInputElement | null>(null);

  const documents = useMemo(() => {
    if (!receipts.length) return invoices;
    const seen = new Set(invoices.map((doc) => `${getDocKind(doc)}-${doc.id}`));
    const extras = receipts.filter((rec) => {
      const key = `${getDocKind(rec)}-${rec.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...invoices, ...extras];
  }, [invoices, receipts]);

  const filteredDocuments = useMemo(() => {
    const nowDate = new Date();
    const matchesRange = (doc: any) => {
      if (getDocKind(doc) === "receipt") {
        const receiptDate =
          (doc as any).issue_date ||
          (doc as any).issueDate ||
          (doc as any).receipt_date ||
          (doc as any).receiptDate ||
          (doc as any).created_at ||
          (doc as any).createdAt;
        if (!receiptDate) {
          return filters.dateRange === "all";
        }
        const pseudoInvoice = {
          ...doc,
          issue_date: receiptDate,
          issueDate: receiptDate,
          due_date: receiptDate,
          dueDate: receiptDate,
        } as Invoice;
        return isInvoiceInDateRange(pseudoInvoice, filters.dateRange, nowDate);
      }
      return isInvoiceInDateRange(doc as Invoice, filters.dateRange, nowDate);
    };

    return documents
      .filter((doc) => matchesRange(doc))
      .filter((doc) => {
        const statusValue = (doc as any).status || (getDocKind(doc) === "receipt" ? "Captured" : doc.status);
        const categoryValue = (doc as any).category || "Other";
        const sourceValue = (doc as any).source || (doc as any).owner_type || (doc as any).ownerType || "Upload";
        const supplierValue = ((doc as any).supplier || "").toString();
        const statusMatch = filters.status === "All" || statusValue === filters.status;
        const categoryMatch = filters.category === "All" || categoryValue === filters.category;
        const sourceMatch = filters.source === "All" || sourceValue === filters.source;
        const supplierMatch =
          filters.supplier.trim().length === 0 ||
          supplierValue.toLowerCase().includes(filters.supplier.trim().toLowerCase());
        return statusMatch && categoryMatch && sourceMatch && supplierMatch;
      });
  }, [documents, filters]);
  const invoiceRows = useMemo(() => filteredDocuments.filter((doc) => getDocKind(doc) === "invoice"), [filteredDocuments]);
  const receiptRows = useMemo(() => filteredDocuments.filter((doc) => getDocKind(doc) === "receipt"), [filteredDocuments]);
  const tableRows = currentDocTab === "invoice" ? invoiceRows : receiptRows;
  const selectedDoc = useMemo(
    () => documents.find((doc) => doc.id === selectedDocId) ?? null,
    [documents, selectedDocId],
  );
  const originalFileRef = useMemo(() => getOriginalFileRef(selectedDoc), [selectedDoc]);

  useEffect(() => {
    if (selectedDoc) {
      const localNotesKey = `spa_invoice_notes_${selectedDoc.id}`;
      const localNotes =
        typeof window !== "undefined" ? window.localStorage.getItem(localNotesKey) || undefined : undefined;
      const initialNotes = (selectedDoc as any).notes ?? localNotes ?? "";
      setEditValues({
        supplier: selectedDoc.supplier ?? "",
        invoiceNumber: selectedDoc.invoiceNumber ?? (selectedDoc as any).invoice_number ?? "",
        issue_date: selectedDoc.issue_date ?? "",
        due_date: selectedDoc.due_date ?? "",
        amount: selectedDoc.amount != null ? String(selectedDoc.amount) : "",
        status: selectedDoc.status ?? "",
        category: selectedDoc.category ?? "",
        notes: (selectedDoc as any).notes ?? initialNotes ?? "",
      });
      setIsEditing(false);
      setSaveError(null);
      setSaveMessage(null);
      setFileMessage(null);
      setAiActions(null);
      setAiMessage(null);
      setNotesValue(initialNotes);
      setNotesSavedValue(initialNotes);
      const loadFiles = async () => {
        try {
          const isReceipt = (selectedDoc as any).doc_type === "receipt" || (selectedDoc as any).docType === "receipt";
          const basePath = isReceipt ? "/api/receipts" : "/api/invoices";
          const res = await tryFetchApi(`${basePath}/${selectedDoc.id}/files`, {
            headers: {
              ...(appKey ? { "X-APP-KEY": appKey } : {}),
            },
          });
          const data = (await res.json()) as { files?: any[] };
          const rows = Array.isArray(data.files) ? data.files : [];
          const merged = rows.length ? rows : originalFileRef ? [{ id: null, file_ref: originalFileRef }] : [];
          setFileRecords(merged);
          if (!merged.length) {
            setFileMessage("No file attached");
          } else if (!rows.length && originalFileRef) {
            setFileMessage("Original file reference available.");
          }
          setFileStatus(merged.length ? "File: attached" : "File: not attached");
        } catch (err) {
          console.error("Failed to load files", err);
          const fallback = originalFileRef ? [{ id: null, file_ref: originalFileRef }] : [];
          setFileRecords(fallback);
          setFileMessage(originalFileRef ? "Original file reference available." : "Unable to fetch file details.");
          setFileStatus(fallback.length ? "File: attached" : "File: not attached");
        }
      };
      void loadFiles();
    }
  }, [selectedDoc, originalFileRef, appKey]);

  useEffect(() => {
    let cancelled = false;
    const loadReceipts = async () => {
      setReceiptsLoading(true);
      setReceiptsError(null);
      try {
        const res = await tryFetchApi("/api/receipts", {
          headers: {
            ...(appKey ? { "X-APP-KEY": appKey } : {}),
          },
        });
        const data = (await res.json()) as { receipts?: any[] };
        if (cancelled) return;
        const rows = Array.isArray(data.receipts) ? data.receipts : [];
        const normalized = rows.map((rec, idx) => ({
          ...rec,
          id: String(rec.id ?? rec.receipt_id ?? rec.receiptId ?? `receipt-${idx}`),
          doc_type: rec.doc_type || rec.docType || "receipt",
          doc_kind: rec.doc_kind || rec.docKind || "receipt",
          source: rec.source || rec.owner_type || rec.ownerType || rec.source_type || "Upload",
        }));
        setReceipts(normalized);
      } catch (err) {
        if (!cancelled) {
          console.warn("Failed to load receipts", err);
          setReceiptsError("Unable to load receipts right now.");
        }
      } finally {
        if (!cancelled) {
          setReceiptsLoading(false);
        }
      }
    };
    void loadReceipts();
    return () => {
      cancelled = true;
    };
  }, [appKey]);

  useEffect(() => {
    const loadAiStatus = async () => {
      try {
        const res = await tryFetchApi("/api/ai/status", {
          headers: {
            ...(appKey ? { "X-APP-KEY": appKey } : {}),
          },
        });
        if (!res.ok) {
          throw new Error(`AI status fetch failed with ${res.status}`);
        }
        const data = (await res.json()) as { ai_configured?: boolean; requires_key?: boolean; authorised?: boolean };
        setAiStatus({
          configured: Boolean(data.ai_configured),
          requiresKey: data.requires_key !== false,
          authorised: data.authorised !== false,
        });
      } catch (err) {
        console.error("Failed to load AI status", err);
        setAiStatus(null);
      }
    };
    void loadAiStatus();
  }, [appKey]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const loadEmailStatus = async (attempt = 1) => {
      try {
        const res = await tryFetchApi("/api/email/status", {
          headers: {
            ...(appKey ? { "X-APP-KEY": appKey } : {}),
          },
        });
        if (!res.ok) {
          throw new Error(`Email status ${res.status}`);
        }
        const data = await res.json();
        const parsedPollSeconds = Number.isFinite(Number(data?.poll_seconds)) ? Number(data.poll_seconds) : null;
        if (cancelled) return;
        setEmailStatusData({ data: { ...data, poll_seconds: parsedPollSeconds }, loading: false, error: null, lastUpdated: Date.now() });
        if (typeof data.enabled !== "undefined") {
          setEmailConnected(Boolean(data.enabled));
        }
      } catch (err: any) {
        if (cancelled) return;
        const statusMatch =
          typeof err?.message === "string" ? err.message.match(/(?:Bad response|Email status)\s+(\d+)/i) : null;
        const status = statusMatch ? Number(statusMatch[1]) : undefined;
        const isNetworkError = status === 0 || err?.name === "TypeError";
        const shouldRetry = attempt === 1 && (status === 401 || status === 0 || isNetworkError);
        if (shouldRetry) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          if (cancelled) return;
          return loadEmailStatus(attempt + 1);
        }
        setEmailStatusData((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || "Failed to load email status",
        }));
      }
    };
    void loadEmailStatus();
    timer = setInterval(loadEmailStatus, 15000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [appKey]);

  const supplierHistory = useMemo(() => {
    if (!selectedDoc) return [];
    return invoices
      .filter((inv) => inv.supplier === selectedDoc.supplier)
      .map((inv) => {
        const due = inv.due_date ?? inv.dueDate;
        return { ...inv, _parsedDue: due ? new Date(due) : null };
      })
      .sort((a, b) => {
        const aTime = a._parsedDue?.getTime() ?? 0;
        const bTime = b._parsedDue?.getTime() ?? 0;
        return aTime - bTime;
      });
  }, [invoices, selectedDoc]);

  const paidHistory = useMemo(() => supplierHistory.filter((inv) => inv.status === "Paid"), [supplierHistory]);

  const avgPaidAmount = useMemo(() => {
    if (!paidHistory.length) return 0;
    return paidHistory.reduce((sum, inv) => sum + inv.amount, 0) / paidHistory.length;
  }, [paidHistory]);

  const hasSupplierHistory = supplierHistory.length > 0;
  const autoApproveThreshold = useMemo(() => Math.round(((avgPaidAmount || (selectedDoc?.amount ?? 0)) * 1.5) / 50) * 50, [avgPaidAmount, selectedDoc?.amount]);

  const shouldSuggestAutoApprove = useMemo(() => {
    if (!selectedDoc) return false;
    const baseline = avgPaidAmount || selectedDoc.amount || 0;
    return hasSupplierHistory && paidHistory.length >= 1 && selectedDoc.amount <= baseline * 1.5;
  }, [avgPaidAmount, hasSupplierHistory, paidHistory.length, selectedDoc]);

  const negotiationInsight = useMemo(() => {
    if (!supplierHistory.length) return { shouldSuggest: false, increasePct: 0, recentAvg: 0, previousAvg: 0 };

    const recent = supplierHistory.slice(-3);
    const previous = supplierHistory.slice(-6, -3);

    if (recent.length < 3 || previous.length < 3) {
      return { shouldSuggest: false, increasePct: 0, recentAvg: 0, previousAvg: 0 };
    }

    const avg = (arr: typeof supplierHistory) =>
      arr.reduce((sum, inv) => sum + inv.amount, 0) / (arr.length || 1);

    const recentAvg = avg(recent);
    const previousAvg = avg(previous);

    if (!previousAvg) {
      return { shouldSuggest: false, increasePct: 0, recentAvg, previousAvg };
    }

    const increasePct = ((recentAvg - previousAvg) / previousAvg) * 100;
    return {
      shouldSuggest: increasePct >= 15,
      increasePct,
      recentAvg,
      previousAvg,
    };
  }, [supplierHistory]);

  const aiReady = useMemo(() => {
    if (!aiStatus) return true;
    if (!aiStatus.configured) return false;
    if (aiStatus.requiresKey && !aiStatus.authorised) return false;
    return true;
  }, [aiStatus]);

  const aiUnavailableReason = useMemo(() => {
    if (!aiStatus) return null;
    if (!aiStatus.configured) return "AI not configured (OpenAI key missing).";
    if (aiStatus.requiresKey && !aiStatus.authorised) {
      return "Add your app key in Settings to use AI actions.";
    }
    return null;
  }, [aiStatus]);

  const hasOriginalFile = useMemo(
    () => fileRecords.length > 0 || Boolean(originalFileRef),
    [fileRecords.length, originalFileRef],
  );
  const primaryFileId = fileRecords[0]?.id ?? null;
  const primaryFileRef = fileRecords[0]?.file_ref ?? originalFileRef ?? null;

  const apiBase = getApiBase();

  const formatAmountSafe = (value: any) => formatCurrency(value);

  const handleDownloadFile = async (fileId?: number | null, fileRef?: string | null) => {
    const ref = fileRef || null;
    if (!fileId && !ref) {
      setFileMessage("No file attached");
      return;
    }
    try {
      if (ref && ref.startsWith("http")) {
        window.open(ref, "_blank");
        return;
      }
      if (ref && ref.startsWith("gdrive:")) {
        const res = await tryFetchApi(`/api/files/download-by-ref?ref=${encodeURIComponent(ref)}`);
        if (!res.ok) {
          setAiMessage("Unable to download file.");
          return;
        }
        const data = await res.json().catch(() => null);
        const link = data?.link;
        if (link) {
          window.open(link, "_blank", "noopener,noreferrer");
        } else {
          setAiMessage("Unable to download file.");
        }
        return;
      }
      const targetPath = fileId
        ? `/api/files/${fileId}/download`
        : ref
          ? `/api/files/download-by-ref?ref=${encodeURIComponent(ref)}`
          : null;
      if (!targetPath) {
        setFileMessage("No file attached");
        return;
      }
      const res = await tryFetchApi(targetPath, {
        headers: {
          ...(appKey ? { "X-APP-KEY": appKey } : {}),
        },
      });
      if (res.status === 401) {
        setFileMessage("App key required to open files. Add it in Settings.");
        return;
      }
      if (res.status === 501) {
        setFileMessage("Google Drive files coming soon.");
        return;
      }
      if (!res.ok) {
        setFileMessage("Unable to download file.");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err) {
      console.error("File download failed", err);
      setFileMessage("Unable to download file.");
    }
  };

  const fetchAiActions = async () => {
    if (!selectedDoc) return null;
    if (!aiReady) {
      setAiMessage(aiUnavailableReason || "AI actions need configuration.");
      return null;
    }
    setAiLoading(true);
    setAiMessage(null);
    try {
      const res = await tryFetchApi(`/api/ai/invoices/${selectedDoc.id}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(appKey ? { "X-APP-KEY": appKey } : {}),
        },
      });
      if (res.status === 501) {
        setAiMessage("AI not configured (OPENAI_API_KEY missing).");
        return null;
      }
      if (!res.ok) {
        setAiMessage("AI suggestion unavailable right now.");
        return null;
      }
      const data = (await res.json()) as { actions?: any };
      setAiActions(data.actions || null);
      return data.actions || null;
    } catch (err) {
      console.error("AI actions fetch failed", err);
      setAiMessage("AI suggestion unavailable right now.");
      return null;
    } finally {
      setAiLoading(false);
    }
  };

  const ensureAiReady = () => {
    if (!aiReady) {
      setAiMessage(aiUnavailableReason || "AI actions need configuration.");
      return false;
    }
    return true;
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };
  const handleReceiptFileSelect = () => {
    receiptFileInputRef.current?.click();
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    const queueId = `inv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setUploadQueue((prev) =>
      [{ id: queueId, kind: "invoice" as const, filename: file.name, startedAt: Date.now(), status: "uploading" as const }, ...prev].slice(
        0,
        5
      )
    );
    const mime = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    const isPdf = mime === "application/pdf" || mime.includes("pdf") || name.endsWith(".pdf");
    const isImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name);
    if (!isPdf && !isImage) {
      setUploadStatus("error");
      setUploadMessage("Unsupported file type. Please upload a PDF or image invoice.");
      setUploadQueue((prev) =>
        prev.map((u) => (u.id === queueId ? { ...u, status: "failed" as const, message: "Unsupported type" } : u))
      );
      return;
    }

    setUploadStatus("uploading");
    setUploadMessage("Uploading invoice…");
    try {
      const url = `${apiBase}/api/upload-invoice`;
      let data: any = null;

      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await tryFetchApi("/api/upload-invoice", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          console.error("Upload failed", response.status, "at", url);
          setUploadStatus("error");
          try {
            const errorData = (await response.json()) as { error?: string };
            setUploadMessage(errorData?.error || "Upload failed. Please try again.");
          } catch {
            setUploadMessage("Upload failed. Please try again.");
          }
          return;
        }
        data = await response.json();
      } catch (err) {
        console.error("Upload error at", url, err);
        setUploadStatus("error");
        setUploadMessage("Upload failed. Please try again.");
        setUploadQueue((prev) => prev.map((u) => (u.id === queueId ? { ...u, status: "failed" as const, message: "Network error" } : u)));
        return;
      }

      console.log("Upload success:", data);
      if (data?.duplicate) {
        setUploadStatus("success");
        setUploadMessage("Already uploaded (duplicate) — no new record created.");
        setUploadQueue((prev) =>
        prev.map((u) => (u.id === queueId ? { ...u, status: "done" as const, message: "Duplicate detected" } : u))
      );
        return;
      }
      setUploadStatus("success");
      if (data?.needs_review) {
        setUploadMessage("Uploaded — needs review. Please open the invoice and add missing details.");
      } else {
        setUploadMessage("File uploaded successfully.");
      }
      if (data?.invoice && onInvoiceCreatedFromUpload) {
        onInvoiceCreatedFromUpload(data.invoice as Invoice);
      }
      setUploadQueue((prev) =>
        prev.map((u) =>
          u.id === queueId
            ? {
                ...u,
                status: "done" as const,
                message: data?.needs_review ? "Needs review" : "Uploaded",
                invoiceId: data?.invoice?.id ?? null,
                driveLink: data?.invoice?.file_ref ?? null,
              }
            : u
        )
      );
    } catch (error) {
      console.error("Upload error", error);
      setUploadStatus("error");
      setUploadMessage("Upload failed. Please check your connection and try again.");
      setUploadQueue((prev) => prev.map((u) => (u.id === queueId ? { ...u, status: "failed" as const, message: "Upload failed" } : u)));
    }
  };

  const handleReceiptUpload = async (file: File) => {
    if (!file) return;
    const queueId = `rec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setUploadQueue((prev) =>
      [
        { id: queueId, kind: "receipt" as const, filename: file.name, startedAt: Date.now(), status: "uploading" as const },
        ...prev,
      ].slice(0, 5)
    );
    setUploadStatus("uploading");
    setUploadMessage("Uploading receipt…");
    try {
      const url = `${apiBase}/api/upload-receipt`;
      let data: any = null;

      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await tryFetchApi("/api/upload-receipt", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          console.error("Receipt upload failed", response.status, "at", url);
          setUploadStatus("error");
          setUploadMessage("Receipt upload failed. Please try again.");
          return;
        }
        data = await response.json();
      } catch (err) {
        console.error("Receipt upload error at", url, err);
        setUploadStatus("error");
        setUploadMessage("Receipt upload failed. Please try again.");
        setUploadQueue((prev) => prev.map((u) => (u.id === queueId ? { ...u, status: "failed" as const, message: "Network error" } : u)));
        return;
      }

      console.log("Receipt upload success:", data);
      if (data?.duplicate) {
        setUploadStatus("success");
        setUploadMessage("Already uploaded (duplicate) — no new record created.");
        setUploadQueue((prev) =>
        prev.map((u) => (u.id === queueId ? { ...u, status: "done" as const, message: "Duplicate detected" } : u))
      );
        return;
      }
      setUploadStatus("success");
      setUploadMessage("Receipt uploaded successfully.");
      if (data?.invoice && onInvoiceCreatedFromUpload) {
        onInvoiceCreatedFromUpload(data.invoice as Invoice);
      }
      setUploadQueue((prev) =>
        prev.map((u) =>
          u.id === queueId
            ? {
                ...u,
                status: "done" as const,
                message: "Uploaded",
                receiptId: data?.invoice?.id ?? null,
                driveLink: data?.invoice?.file_ref ?? null,
              }
            : u
        )
      );
    } catch (error) {
      console.error("Receipt upload error", error);
      setUploadStatus("error");
      setUploadMessage("Receipt upload failed. Please check your connection and try again.");
      setUploadQueue((prev) => prev.map((u) => (u.id === queueId ? { ...u, status: "failed" as const, message: "Upload failed" } : u)));
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleFileUpload(file);
    }
    event.target.value = "";
  };

  const handleReceiptChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleReceiptUpload(file);
    }
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      if (currentDocTab === "receipt") {
        void handleReceiptUpload(file);
      } else {
        void handleFileUpload(file);
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-cyan-600">Documents</p>
          <h1 className="text-3xl font-bold text-slate-900">Documents</h1>
          <p className="text-slate-500">Keep every invoice in one place. AI reads them for you and keeps cashflow current.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
            {(["invoice", "receipt"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setCurrentDocTab(tab)}
                className={`rounded-full px-3 py-1.5 transition ${
                  currentDocTab === tab ? "bg-slate-900 text-white shadow" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {tab === "invoice" ? "Invoices" : "Receipts"}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center rounded-full border border-cyan-100 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm">
            {dateRangeLabel}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-md space-y-4">
            <div
              className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-slate-50 p-6 text-center transition ${
                isDragging ? "border-cyan-400 bg-cyan-50 shadow-lg" : "border-cyan-200"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
                accept=".pdf,image/*"
              />
              <input
                ref={receiptFileInputRef}
                type="file"
                className="hidden"
                onChange={handleReceiptChange}
                accept="image/*"
              />
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-50 text-cyan-600 shadow-sm">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold text-slate-900">
                  {isDragging
                    ? "Drop to upload"
                    : currentDocTab === "invoice"
                    ? "Drop invoices here or click to upload"
                    : "Drop receipts here or click to upload"}
                </p>
                <p className="text-sm text-slate-500">
                  {currentDocTab === "invoice"
                    ? "PDF recommended for best extraction. Images are saved for manual review."
                    : "JPG/PNG/WEBP supported; stored for manual review."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-900 shadow"
                  style={{ backgroundColor: "var(--brand-accent-strong)" }}
                  onClick={currentDocTab === "invoice" ? handleFileSelect : handleReceiptFileSelect}
                  type="button"
                >
                  {currentDocTab === "invoice" ? "Upload invoice (PDF)" : "Upload receipt (photo)"}
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-[var(--brand-accent)]"
                  onClick={currentDocTab === "invoice" ? handleFileSelect : handleReceiptFileSelect}
                  type="button"
                >
                  Browse folder
                </button>
              </div>
              {uploadStatus !== "idle" && uploadMessage && (
                <p className="text-sm text-slate-600">{uploadMessage}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1">Upload</span>
              <span className="text-slate-400">→</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">AI reads</span>
              <span className="text-slate-400">→</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Appears in list</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 shadow-inner">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Recent uploads</span>
                <span>{currentDocTab === "invoice" ? "Invoices" : "Receipts"}</span>
              </div>
              <div className="mt-2 space-y-2">
                {uploadQueue.filter((u) => u.kind === currentDocTab).length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-6 text-center">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">•</div>
                    <p className="text-sm font-semibold text-slate-900">No uploads yet</p>
                    <p className="text-xs text-slate-500">
                      {currentDocTab === "invoice" ? "Upload a PDF invoice." : "Upload a receipt photo."}
                    </p>
                  </div>
                ) : (
                  uploadQueue
                    .filter((u) => u.kind === currentDocTab)
                    .slice(0, 5)
                    .map((u) => {
                      const statusClass =
                        u.status === "uploading"
                          ? "bg-cyan-50 text-cyan-700 border-cyan-100"
                          : u.status === "done"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                          : "bg-rose-50 text-rose-700 border-rose-100";
                      const statusLabel = u.status === "uploading" ? "Uploading" : u.status === "done" ? "Saved" : "Failed";
                      return (
                        <div
                          key={u.id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm"
                        >
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900">{u.filename}</span>
                            <span className="text-slate-500">{u.message || statusLabel}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}>
                              {statusLabel}
                            </span>
                            {u.driveLink && (
                              <a className="text-cyan-700 underline" href={u.driveLink} target="_blank" rel="noreferrer">
                                Open
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        </div>
        <div>
          <div className="h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-md space-y-4">
            {emailStatusData.loading && !emailStatusData.data ? (
              <div className="space-y-3">
                <div className="h-6 w-40 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
              </div>
            ) : (
              <>
                {(() => {
                  const statusData = emailStatusData.data || {};
                  const ingestState = statusData?.ingest_state || {};
                  const nextRetry = ingestState?.next_retry_at ? new Date(ingestState.next_retry_at) : null;
                  const inBackoff = nextRetry ? nextRetry.getTime() > Date.now() : false;
                  const enabled =
                    typeof statusData?.enabled !== "undefined" ? Boolean(statusData.enabled) : Boolean(emailConnected);
                  const variant = emailStatusData.error
                    ? "error"
                    : enabled
                    ? inBackoff
                      ? "backoff"
                      : "active"
                    : "offline";
                  const dotClass =
                    variant === "active"
                      ? "bg-emerald-500"
                      : variant === "backoff"
                      ? "bg-amber-500"
                      : "bg-rose-500";
                  const label =
                    variant === "active" ? "Active" : variant === "backoff" ? "Backoff" : variant === "offline" ? "Offline" : "Offline";
                  const lastRun = statusData?.last_run_at || ingestState?.updated_at || null;
                  const pollSeconds = typeof statusData?.poll_seconds === "number" ? statusData.poll_seconds : null;
                  const nextLabel = nextRetry
                    ? `Retry ${formatRelativeTime(nextRetry.toISOString())}`
                    : formatPollSeconds(pollSeconds);
                  const lastError = ingestState?.last_error || statusData?.last_error || null;
                  const sample = Array.isArray(statusData?.sample_messages) ? statusData.sample_messages.slice(-3).reverse() : [];
                  const attempts = ingestState?.attempts || 0;
                  const lastUid = ingestState?.last_uid || null;
                  const updatedAt = emailStatusData.lastUpdated
                    ? formatRelativeTime(new Date(emailStatusData.lastUpdated).toISOString())
                    : formatRelativeTime(ingestState?.updated_at || null);
                  return (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold text-slate-900">Email ingestion</p>
                          <p className="text-sm text-slate-500">Live state from the IonOS inbox.</p>
                        </div>
                        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm">
                          <span className={`h-2 w-2 rounded-full ${dotClass} shadow-[0_0_0_6px_rgba(0,0,0,0.04)]`} />
                          {label}
                        </span>
                      </div>
                      {emailStatusData.error && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          Last update failed: {emailStatusData.error}
                        </div>
                      )}
                      <div className="grid gap-3 text-sm md:grid-cols-2">
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                          <p className="text-xs uppercase text-slate-500">Mailbox</p>
                          <p className="text-sm font-semibold text-slate-900">{statusData?.mailbox || "Invoices"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                          <p className="text-xs uppercase text-slate-500">IMAP</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {statusData?.imap_host || "—"}:{statusData?.imap_port || "—"}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                          <p className="text-xs uppercase text-slate-500">Last run</p>
                          <p className="text-sm font-semibold text-slate-900">{formatRelativeTime(lastRun)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                          <p className="text-xs uppercase text-slate-500">{nextRetry ? "Next retry" : "Next check"}</p>
                          <p className="text-sm font-semibold text-slate-900">{nextLabel}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                          <p className="text-xs uppercase text-slate-500">Attempts</p>
                          <p className="text-sm font-semibold text-slate-900">{attempts > 0 ? attempts : "0"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                          <p className="text-xs uppercase text-slate-500">Last UID</p>
                          <p className="text-sm font-semibold text-slate-900">{lastUid ?? "—"}</p>
                        </div>
                      </div>
                      {lastError && (
                        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                          Latest issue: {lastError}
                        </div>
                      )}
                      <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-slate-800">Recently seen</p>
                          <span className="text-xs text-slate-500">Updated {updatedAt}</span>
                        </div>
                        {sample.length ? (
                          <div className="space-y-2">
                            {sample.map((msg: any, idx: number) => (
                              <div key={`${msg.message_id || idx}`} className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-xs shadow-sm">
                                <div className="flex flex-col">
                                  <span className="font-semibold text-slate-900 line-clamp-1">{msg.subject || "No subject"}</span>
                                  <span className="text-slate-500">
                                    {msg.from || msg.from_address || "Unknown sender"} ·{" "}
                                    {msg.date ? formatRelativeTime(msg.date) : "unknown"}
                                  </span>
                                </div>
                                <div className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                                  {msg.attachments?.length ? `${msg.attachments.length} attachments` : "No attachments"}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No recent messages sampled.</p>
                        )}
                      </div>
                      <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                        <div className="grid gap-2 md:grid-cols-3">
                          <div className="rounded-lg bg-white/80 px-3 py-2 shadow-inner">
                            <p className="text-[11px] uppercase text-slate-500">Unseen</p>
                            <p className="text-sm font-semibold text-slate-900">{statusData?.unseen_count ?? "—"}</p>
                          </div>
                          <div className="rounded-lg bg-white/80 px-3 py-2 shadow-inner">
                            <p className="text-[11px] uppercase text-slate-500">Processed 24h</p>
                            <p className="text-sm font-semibold text-slate-900">{statusData?.processed_count_24h ?? "—"}</p>
                          </div>
                          <div className="rounded-lg bg-white/80 px-3 py-2 shadow-inner">
                            <p className="text-[11px] uppercase text-slate-500">Next retry</p>
                            <p className="text-sm font-semibold text-slate-900">
                              {nextRetry ? formatRelativeTime(nextRetry.toISOString()) : "Scheduled"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-5 text-sm">
            <div className="md:col-span-1">
              <p className="text-xs uppercase text-slate-500">Date range</p>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                value={filters.dateRange}
                onChange={(e) => {
                  const next = e.target.value as DateRangeFilter;
                  setFilters((prev) => ({ ...prev, dateRange: next }));
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem(DOCUMENTS_RANGE_KEY, next);
                  }
                }}
              >
                <option value="last_30_days">Last 30 days</option>
                <option value="last_90_days">Last 90 days</option>
                <option value="next_14_days">Next 14 days</option>
                <option value="next_3_months">Next 3 months</option>
                <option value="all">All time</option>
              </select>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Status</p>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              >
                {["All", "Upcoming", "Overdue", "Paid", "Due soon"].map((opt) => (
                  <option key={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Supplier</p>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                value={filters.supplier}
                onChange={(e) => setFilters((prev) => ({ ...prev, supplier: e.target.value }))}
                placeholder="Search supplier"
              />
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Category</p>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                value={filters.category}
                onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
              >
                {["All", "Rent", "Utilities", "Marketing", "Staff", "Software", "Other"].map((opt) => (
                  <option key={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Source</p>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                value={filters.source}
                onChange={(e) => setFilters((prev) => ({ ...prev, source: e.target.value }))}
              >
                {["All", "Upload", "Email"].map((opt) => (
                  <option key={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/60">
            {currentDocTab === "receipt" ? (
              receiptsLoading && receiptRows.length === 0 ? (
                <div className="space-y-2 px-4 py-6">
                  {[0, 1, 2].map((idx) => (
                    <div key={idx} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <div className="h-10 w-10 animate-pulse rounded-full bg-slate-100" />
                      <div className="flex-1 space-y-1">
                        <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
                        <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                      </div>
                      <div className="h-6 w-16 animate-pulse rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
              ) : receiptRows.length === 0 ? (
                <div className="flex min-h-[160px] flex-col items-center justify-center px-4 py-6 text-center">
                  <p className="text-sm font-semibold text-slate-900">No receipts yet.</p>
                  <p className="text-xs text-slate-500">Upload a receipt photo to get started.</p>
                  {receiptsError ? <p className="mt-2 text-xs text-rose-600">{receiptsError}</p> : null}
                </div>
              ) : (
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {["Date", "Receipt", "Supplier", "Amount", "Status", "Category", "Source", "Actions"].map((col) => (
                        <th key={col} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receiptRows.map((doc) => {
                      const receiptStatus = (doc as any).status || "Captured";
                      const statusClass = statusStyles[receiptStatus as InvoiceStatus] || "bg-slate-100 text-slate-700 border-slate-200";
                      const receiptSource = normalizeSource(
                        (doc as any).source || (doc as any).owner_type || (doc as any).ownerType || "Upload",
                      );
                      const sourceClass = sourceStyles[receiptSource] || "bg-slate-100 text-slate-700 border-slate-200";
                      const receiptLabel =
                        (doc as any).receipt_number ||
                        (doc as any).receiptNumber ||
                        (doc as any).reference ||
                        (doc as any).original_filename ||
                        "Receipt";
                      const receiptDate =
                        (doc as any).issue_date ||
                        (doc as any).issueDate ||
                        (doc as any).receipt_date ||
                        (doc as any).receiptDate ||
                        (doc as any).created_at ||
                        (doc as any).createdAt;
                      return (
                        <tr key={doc.id} className="hover:bg-slate-50/70">
                          <td className="px-3 py-3 text-slate-600">{formatInvoiceDate(receiptDate)}</td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold bg-white border-slate-200 text-slate-700">
                              {receiptLabel}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-semibold text-slate-900">{(doc as any).supplier || "—"}</td>
                          <td className="px-3 py-3 font-semibold text-slate-900">{formatCurrency((doc as any).amount)}</td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass}`}
                            >
                              {receiptStatus}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-slate-600">{(doc as any).category || "Other"}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceClass}`}>
                              {receiptSource}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <button className="text-cyan-700 hover:text-cyan-800" onClick={() => setSelectedDocId(doc.id)}>
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : tableRows.length === 0 ? (
              <div className="flex min-h-[160px] flex-col items-center justify-center px-4 py-6 text-center">
                <p className="text-sm font-semibold text-slate-900">No invoices yet.</p>
                <p className="text-xs text-slate-500">Upload an invoice PDF or send it to the inbox.</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {["Date", "Type", "Supplier", "Invoice #", "Amount", "Due date", "Status", "Category", "Source", "Actions"].map((col) => (
                      <th key={col} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tableRows.map((doc) => {
                    const computedStatus = computeInvoiceStatus(doc);
                    const displayStatus = (doc.status as InvoiceStatus) || computedStatus;
                    const statusClass = statusStyles[displayStatus] || "bg-slate-100 text-slate-700 border-slate-200";
                    const docKind = getDocKind(doc);
                    const docType = docKind === "invoice" ? "Invoice" : docKind === "receipt" ? "Receipt" : "Document";
                    const displayInvoiceNumber = doc.invoiceNumber || (doc as any).invoice_number || "—";
                    return (
                      <tr key={doc.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-3 text-slate-600">{formatInvoiceDate(getIssueDate(doc))}</td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold bg-white border-slate-200 text-slate-700">
                            {docType}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-semibold text-slate-900">{doc.supplier}</td>
                        <td className="px-3 py-3 text-slate-600">{displayInvoiceNumber}</td>
                        <td className="px-3 py-3 font-semibold text-slate-900">{formatCurrency(doc.amount)}</td>
                        <td className="px-3 py-3 text-slate-600">{formatInvoiceDate(getDueDate(doc))}</td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass}`}
                          >
                            {displayStatus}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{doc.category}</td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceStyles[normalizeSource(doc.source)]}`}
                          >
                            {normalizeSource(doc.source)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <button className="text-cyan-700 hover:text-cyan-800" onClick={() => setSelectedDocId(doc.id)}>
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {selectedDoc && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30 p-2">
          <div className="h-full w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold text-slate-900">
                  {selectedDoc.supplier} · {selectedDoc.invoiceNumber}
                </p>
                <p className="text-sm text-slate-500">AI pulled the details for you. Review, adjust, and move on.</p>
                {selectedDoc && (selectedDoc as any).needs_review ? (
                  <span className="mt-2 inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                    Needs review
                  </span>
                ) : null}
              </div>
              <button className="text-slate-500 hover:text-slate-800" onClick={() => setSelectedDocId(null)}>
                Close
              </button>
              {selectedDoc && (
                <button
                  type="button"
                  className="text-sm text-sky-700 underline"
                  onClick={() => {
                    if (isEditing) {
                      setIsEditing(false);
                      setEditValues({
                        supplier: selectedDoc.supplier ?? "",
                        invoiceNumber: selectedDoc.invoiceNumber ?? (selectedDoc as any).invoice_number ?? "",
                        issue_date: selectedDoc.issue_date ?? "",
                        due_date: selectedDoc.due_date ?? "",
                        amount: selectedDoc.amount != null ? String(selectedDoc.amount) : "",
                        status: selectedDoc.status ?? "",
                        category: selectedDoc.category ?? "",
                        notes: (selectedDoc as any).notes ?? notesValue ?? "",
                      });
                      setSaveMessage(null);
                      setSaveError(null);
                    } else {
                      setSaveMessage(null);
                      setSaveError(null);
                      setIsEditing(true);
                    }
                  }}
                >
                  {isEditing ? "Cancel" : "Edit"}
                </button>
              )}
            </div>

            <div className="mt-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="text-xs text-slate-500">Supplier</p>
                  {isEditing ? (
                    <input
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={editValues.supplier}
                      onChange={(e) => setEditValues((v) => ({ ...v, supplier: e.target.value }))}
                    />
                  ) : (
                    <p className="font-semibold text-slate-900">{selectedDoc.supplier}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500">Invoice number</p>
                  {isEditing ? (
                    <input
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={editValues.invoiceNumber}
                      onChange={(e) => setEditValues((v) => ({ ...v, invoiceNumber: e.target.value }))}
                    />
                  ) : (
                    <p className="font-semibold text-slate-900">
                      {selectedDoc.invoiceNumber || (selectedDoc as any).invoice_number || "—"}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Status</p>
                  {(() => {
                    const computedStatus = computeInvoiceStatus(selectedDoc);
                    return (
                      <>
                        {isEditing ? (
                          <select
                            className="rounded-md border px-2 py-1 text-xs"
                            value={editValues.status}
                            onChange={(e) => setEditValues((v) => ({ ...v, status: e.target.value }))}
                          >
                            {["Upcoming", "Due soon", "Overdue", "Paid", "Needs info", "Captured"].map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[computedStatus]}`}
                          >
                            {computedStatus}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <p className="text-xs text-slate-500">Source</p>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${sourceStyles[normalizeSource(selectedDoc.source)]}`}
                  >
                    {normalizeSource(selectedDoc.source)}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Total</p>
                  {isEditing ? (
                    <input
                      className="w-full rounded-md border px-3 py-2 text-sm text-right"
                      value={editValues.amount}
                      onChange={(e) => setEditValues((v) => ({ ...v, amount: e.target.value }))}
                    />
                  ) : (
                    <p className="font-semibold text-slate-900">{formatCurrency(selectedDoc.amount)}</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Financial details</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-500">Issue date</p>
                    {isEditing ? (
                      <input
                        className="w-full rounded-md border px-3 py-2 text-sm"
                        type="date"
                        value={editValues.issue_date}
                        onChange={(e) => setEditValues((v) => ({ ...v, issue_date: e.target.value }))}
                      />
                    ) : (
                      <p className="font-medium text-slate-900">{formatInvoiceDate(getIssueDate(selectedDoc))}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Due date</p>
                    {isEditing ? (
                      <input
                        className="w-full rounded-md border px-3 py-2 text-sm"
                        type="date"
                        value={editValues.due_date}
                        onChange={(e) => setEditValues((v) => ({ ...v, due_date: e.target.value }))}
                      />
                    ) : (
                      <p className="font-medium text-slate-900">{formatInvoiceDate(getDueDate(selectedDoc))}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Subtotal</p>
                    <p className="font-medium text-slate-900">{formatCurrency((selectedDoc as any).subtotal)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Tax</p>
                    <p className="font-medium text-slate-900">{formatCurrency((selectedDoc as any).tax)}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Categorisation</p>
                <div className="mt-3 space-y-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">Category</span>
                    {isEditing ? (
                      <select
                        className="rounded-lg border border-slate-200 px-3 py-2"
                        value={editValues.category}
                        onChange={(e) => setEditValues((v) => ({ ...v, category: e.target.value }))}
                      >
                        {["Rent", "Utilities", "Marketing", "Staff", "Software", "Other", "Uncategorised"].map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="font-medium text-slate-900">{selectedDoc.category}</p>
                    )}
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">Notes</span>
                    {isEditing ? (
                      <textarea
                        className="rounded-lg border border-slate-200 px-3 py-2"
                        rows={3}
                        value={editValues.notes}
                        onChange={(e) => setEditValues((v) => ({ ...v, notes: e.target.value }))}
                        placeholder="Add internal context or routing notes here."
                      />
                    ) : (
                      <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        {notesSavedValue || "—"}
                      </p>
                    )}
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI extraction</p>
                <div className="mt-3 space-y-2 text-slate-700">
                  <div className="flex items-center justify-between rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2">
                    <span>Amount due</span>
                    <span className="text-sm font-semibold">{formatCurrency(selectedDoc.amount)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2">
                    <span>PO / invoice</span>
                    <span className="text-sm font-semibold">{selectedDoc.invoiceNumber}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2">
                    <span>Confidence</span>
                    <span className="text-sm font-semibold">92%</span>
                  </div>
                </div>
              </div>

              {isEditing && selectedDoc && (
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white"
                    onClick={async () => {
                      try {
                        setSaveError(null);
                        setSaveMessage(null);
                        const parsedAmount = editValues.amount === "" ? null : Number(editValues.amount);
                        const body = {
                          supplier: editValues.supplier || "",
                          invoice_number: editValues.invoiceNumber || "",
                          issue_date: editValues.issue_date || null,
                          due_date: editValues.due_date || null,
                          amount: Number.isFinite(parsedAmount) ? parsedAmount : null,
                          status: editValues.status || "",
                          category: editValues.category || "",
                          notes: editValues.notes ?? "",
                        };
                        const res = await tryFetchApi(`/api/invoices/${selectedDoc.id}`, {
                          method: "PATCH",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify(body),
                        });
                        const data = (await res.json()) as Invoice;
                        const updated: Invoice = {
                          ...selectedDoc,
                          ...data,
                          id: data?.id != null ? String((data as any).id) : selectedDoc.id,
                          invoiceNumber:
                            (data as any).invoiceNumber ??
                            (data as any).invoice_number ??
                            selectedDoc.invoiceNumber ??
                            (selectedDoc as any).invoice_number,
                        } as Invoice;
                        onInvoiceUpdated?.(updated);
                        setNotesValue((data as any).notes ?? "");
                        setNotesSavedValue((data as any).notes ?? "");
                        if (typeof window !== "undefined" && selectedDoc.id) {
                          window.localStorage.setItem(
                            `spa_invoice_notes_${selectedDoc.id}`,
                            (data as any).notes ?? "",
                          );
                        }
                        setSaveMessage("Saved");
                        setIsEditing(false);
                      } catch (err) {
                        console.error("Failed to save invoice", err);
                        setSaveError("Failed to save changes. Please try again.");
                      }
                    }}
                  >
                    Save changes
                  </button>
                  {saveError && <p className="text-sm text-red-600">{saveError}</p>}
                  {saveMessage && <p className="text-sm text-emerald-700">{saveMessage}</p>}
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI automations &amp; optimisation</p>
                <div className="mt-3 space-y-3 text-sm text-slate-700">
                  {hasSupplierHistory && (
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 shadow-[0_6px_18px_rgba(16,185,129,0.15)]">
                      <p className="font-semibold text-emerald-800">Auto-approval suggestion</p>
                      {shouldSuggestAutoApprove ? (
                        <p className="mt-1 text-emerald-900">
                          Invoices from {selectedDoc.supplier} are regular and within a typical range. Consider
                          auto-approving {selectedDoc.category || "these invoices"} up to about {formatCurrency(autoApproveThreshold)}.
                        </p>
                      ) : (
                        <p className="mt-1 text-emerald-900">
                          As The Spa by Kaajal processes more invoices from {selectedDoc.supplier}, it can learn a safe auto-approval
                          limit for you.
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
                          disabled={autoApprovalStatus === "loading" || aiLoading}
                          onClick={async () => {
                            setAutoApprovalStatus("loading");
                            setAiMessage(null);
                            if (!ensureAiReady()) {
                              setAutoApprovalStatus("error");
                              return;
                            }
                            const actions = aiActions || (await fetchAiActions());
                            if (!actions) {
                              setAutoApprovalStatus("error");
                              return;
                            }
                            if (!actions.autoApproval || !selectedDoc.supplier) {
                              setAiMessage("No auto-approval suggestion available yet.");
                              setAutoApprovalStatus("error");
                              return;
                            }
                            const limit = Number(actions.autoApproval.suggestedMonthlyLimit);
                            if (!Number.isFinite(limit) || limit <= 0) {
                              setAiMessage("Suggested limit not available.");
                              setAutoApprovalStatus("error");
                              return;
                            }
                            try {
                              const res = await fetch(apiUrl("/api/auto-approval-rules"), {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                  ...(appKey ? { "X-APP-KEY": appKey } : {}),
                                },
                                body: JSON.stringify({ supplier: selectedDoc.supplier, monthly_limit: limit }),
                              });
                              if (!res.ok) {
                                setAiMessage(
                                  res.status === 401
                                    ? "App key required to create auto-approval rule."
                                    : "Could not save auto-approval rule.",
                                );
                                setAutoApprovalStatus("error");
                                return;
                              }
                              setAiMessage("Auto-approval rule created.");
                              setAutoApprovalStatus("success");
                            } catch (err) {
                              console.error("Auto-approval save failed", err);
                              setAiMessage("Could not save auto-approval rule.");
                              setAutoApprovalStatus("error");
                            }
                          }}
                        >
                          {autoApprovalStatus === "loading" ? "Creating…" : "Create auto-approval rule"}
                        </button>
                        <button
                          className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                          onClick={() => console.log("Auto-approval suggestion dismissed for", selectedDoc.supplier)}
                        >
                          Dismiss
                        </button>
                        {autoApprovalStatus !== "idle" && (
                          <p className="text-xs text-slate-700">
                            {autoApprovalStatus === "loading"
                              ? "Creating auto-approval rule…"
                              : autoApprovalStatus === "success"
                                ? "Auto-approval rule created."
                                : aiMessage || "Could not create auto-approval rule."}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2 shadow-[0_6px_18px_rgba(8,145,178,0.15)]">
                    {negotiationInsight.shouldSuggest ? (
                      <>
                        <p className="font-semibold text-cyan-800">Cost optimisation opportunity</p>
                        <p className="mt-1 text-cyan-900">
                          Your average spend with {selectedDoc.supplier} is up about{" "}
                          {Math.round(negotiationInsight.increasePct)}% compared with earlier invoices. It may be worth
                          reviewing your tariff or plan.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-cyan-800">Supplier spend insight</p>
                        <p className="mt-1 text-cyan-900">
                          Spend with {selectedDoc.supplier} has been stable over recent months.
                        </p>
                      </>
                    )}
                    <button
                      className="mt-2 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-cyan-700 disabled:opacity-60"
                      disabled={emailDraftStatus === "loading" || aiLoading}
                      onClick={async () => {
                        setAiMessage(null);
                        setEmailDraftStatus("loading");
                        setEmailDraft(null);
                        if (!ensureAiReady()) {
                          setEmailDraftStatus("error");
                          return;
                        }
                        const actions = aiActions || (await fetchAiActions());
                        if (!actions) {
                          setEmailDraftStatus("error");
                          return;
                        }
                        const supplier = selectedDoc.supplier || "your supplier";
                        const amount = formatAmountSafe(selectedDoc.amount);
                        const due = formatInvoiceDate(getDueDate(selectedDoc));
                        const invoiceNumber = selectedDoc.invoiceNumber || (selectedDoc as any).invoice_number || "the invoice";
                        const subject =
                          actions?.supplierEmail?.subject ||
                          `Invoice follow-up regarding ${invoiceNumber} — ${supplier}`;
                        const body =
                          actions?.supplierEmail?.body ||
                          [
                            `Hello ${supplier},`,
                            "",
                            `I hope you are well. We are reviewing invoice ${invoiceNumber} dated ${formatInvoiceDate(getIssueDate(selectedDoc))} for ${amount} (due ${due || "soon"}).`,
                            "Please confirm the payment details and let us know if any adjustments are required to the amount, due date, or remittance instructions.",
                            "",
                            "Thank you for your help.",
                            "The Spa by Kaajal finance team",
                          ].join("\n");
                        setEmailDraft({ subject, body });
                        setEmailDraftStatus("success");
                      }}
                    >
                      {emailDraftStatus === "loading" ? "Creating…" : "Create email draft"}
                    </button>
                    {emailDraftStatus === "error" && (
                      <p className="mt-1 text-xs text-rose-600">Unable to generate email draft right now.</p>
                    )}
                    {emailDraft && (
                      <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-slate-900">Email draft</p>
                          <button
                            className="rounded border border-slate-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-white"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(`Subject: ${emailDraft.subject}\n\n${emailDraft.body}`);
                                setEmailDraftStatus("success");
                                setAiMessage("Email draft copied to clipboard.");
                              } catch (err) {
                                console.error("Clipboard copy failed", err);
                                setEmailDraftStatus("error");
                                setAiMessage("Unable to copy draft to clipboard.");
                              }
                            }}
                          >
                            Copy draft
                          </button>
                        </div>
                        <div>
                          <p className="text-xs uppercase text-slate-500">Subject</p>
                          <p className="font-semibold text-slate-900">{emailDraft.subject}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase text-slate-500">Body</p>
                          <pre className="whitespace-pre-wrap text-slate-800">{emailDraft.body}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {aiMessage && <p className="mt-2 text-xs text-slate-700">{aiMessage}</p>}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Original document</p>
                <p className="mt-1 text-xs text-slate-600">
                  {fileStatus ?? (hasOriginalFile ? "File: attached" : "File: not attached")}
                </p>
                <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <FileText className="h-4 w-4 text-cyan-600" />
                    <span>View or download original file</span>
                  </div>
                  <button
                    className="rounded-lg border border-cyan-200 bg-white px-3 py-1 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
                    disabled={!hasOriginalFile}
                    onClick={() => handleDownloadFile(primaryFileId, primaryFileRef)}
                    title={!hasOriginalFile ? "No file attached" : undefined}
                  >
                    {hasOriginalFile ? "Open" : "No file attached"}
                  </button>
                </div>
                {fileMessage && <p className="mt-2 text-sm text-slate-600">{fileMessage}</p>}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-600"
                  onClick={() => onMarkPaid(selectedDoc.id)}
                >
                  Mark as paid
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  onClick={() => {
                    if (onArchiveInvoice) {
                      onArchiveInvoice(selectedDoc.id);
                    } else {
                      onArchive(selectedDoc.id);
                    }
                    setSelectedDocId(null);
                  }}
                >
                  Archive
                </button>
                <button className="text-slate-700 hover:text-slate-900" onClick={() => setSelectedDocId(null)}>
                  Close
                </button>
                {selectedDoc.status === "Paid" && (
                  <span className="text-sm font-semibold text-emerald-600">Marked as paid.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

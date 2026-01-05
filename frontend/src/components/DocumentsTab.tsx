import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, UploadCloud, FileText } from "lucide-react";
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
  const [emailConnected, setEmailConnected] = useState(true);
  const [inboxEmail] = useState("invoices@thespabykaajal.com");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
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
  const [inboxStatus, setInboxStatus] = useState<string | null>(null);
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
  const dateRangeLabel = useMemo(() => formatRangeLabel(filters.dateRange, now), [filters.dateRange, now]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const receiptFileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredDocuments = useMemo(
    () =>
      invoices
        .filter((doc) => isInvoiceInDateRange(doc, filters.dateRange, new Date()))
        .filter((doc) => {
          const statusMatch = filters.status === "All" || doc.status === filters.status;
          const categoryMatch = filters.category === "All" || doc.category === filters.category;
          const sourceMatch = filters.source === "All" || doc.source === filters.source;
          const supplierMatch =
            filters.supplier.trim().length === 0 ||
            doc.supplier.toLowerCase().includes(filters.supplier.trim().toLowerCase());
          return statusMatch && categoryMatch && sourceMatch && supplierMatch;
        }),
    [invoices, filters],
  );

  const selectedDoc = useMemo(
    () => invoices.find((doc) => doc.id === selectedDocId) ?? null,
    [invoices, selectedDocId],
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
          const res = await tryFetchApi(`/api/invoices/${selectedDoc.id}/files`, {
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
    const loadAiStatus = async () => {
      try {
        const res = await fetch(apiUrl("/api/ai/status"), {
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
        setFileMessage("Google Drive files coming soon.");
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
      const res = await fetch(apiUrl(targetPath), {
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
      const res = await fetch(apiUrl(`/api/ai/invoices/${selectedDoc.id}/actions`), {
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
    const mime = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    const isPdf = mime === "application/pdf" || mime.includes("pdf") || name.endsWith(".pdf");
    const isImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name);
    if (!isPdf && !isImage) {
      setUploadStatus("error");
      setUploadMessage("Unsupported file type. Please upload a PDF or image invoice.");
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
        const headers: Record<string, string> = {};
        if (typeof appKey === "string") {
          headers["X-APP-KEY"] = appKey;
        }
        const response = await fetch(url, {
          method: "POST",
          body: formData,
          headers,
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
        return;
      }

      console.log("Upload success:", data);
      if (data?.duplicate) {
        setUploadStatus("success");
        setUploadMessage("Already uploaded (duplicate) — no new record created.");
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
    } catch (error) {
      console.error("Upload error", error);
      setUploadStatus("error");
      setUploadMessage("Upload failed. Please check your connection and try again.");
    }
  };

  const handleReceiptUpload = async (file: File) => {
    if (!file) return;
    setUploadStatus("uploading");
    setUploadMessage("Uploading receipt…");
    try {
      const url = `${apiBase}/api/upload-receipt`;
      let data: any = null;

      try {
        const formData = new FormData();
        formData.append("file", file);
        const headers: Record<string, string> = {};
        if (typeof appKey === "string") {
          headers["X-APP-KEY"] = appKey;
        }
        const response = await fetch(url, {
          method: "POST",
          body: formData,
          headers,
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
        return;
      }

      console.log("Receipt upload success:", data);
      if (data?.duplicate) {
        setUploadStatus("success");
        setUploadMessage("Already uploaded (duplicate) — no new record created.");
        return;
      }
      setUploadStatus("success");
      setUploadMessage("Receipt uploaded successfully.");
      if (data?.invoice && onInvoiceCreatedFromUpload) {
        onInvoiceCreatedFromUpload(data.invoice as Invoice);
      }
    } catch (error) {
      console.error("Receipt upload error", error);
      setUploadStatus("error");
      setUploadMessage("Receipt upload failed. Please check your connection and try again.");
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
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void handleFileUpload(file);
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
        <span className="inline-flex items-center rounded-full border border-cyan-100 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm">
          {dateRangeLabel}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div
            className="flex h-full flex-col rounded-2xl border border-dashed border-cyan-200 bg-slate-50/80 p-6 shadow-sm"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
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
                <p className="text-lg font-semibold text-slate-900">Drop invoices here or click to upload</p>
                <p className="text-sm text-slate-500">
                  Upload PDF invoices or images (JPG, PNG, WEBP). Images are saved for manual review; PDFs keep the current AI extraction.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-900 shadow"
                  style={{ backgroundColor: "var(--brand-accent-strong)" }}
                  onClick={handleFileSelect}
                  type="button"
                >
                  Click to upload
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-[var(--brand-accent)]"
                  onClick={handleFileSelect}
                  type="button"
                >
                  Browse folder
                </button>
                <button
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-[var(--brand-accent)]"
                  onClick={handleReceiptFileSelect}
                  type="button"
                >
                  Upload receipt
                </button>
              </div>
              {uploadStatus !== "idle" && uploadMessage && (
                <p className="text-sm text-slate-600">{uploadMessage}</p>
              )}
            </div>
          </div>
        </div>
        <div>
          <div className="h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-md space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-slate-900">Invoice email inbox</p>
                <p className="text-sm text-slate-500">Keep invoices flowing from your inbox automatically.</p>
              </div>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  emailConnected ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"
                }`}
              >
                <span className="mr-1 h-2 w-2 rounded-full bg-current opacity-80" />
                {emailConnected ? "Connected" : "Not connected"}
              </span>
            </div>

            <label className="space-y-1 text-sm">
              <span className="text-slate-700">Inbox email</span>
              <input
                className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                value={inboxEmail}
                readOnly
                placeholder="invoices@thespabykaajal.com"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-[var(--brand-accent)]"
                onClick={() => {
                  setEmailConnected((prev) => {
                    const next = !prev;
                    setInboxStatus(next ? "Inbox connected" : "Inbox disconnected");
                    return next;
                  });
                }}
                type="button"
              >
                {emailConnected ? "Disconnect inbox" : "Reconnect inbox"}
              </button>
            </div>
            {inboxStatus && <p className="text-xs text-slate-600">{inboxStatus}</p>}

            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-slate-600" />
                <span className="font-medium text-slate-800">Email capture status</span>
              </div>
              <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Active
              </span>
            </div>
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

          <div className="overflow-x-auto rounded-xl border border-slate-200">
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
                {filteredDocuments.map((doc) => {
                  const computedStatus = computeInvoiceStatus(doc);
                  const displayStatus = (doc.status as InvoiceStatus) || computedStatus;
                  const statusClass = statusStyles[displayStatus] || "bg-slate-100 text-slate-700 border-slate-200";
                  const docType = (doc as any).doc_type || (doc as any).docType || "Invoice";
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
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceStyles[doc.source]}`}>
                          {doc.source}
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
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${sourceStyles[selectedDoc.source]}`}>
                    {selectedDoc.source}
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

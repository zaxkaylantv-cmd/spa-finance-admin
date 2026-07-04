import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardTab from "./components/DashboardTab";
import DocumentsTab from "./components/DocumentsTab";
import CashflowTab from "./components/CashflowTab";
import SettingsTab from "./components/SettingsTab";
import TipsTab from "./components/TipsTab";
import type { Invoice, InvoiceStatus } from "./data/mockInvoices";
import { mockInvoices } from "./data/mockInvoices";
import { tryFetchApi } from "./utils/api";
import { tenantConfig } from "./config/tenant";
import { supabase } from "./utils/supabaseClient";

const isArchived = (inv: any) => inv?.archived === 1 || inv?.archived === true || inv?.archived === "1";

type TabKey = "dashboard" | "documents" | "cashflow" | "tips" | "settings";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [invoices, setInvoices] = useState<Invoice[]>(() => mockInvoices);
  const [loadWarning, setLoadWarning] = useState(false);
  const [showArchivedDocuments, setShowArchivedDocuments] = useState(false);
  const [appKey, setAppKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("appKey") || "";
  });
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionPresent, setSessionPresent] = useState<boolean>(false);
  const company = tenantConfig.tenantName;

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = `${tenantConfig.tenantName} — ${tenantConfig.productName}`;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setSessionEmail(session?.user?.email ?? null);
      setSessionPresent(Boolean(session));
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSessionEmail(newSession?.user?.email ?? null);
      setSessionPresent(Boolean(newSession));
    });
    void initAuth();
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    try {
      await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    } catch (err) {
      console.error("Google sign-in failed", err);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setSessionEmail(null);
      setSessionPresent(false);
    } catch (err) {
      console.error("Sign-out failed", err);
    }
  };

  const loadInvoices = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      try {
        const res = await tryFetchApi(showArchivedDocuments ? "/api/invoices?includeArchived=1" : "/api/invoices");
        const data = (await res.json()) as { invoices?: Invoice[] };
        if (isCancelled()) return;
        if (Array.isArray(data.invoices)) {
          const normalizedInvoices = data.invoices.map((inv: any) => ({
            ...inv,
            id: String(inv.id),
            archived: inv.archived,
            status: isArchived(inv) ? ("Archived" as InvoiceStatus) : inv.status,
          }));
          let receipts: any[] = [];
          try {
            const receiptsRes = await tryFetchApi(
              showArchivedDocuments ? "/api/receipts?includeArchived=1" : "/api/receipts",
            );
            const receiptsData = (await receiptsRes.json()) as { receipts?: any[] };
            if (Array.isArray(receiptsData.receipts)) {
              receipts = receiptsData.receipts.map((rec: any) => ({
                ...rec,
                id: String(rec.id),
                archived: rec.archived,
                doc_type: rec.doc_type || rec.docType || "receipt",
                status: isArchived(rec) ? ("Archived" as InvoiceStatus) : rec.status,
              }));
            }
          } catch (err) {
            console.warn("Receipts fetch failed; continuing with invoices only", err);
          }

          const combined = [...normalizedInvoices, ...receipts];
          combined.sort((a, b) => {
            const aCreated = (a as any).created_at || (a as any).createdAt || null;
            const bCreated = (b as any).created_at || (b as any).createdAt || null;
            if (aCreated && bCreated && aCreated !== bCreated) {
              return aCreated > bCreated ? -1 : 1;
            }
            const aId = Number(a.id);
            const bId = Number(b.id);
            if (!Number.isNaN(aId) && !Number.isNaN(bId) && aId !== bId) {
              return bId - aId;
            }
            return 0;
          });
          setLoadWarning(false);
          setInvoices(combined as Invoice[]);
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("Falling back to mockInvoices; backend not reachable", err);
          if (!isCancelled()) setInvoices(mockInvoices);
        } else {
          console.warn("Live invoices not reachable; showing warning banner", err);
          if (!isCancelled()) {
            setLoadWarning(true);
            setInvoices([]);
          }
        }
      }
    },
    [showArchivedDocuments],
  );

  useEffect(() => {
    let cancelled = false;
    if (sessionPresent) {
      void loadInvoices(() => cancelled);
    }
    return () => {
      cancelled = true;
    };
  }, [loadInvoices, sessionPresent]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("appKey", appKey);
  }, [appKey]);

  const activeInvoices = useMemo(
    () => invoices.filter((inv) => !isArchived(inv) && inv.status !== "Archived"),
    [invoices],
  );

  const markAsPaid = async (id: string): Promise<boolean> => {
    try {
      const res = await tryFetchApi(`/api/invoices/${id}/mark-paid`, { method: "POST" });
      const data = await res.json();
      if (!data?.success || !data?.invoice?.id) {
        throw new Error("Mark paid did not return an updated invoice");
      }
      await loadInvoices();
      return true;
    } catch (err) {
      console.warn("Mark paid failed; invoice lists unchanged", err);
      return false;
    }
  };

  const archiveInvoice = async (id: string) => {
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === id ? { ...inv, archived: 1, status: "Archived" as InvoiceStatus } : inv,
      ),
    );
    try {
      const res = await tryFetchApi(`/api/invoices/${id}/archive`, { method: "POST" });
      const data = await res.json();
      if (data?.invoice) {
        const normalized = {
          ...data.invoice,
          id: String(data.invoice.id),
          archived: data.invoice.archived,
          status: isArchived(data.invoice) ? ("Archived" as InvoiceStatus) : data.invoice.status,
        };
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === id ? { ...inv, ...normalized } : inv)),
        );
      }
    } catch (err) {
      console.warn("Archive failed; keeping local change", err);
    }
  };

  const handleInvoiceCreatedFromUpload = (newInvoice: Invoice) => {
    setInvoices((prev) => [...prev, newInvoice]);
  };

  const handleInvoiceUpdated = (updated: Invoice) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? { ...inv, ...updated } : inv)));
  };

  const handleArchiveInvoice = async (id: number | string) => {
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    try {
      await tryFetchApi(`/api/invoices/${id}/archive`, { method: "POST" });
    } catch (err) {
      console.warn("Archive request failed; invoice already removed locally", err);
    }
  };

  const handleUnarchiveInvoice = async (id: number | string) => {
    try {
      await tryFetchApi(`/api/invoices/${id}/unarchive`, { method: "POST" });
      await loadInvoices();
    } catch (err) {
      console.warn("Unarchive request failed; invoice lists unchanged", err);
    }
  };

  const handleMarkAsReceipt = async (id: number | string) => {
    try {
      await tryFetchApi(`/api/invoices/${id}/mark-as-receipt`, { method: "POST" });
      await loadInvoices();
    } catch (err) {
      console.warn("Mark-as-receipt request failed; document lists unchanged", err);
    }
  };

  const handleMarkAsInvoice = async (id: number | string) => {
    try {
      await tryFetchApi(`/api/invoices/${id}/mark-as-invoice`, { method: "POST" });
      await loadInvoices();
    } catch (err) {
      console.warn("Mark-as-invoice request failed; document lists unchanged", err);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "documents", label: "Invoices & Receipts" },
    { key: "cashflow", label: "Cash Flow" },
    { key: "tips", label: "Tips & Gratuities" },
    { key: "settings", label: "Settings" },
  ];

  if (!sessionPresent) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-4"
        style={{ background: "linear-gradient(180deg, #F7F9FA 0%, #EEF3F0 100%)" }}
      >
        <div className="relative w-full max-w-md space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/60">
          <div className="absolute inset-x-0 top-0 h-[4px] rounded-t-2xl" style={{ backgroundColor: "#8FAE9A" }} />
          <div className="space-y-1 text-center pt-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--spa-muted)]">{tenantConfig.tenantName}</p>
            <p className="text-lg font-semibold text-slate-900">{tenantConfig.productName}</p>
            <p className="text-sm text-slate-500">Intelligent finance admin for The Spa by Kaajal</p>
            <p className="text-sm text-slate-500">Sign in with your Google account to continue.</p>
          </div>
          <button
            className="w-full rounded-md bg-[#8FAE9A] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6F8F7B] disabled:opacity-70"
            onClick={handleSignIn}
            type="button"
          >
            Sign in with Google
          </button>
          <div className="flex justify-end text-xs font-semibold text-[#6E88A6] hover:text-[#506884]">
            Powered by KALYAN AI
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-4">
          <div className="hidden items-center gap-4 sm:flex">
            {sessionEmail ? (
              <>
                <span className="text-sm text-slate-700">{sessionEmail}</span>
                <button
                  className="rounded-md border border-transparent bg-[#8FAE9A] px-3 py-1 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6F8F7B]"
                  onClick={handleSignOut}
                  type="button"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                className="rounded-md border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
                onClick={handleSignIn}
                type="button"
              >
                Sign in with Google
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-sm">
              Powered by KALYAN AI
            </span>
          </div>
        </div>
        <div className="border-t border-slate-200 bg-slate-50/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-700">
              <span className="h-2 w-2 rounded-full bg-[color:var(--spa-accent)]" />
              {company}
            </div>
            <div className="hidden h-4 w-px bg-slate-200 sm:block" />
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex itemscenter gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${
                    activeTab === tab.key
                      ? "bg-slate-600 text-white shadow-sm"
                      : "bg-white text-slate-600 border border-transparent hover:border-[color:var(--spa-border)] hover:bg-[color:var(--spa-wash)] hover:text-slate-900"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${activeTab === tab.key ? "bg-white" : "bg-[color:var(--spa-accent-2)]"}`} />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 space-y-8">
        {loadWarning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-sm">
            Unable to load live invoices. Please refresh.
          </div>
        )}
        {activeTab === "dashboard" && <DashboardTab invoices={activeInvoices} />}
        {activeTab === "documents" && (
          <DocumentsTab
            invoices={showArchivedDocuments ? invoices : activeInvoices}
            onMarkPaid={markAsPaid}
            onArchive={archiveInvoice}
            onInvoiceCreatedFromUpload={handleInvoiceCreatedFromUpload}
            onInvoiceUpdated={handleInvoiceUpdated}
            onArchiveInvoice={handleArchiveInvoice}
            showArchivedDocuments={showArchivedDocuments}
            onToggleShowArchived={setShowArchivedDocuments}
            onUnarchiveInvoice={handleUnarchiveInvoice}
            onMarkAsReceipt={handleMarkAsReceipt}
            onMarkAsInvoice={handleMarkAsInvoice}
            appKey={appKey}
          />
        )}
        {activeTab === "cashflow" && <CashflowTab invoices={activeInvoices} />}
        {activeTab === "tips" && <TipsTab appKey={appKey} />}
        {activeTab === "settings" && <SettingsTab appKey={appKey} onAppKeyChange={setAppKey} />}
      </main>
    </div>
  );
}

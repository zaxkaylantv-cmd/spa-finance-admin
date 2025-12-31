import { useEffect, useMemo, useState } from "react";
import DashboardTab from "./components/DashboardTab";
import DocumentsTab from "./components/DocumentsTab";
import CashflowTab from "./components/CashflowTab";
import SettingsTab from "./components/SettingsTab";
import TipsTab from "./components/TipsTab";
import type { Invoice, InvoiceStatus } from "./data/mockInvoices";
import { mockInvoices } from "./data/mockInvoices";
import { tryFetchApi } from "./utils/api";
import { tenantConfig } from "./config/tenant";

type TabKey = "dashboard" | "documents" | "cashflow" | "tips" | "settings";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [invoices, setInvoices] = useState<Invoice[]>(() => mockInvoices);
  const [appKey, setAppKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("appKey") || "";
  });
  const company = tenantConfig.tenantName;

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = `${tenantConfig.tenantName} — ${tenantConfig.productName}`;
    }
  }, []);

  useEffect(() => {
    const loadInvoices = async () => {
      try {
        const res = await tryFetchApi("/api/invoices");
        const data = (await res.json()) as { invoices?: Invoice[] };
        if (Array.isArray(data.invoices)) {
          const normalized = data.invoices.map((inv: any) => ({
            ...inv,
            id: String(inv.id),
          }));
          setInvoices(normalized as Invoice[]);
        }
      } catch (err) {
        console.warn("Falling back to mockInvoices; backend not reachable", err);
      }
    };
    loadInvoices();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("appKey", appKey);
  }, [appKey]);

  const activeInvoices = useMemo(() => invoices.filter((inv) => inv.status !== "Archived"), [invoices]);

  const markAsPaid = async (id: string) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? { ...inv, status: "Paid" as InvoiceStatus } : inv)));
    try {
      const res = await tryFetchApi(`/api/invoices/${id}/mark-paid`, { method: "POST" });
      const updated = await res.json();
      if (updated?.id) {
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === id ? { ...inv, ...updated, id: String(updated.id) } : inv)),
        );
      }
    } catch (err) {
      console.warn("Mark paid failed; keeping local change", err);
    }
  };

  const archiveInvoice = async (id: string) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? { ...inv, status: "Archived" as InvoiceStatus } : inv)));
    try {
      const res = await tryFetchApi(`/api/invoices/${id}/archive`, { method: "POST" });
      const data = await res.json();
      if (data?.invoice) {
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === id ? { ...inv, ...data.invoice, id: String(data.invoice.id) } : inv)),
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

  const tabs: { key: TabKey; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "documents", label: "Invoices & Receipts" },
    { key: "cashflow", label: "Cash Flow" },
    { key: "tips", label: "Tips & Gratuities" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--spa-muted)]">{tenantConfig.tenantName}</p>
              <p className="text-lg font-semibold text-slate-900">{tenantConfig.productName}</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--spa-border)] bg-gradient-to-br from-[color:var(--spa-wash)] via-[color:var(--spa-accent-2)] to-[color:var(--spa-surface)] text-slate-800">
              DC
            </div>
          </div>
        </div>
        <div className="border-t border-slate-200 bg-slate-50/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="h-2 w-2 rounded-full bg-[color:var(--spa-accent)]" />
              {company}
            </div>
            <div className="hidden h-4 w-px bg-slate-200 sm:block" />
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${
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
        {activeTab === "dashboard" && <DashboardTab invoices={activeInvoices} />}
        {activeTab === "documents" && (
          <DocumentsTab
            invoices={activeInvoices}
            onMarkPaid={markAsPaid}
            onArchive={archiveInvoice}
            onInvoiceCreatedFromUpload={handleInvoiceCreatedFromUpload}
            onInvoiceUpdated={handleInvoiceUpdated}
            onArchiveInvoice={handleArchiveInvoice}
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

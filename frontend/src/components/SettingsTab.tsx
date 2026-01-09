import { useEffect, useState } from "react";
import { tryFetchApi } from "../utils/api";

type Props = {
  appKey: string;
  onAppKeyChange: (value: string) => void;
};

export default function SettingsTab({ appKey: _appKey, onAppKeyChange: _onAppKeyChange }: Props) {
  const [emailConnected, setEmailConnected] = useState(true);
  const [emailPaused, setEmailPaused] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderLeadDays, setReminderLeadDays] = useState<1 | 3 | 7>(3);
  const [reminderRecipient, setReminderRecipient] = useState("");
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  const toggleEmailStatus = () => {
    setEmailConnected((prev) => !prev);
    setEmailPaused(false);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("spa_finance_reminders_v1");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { enabled?: boolean; leadDays?: number; recipient?: string };
      setRemindersEnabled(Boolean(parsed.enabled));
      if (parsed.leadDays === 1 || parsed.leadDays === 3 || parsed.leadDays === 7) {
        setReminderLeadDays(parsed.leadDays);
      }
      if (parsed.recipient) {
        setReminderRecipient(parsed.recipient);
      }
    } catch (err) {
      console.error("Failed to parse reminder settings", err);
    }
  }, []);

  const persistReminders = (next: { enabled?: boolean; leadDays?: 1 | 3 | 7; recipient?: string }) => {
    if (typeof window === "undefined") return;
    const payload = {
      enabled: next.enabled ?? remindersEnabled,
      leadDays: next.leadDays ?? reminderLeadDays,
      recipient: next.recipient ?? reminderRecipient,
    };
    window.localStorage.setItem("spa_finance_reminders_v1", JSON.stringify(payload));
  };

  const handleExportCsv = async () => {
    if (typeof window === "undefined") return;
    setExportError(null);
    setExportSuccess(false);
    setExporting(true);
    try {
      const res = await tryFetchApi("/api/export/csv");
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || "spa-finance-export.csv";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (err) {
      console.error("CSV export failed", err);
      setExportError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--spa-muted)]">Settings</p>
        <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500">Tune how your finance hub keeps you informed and how your workspace is set up.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <p className="text-lg font-semibold text-slate-900">Locations & reporting (optional)</p>
          <p className="text-sm text-slate-600">
            Use this for multi-location reporting and weekly summaries. Leave it as-is for now and update when you add more sites.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Primary location name</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                defaultValue="The Spa by Kaajal (Primary)"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Default currency (optional)</span>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2" defaultValue="GBP">
                <option>GBP</option>
                <option>USD</option>
                <option>EUR</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Timezone (optional)</span>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2" defaultValue="Europe/London">
                <option>Europe/London</option>
                <option>Europe/Dublin</option>
                <option>America/New_York</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Week starts on (optional)</span>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2" defaultValue="Monday">
                <option>Monday</option>
                <option>Sunday</option>
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-900">Invoice inbox</p>
              <p className="text-sm text-slate-500">
                Point your invoice inbox (e.g. invoices@yourcompany.com) here and it will file new supplier invoices for you.
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
                emailConnected && !emailPaused ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"
              }`}
            >
              <span className="mr-1 h-2 w-2 rounded-full bg-current opacity-80" />
              {emailConnected && !emailPaused ? "Connected" : "Not connected"}
            </span>
          </div>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600">Email address</span>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2" defaultValue="invoices@demo-company.com" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-lg border border-[color:var(--spa-border)] bg-white px-4 py-2 text-sm font-semibold text-[color:var(--spa-accent)] shadow-sm hover:bg-[color:var(--spa-wash)]"
              onClick={toggleEmailStatus}
            >
              {emailConnected ? "Reconnect" : "Connect email inbox"}
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-[color:var(--spa-wash)]"
              onClick={() => setEmailPaused((prev) => !prev)}
            >
              {emailPaused ? "Resume" : "Pause"} email capture
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3 lg:col-span-2">
          <p className="text-lg font-semibold text-slate-900">Data</p>
          <p className="text-sm text-slate-600">
            Exports invoices and receipts as a CSV for your accountant.
          </p>
          <button
            className="w-fit rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => void handleExportCsv()}
            disabled={exporting}
          >
            {exporting ? "Preparing CSV…" : "Export invoices & receipts (CSV)"}
          </button>
          {exportSuccess && <p className="text-sm text-emerald-700">Downloaded.</p>}
          {exportError && <p className="text-sm text-rose-600">{exportError}</p>}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-900">Email reminders (Preview)</p>
              <p className="text-sm text-slate-600">Send due-date reminders before supplier invoices fall overdue.</p>
            </div>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
                remindersEnabled ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {remindersEnabled ? "On" : "Off"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Status</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={remindersEnabled ? "on" : "off"}
                onChange={(e) => {
                  const next = e.target.value === "on";
                  setRemindersEnabled(next);
                  persistReminders({ enabled: next });
                  setReminderMessage(next ? "Email reminders active (Preview)" : "Email reminders paused");
                }}
              >
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Send reminders</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={reminderLeadDays}
                onChange={(e) => {
                  const next = Number(e.target.value) as 1 | 3 | 7;
                  setReminderLeadDays(next);
                  persistReminders({ leadDays: next });
                }}
              >
                {[1, 3, 7].map((opt) => (
                  <option key={opt} value={opt}>
                    {opt} days before due date
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm sm:col-span-1">
              <span className="text-slate-600">Recipient email</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                placeholder="accounts@thespabykaajal.com"
                value={reminderRecipient}
                onChange={(e) => {
                  setReminderRecipient(e.target.value);
                  persistReminders({ recipient: e.target.value });
                }}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
              onClick={() => {
                const next = !remindersEnabled;
                setRemindersEnabled(next);
                persistReminders({ enabled: next });
                setReminderMessage(next ? "Email reminders active (Preview)" : "Email reminders paused");
              }}
            >
              {remindersEnabled ? "Deactivate reminders" : "Activate reminders"}
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-[color:var(--spa-wash)]"
              onClick={() => {
                setReminderMessage("Test reminder queued (Preview)");
              }}
            >
              Send test reminder
            </button>
            {reminderMessage && <span className="text-sm text-slate-700">{reminderMessage}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

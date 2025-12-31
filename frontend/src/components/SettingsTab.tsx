import { useEffect, useState } from "react";
import { tenantConfig } from "../config/tenant";
import { tryFetchApi } from "../utils/api";

type Props = {
  appKey: string;
  onAppKeyChange: (value: string) => void;
};

export default function SettingsTab({ appKey, onAppKeyChange }: Props) {
  const [digestFrequency, setDigestFrequency] = useState("Weekly");
  const [digestTime, setDigestTime] = useState("09:00");
  const [showRiskLabels, setShowRiskLabels] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const [emailConnected, setEmailConnected] = useState(true);
  const [emailPaused, setEmailPaused] = useState(false);
  const [keyRequired, setKeyRequired] = useState<boolean | null>(null);
  const [keyValidity, setKeyValidity] = useState<"unknown" | "valid" | "invalid" | "not_set">("unknown");
  const [keyStatusError, setKeyStatusError] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState(appKey);
  const [savedMessageVisible, setSavedMessageVisible] = useState(false);

  const toggleEmailStatus = () => {
    setEmailConnected((prev) => !prev);
    setEmailPaused(false);
  };

  const refreshKeyStatus = async (overrideKey?: string) => {
    try {
      setKeyStatusError(null);
      const baseRes = await tryFetchApi("/api/auth-status");
      const baseData = (await baseRes.json()) as { app_require_key?: boolean };
      setKeyRequired(Boolean(baseData.app_require_key));

      const headerKey = overrideKey ?? appKey;
      if (!headerKey) {
        setKeyValidity("not_set");
        return;
      }

      const withHeaderRes = await tryFetchApi("/api/auth-status", {
        headers: { "X-APP-KEY": headerKey },
      });
      const withHeaderData = (await withHeaderRes.json()) as { authorised?: boolean };
      setKeyValidity(withHeaderData.authorised ? "valid" : "invalid");
    } catch (err) {
      console.error("Failed to check auth status", err);
      setKeyValidity("unknown");
      setKeyStatusError("Key status unavailable.");
    }
  };

  useEffect(() => {
    void refreshKeyStatus();
  }, [appKey]);

  useEffect(() => {
    setDraftKey(appKey);
  }, [appKey]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm uppercase tracking-[0.16em] text-cyan-600">Settings</p>
        <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500">Tune how Kalyan AI keeps you informed and how your workspace is set up.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <p className="text-lg font-semibold text-slate-900">App key</p>
          <p className="text-sm text-slate-600">Required for uploads/edits. Stored locally only.</p>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600">App Key</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="Paste shared secret"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-900 shadow hover:opacity-90"
              style={{ backgroundColor: "var(--brand-accent-strong)" }}
              onClick={() => {
                if (typeof window !== "undefined") {
                  if (draftKey.trim()) {
                    window.localStorage.setItem("appKey", draftKey.trim());
                  } else {
                    window.localStorage.removeItem("appKey");
                  }
                }
                onAppKeyChange(draftKey.trim());
                void refreshKeyStatus(draftKey.trim());
                setSavedMessageVisible(true);
                setTimeout(() => setSavedMessageVisible(false), 2000);
              }}
            >
              Save key
            </button>
            {savedMessageVisible && <span className="text-sm text-emerald-700">Saved</span>}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Key status</p>
            <p>Key required by server: {keyRequired == null ? "Checking…" : keyRequired ? "Yes" : "No"}</p>
            <p>
              Current key:{" "}
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
                  keyValidity === "valid"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : keyValidity === "invalid"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {
                  {
                    unknown: "Unknown",
                    valid: "Valid",
                    invalid: "Invalid",
                    not_set: "Not set",
                  }[keyValidity]
                }
              </span>
            </p>
            {keyStatusError && <p className="text-rose-600">{keyStatusError}</p>}
            <button
              type="button"
              className="mt-2 rounded border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => void refreshKeyStatus()}
            >
              Refresh status
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <p className="text-lg font-semibold text-slate-900">Business profile</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Company name</span>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2" defaultValue="Demo Company Ltd" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Default currency</span>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2" defaultValue="GBP">
                <option>GBP</option>
                <option>USD</option>
                <option>EUR</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Timezone</span>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2" defaultValue="Europe/London">
                <option>Europe/London</option>
                <option>Europe/Dublin</option>
                <option>America/New_York</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Week starts on</span>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2" defaultValue="Monday">
                <option>Monday</option>
                <option>Sunday</option>
              </select>
            </label>
          </div>
        </div>

        {tenantConfig.features.aiDigests && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <p className="text-lg font-semibold text-slate-900">AI & email digests</p>
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <label className="space-y-1">
                <span className="text-slate-600">Digest frequency</span>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={digestFrequency}
                  onChange={(e) => setDigestFrequency(e.target.value)}
                >
                  <option>Off</option>
                  <option>Daily</option>
                  <option>Weekly</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Digest send time</span>
                <input
                  type="time"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={digestTime}
                  onChange={(e) => setDigestTime(e.target.value)}
                />
              </label>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div>
                  <p className="font-semibold text-slate-900">Show AI risk labels on dashboard</p>
                  <p className="text-sm text-slate-500">Let AI highlight costly weeks and invoices so you act early.</p>
                </div>
                <button
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${showRiskLabels ? "bg-cyan-500 text-white" : "bg-slate-200 text-slate-700"}`}
                  onClick={() => setShowRiskLabels((prev) => !prev)}
                >
                  {showRiskLabels ? "On" : "Off"}
                </button>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div>
                  <p className="font-semibold text-slate-900">Show AI confidence score</p>
                  <p className="text-sm text-slate-500">Display how sure AI is about extracted details.</p>
                </div>
                <button
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${showConfidence ? "bg-cyan-500 text-white" : "bg-slate-200 text-slate-700"}`}
                  onClick={() => setShowConfidence((prev) => !prev)}
                >
                  {showConfidence ? "On" : "Off"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-900">Invoice email inbox</p>
              <p className="text-sm text-slate-500">
                Point Kalyan AI at your invoices inbox (e.g. invoices@yourcompany.com) and it will file new bills for you.
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
              className="rounded-lg border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-cyan-700 shadow-sm hover:bg-cyan-50"
              onClick={toggleEmailStatus}
            >
              {emailConnected ? "Reconnect" : "Connect email inbox"}
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => setEmailPaused((prev) => !prev)}
            >
              {emailPaused ? "Resume" : "Pause"} email capture
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <p className="text-lg font-semibold text-slate-900">Data</p>
          <p className="text-sm text-slate-600">
            Invoices and extracted data stay on this server. Delete items in Documents anytime.
          </p>
          <button className="w-fit rounded-lg border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-cyan-700 shadow-sm hover:bg-cyan-50">
            Export data as CSV
          </button>
        </div>
      </div>
    </div>
  );
}

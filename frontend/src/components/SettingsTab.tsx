import { useEffect, useState } from "react";
import { tryFetchApi } from "../utils/api";

type Props = {
  appKey: string;
  onAppKeyChange: (value: string) => void;
};

export default function SettingsTab({ appKey, onAppKeyChange }: Props) {
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
        <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--spa-muted)]">Settings</p>
        <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500">Tune how your finance hub keeps you informed and how your workspace is set up.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
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
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
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

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3 lg:col-span-3">
          <p className="text-lg font-semibold text-slate-900">Data</p>
          <p className="text-sm text-slate-600">
            Invoices and extracted data stay on this server. Delete items in Documents anytime.
          </p>
          <button className="w-fit rounded-lg border border-[color:var(--spa-border)] bg-white px-4 py-2 text-sm font-semibold text-[color:var(--spa-accent)] shadow-sm hover:bg-[color:var(--spa-wash)]">
            Export data as CSV
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { tryFetchApi } from "../utils/api";

type Tip = {
  id: number;
  tip_date: string;
  method: string;
  amount: number;
  note?: string | null;
  customer_name?: string | null;
  staff_name?: string | null;
};

type Staff = {
  id: number;
  name: string;
  active: number;
};

const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export default function TipsTab() {
  const today = useMemo(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }, []);
  const [tips, setTips] = useState<Tip[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tipDate, setTipDate] = useState(today);
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [staffName, setStaffName] = useState("");
  const [addingStaff, setAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);

  const loadTips = async () => {
    setError(null);
    try {
      const res = await tryFetchApi("/api/tips");
      const data = (await res.json()) as { tips?: Tip[] };
      if (Array.isArray(data.tips)) {
        setTips(data.tips);
      }
    } catch (err) {
      console.error("Failed to load tips", err);
      setError("Could not load tips. Please retry.");
    }
  };

  const loadStaff = async () => {
    setStaffError(null);
    try {
      const res = await tryFetchApi("/api/staff");
      const data = (await res.json()) as { staff?: Staff[] };
      if (Array.isArray(data.staff)) {
        setStaff(data.staff);
      }
    } catch (err) {
      console.error("Failed to load staff", err);
      setStaffError("Could not load staff. Please retry.");
    }
  };

  useEffect(() => {
    void loadTips();
    void loadStaff();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        tip_date: tipDate,
        method,
        amount: amount ? Number(amount) : undefined,
      };
      if (note.trim()) body.note = note.trim();
      if (customerName.trim()) body.customer_name = customerName.trim();
      if (staffName.trim() && staffName !== "add_new") body.staff_name = staffName.trim();
      const res = await tryFetchApi("/api/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await res.json();
      setAmount("");
      setNote("");
      setCustomerName("");
      if (staffName !== "add_new") setStaffName("");
      await loadTips();
    } catch (err) {
      console.error("Failed to add tip", err);
      setError("Could not add tip. Please check the details and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.16em] text-cyan-600">Tips</p>
        <h1 className="text-3xl font-bold text-slate-900">Tips</h1>
        <p className="text-slate-500">Record cash and card tips and keep a simple audit trail.</p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-slate-700">Date</span>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={tipDate}
              onChange={(e) => setTipDate(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-700">Method</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={method}
              onChange={(e) => setMethod(e.target.value as "cash" | "card")}
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-700">Amount</span>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-1">
            <span className="text-slate-700">Customer</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
            />
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-slate-700">Received by</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={staffName}
              onChange={(e) => {
                const val = e.target.value;
                setStaffName(val);
                setAddingStaff(val === "add_new");
              }}
            >
              <option value="">Select staff</option>
              {staff.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
              <option value="add_new">Add new…</option>
            </select>
            {staffError && <p className="text-xs text-rose-600">{staffError}</p>}
          </label>
          {addingStaff && (
            <div className="space-y-1 text-sm md:col-span-2">
              <span className="text-slate-700">Add new staff</span>
              <div className="flex gap-2">
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder="Staff name"
                />
                <button
                  type="button"
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-slate-900"
                  onClick={async () => {
                    setStaffError(null);
                    const trimmed = newStaffName.trim();
                    if (trimmed.length < 2) {
                      setStaffError("Name must be at least 2 characters");
                      return;
                    }
                    try {
                      const res = await tryFetchApi("/api/staff", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: trimmed }),
                      });
                      const created = await res.json();
                      await loadStaff();
                      setStaffName(created?.name || trimmed);
                      setNewStaffName("");
                      setAddingStaff(false);
                    } catch (err) {
                      console.error("Failed to add staff", err);
                      setStaffError("Could not add staff (might already exist).");
                    }
                  }}
                >
                  Add staff
                </button>
              </div>
            </div>
          )}
          <label className="space-y-1 text-sm md:col-span-1">
            <span className="text-slate-700">Note (optional)</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Shift lead tip"
            />
          </label>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-cyan-700 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Adding…" : "Add tip"}
        </button>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="p-4">
          <p className="text-lg font-semibold text-slate-900">Recent tips</p>
          <p className="text-sm text-slate-500">Latest first</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Date", "Method", "Amount", "Customer", "Received by", "Note"].map((col) => (
                  <th key={col} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tips.map((tip) => (
                <tr key={tip.id} className="hover:bg-slate-50/70">
                  <td className="px-3 py-3 text-slate-700">{tip.tip_date || "—"}</td>
                  <td className="px-3 py-3 text-slate-700">{tip.method}</td>
                  <td className="px-3 py-3 font-semibold text-slate-900">{currency.format(Number(tip.amount || 0))}</td>
                  <td className="px-3 py-3 text-slate-700">{tip.customer_name || "—"}</td>
                  <td className="px-3 py-3 text-slate-700">{tip.staff_name || "—"}</td>
                  <td className="px-3 py-3 text-slate-700">{tip.note || "—"}</td>
                </tr>
              ))}
              {tips.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={6}>
                    No tips recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

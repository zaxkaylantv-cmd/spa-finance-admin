require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), override: true });
console.log(`AI key present: ${Boolean(process.env.OPENAI_API_KEY)} (len=${(process.env.OPENAI_API_KEY || "").length})`);
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const {
  getInvoices,
  markInvoicePaid,
  archiveInvoice,
  insertInvoice,
  insertReceipt,
  updateInvoice,
  getTips,
  insertTip,
  updateTip,
  archiveTip,
  getStaff,
  insertStaff,
  setStaffActive,
  insertFile,
  getFilesForOwner,
  findFileById,
  findFileByRef,
  findFileByHash,
  findInvoiceById,
  getRecentInvoicesBySupplier,
  insertAutoApprovalRule,
  getAutoApprovalRules,
} = require("./db");
const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const { extractInvoiceFromText, extractInvoiceFromImage } = require("./ai/invoiceExtractor");
const { extractReceiptFromImage } = require("./ai/receiptExtractor");
const { buildLocalFileRef } = require("./storage/localStorage");
const { generateInvoiceActions } = require("./ai/actions");
const OpenAI = require("openai");
const { createReadStream } = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { getSupabaseAdminClient } = require("./supabaseClient");

const PORT = process.env.PORT || 3002;
const app = express();

app.use(cors());
app.use(express.json());

const requireAppKey = (req, res, next) => {
  const requireKey = (process.env.APP_REQUIRE_KEY || "1").toLowerCase();
  if (requireKey === "0" || requireKey === "false") {
    return next();
  }
  const expected = process.env.APP_SHARED_SECRET;
  if (!expected) {
    console.error("APP_SHARED_SECRET is not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }
  const provided = req.get("x-app-key");
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

const uploadDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeOriginalName = file.originalname.replace(/\s+/g, "_");
    cb(null, `${timestamp}-${safeOriginalName}`);
  },
});
const upload = multer({ storage });

const streamFileRecord = (record, res) => {
  const ref = record.file_ref || "";
  if (ref.startsWith("gdrive:")) {
    return res.status(501).json({ error: "Google Drive storage not yet configured" });
  }

  if (!ref.startsWith("local:uploads/")) {
    return res.status(400).json({ error: "Unsupported file reference" });
  }

  const filename = ref.replace("local:uploads/", "");
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).json({ error: "Invalid file reference" });
  }

  const absolutePath = path.join(uploadDir, filename);
  try {
    const stream = createReadStream(absolutePath);
    const mime = record.mime_type || "application/octet-stream";
    const downloadName = record.original_filename || filename;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    stream.on("error", (err) => {
      console.error("File stream error", err);
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error("File read error", err);
    return res.status(404).json({ error: "File not found" });
  }
};

const aiClient = (() => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set; AI summary will be unavailable.");
    return null;
  }
  return new OpenAI({ apiKey });
})();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/supabase-status", async (_req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return res.json({ ok: false, error: "missing_env" });
  }

  try {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      return res.json({ ok: false, error: "init_failed" });
    }

    const { error } = await supabase.from("invoices").select("id").limit(1);

    if (error) {
      return res.json({ ok: false, error: "query_failed", details: error.message });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Supabase status check failed", err);
    return res.json({ ok: false, error: "exception", details: err.message });
  }
});

app.get("/api/supabase-invoices", async (req, res) => {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const includeArchivedParam = String(req.query.includeArchived || "").toLowerCase();
  const includeArchived = includeArchivedParam === "1" || includeArchivedParam === "true";
  const docTypeRaw = typeof req.query.docType === "string" ? req.query.docType.trim() : "";
  const docType = docTypeRaw ? docTypeRaw.toLowerCase() : "invoice";

  try {
    let query = supabase.from("invoices").select("*").eq("doc_type", docType);
    if (!includeArchived) {
      query = query.eq("archived", false);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch invoices", details: error.message });
    }

    return res.json({ invoices: data || [] });
  } catch (err) {
    console.error("Supabase invoices fetch failed", err);
    return res.status(500).json({ error: "Failed to fetch invoices", details: err.message });
  }
});

app.get("/api/receipts", async (req, res) => {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const includeArchivedParam = String(req.query.includeArchived || "").toLowerCase();
  const includeArchived = includeArchivedParam === "1" || includeArchivedParam === "true";

  try {
    let query = supabase.from("invoices").select("*").eq("doc_type", "receipt");
    if (!includeArchived) {
      query = query.eq("archived", false);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch receipts", details: error.message });
    }

    return res.json({ receipts: data || [] });
  } catch (err) {
    console.error("Supabase receipts fetch failed", err);
    return res.status(500).json({ error: "Failed to fetch receipts", details: err.message });
  }
});

app.get("/api/ai/status", (req, res) => {
  const requireKey = (process.env.APP_REQUIRE_KEY || "1").toLowerCase();
  const keyRequired = !(requireKey === "0" || requireKey === "false");
  const provided = req.get("x-app-key");
  const headerPresent = typeof provided === "string" && provided.length > 0;
  const authorised = keyRequired ? headerPresent && provided === process.env.APP_SHARED_SECRET : true;

  res.json({
    ai_configured: Boolean(process.env.OPENAI_API_KEY),
    requires_key: keyRequired,
    authorised,
  });
});

app.get("/api/auth-status", (req, res) => {
  const requireKey = (process.env.APP_REQUIRE_KEY || "1").toLowerCase();
  const appRequireKey = !(requireKey === "0" || requireKey === "false");
  const provided = req.get("x-app-key");
  const headerPresent = typeof provided === "string" && provided.length > 0;
  const authorised = appRequireKey ? headerPresent && provided === process.env.APP_SHARED_SECRET : true;

  res.json({
    app_require_key: appRequireKey,
    header_present: headerPresent,
    authorised,
  });
});

app.get("/api/invoices", async (req, res) => {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const includeArchivedParam = String(req.query.includeArchived || "").toLowerCase();
  const includeArchived = includeArchivedParam === "1" || includeArchivedParam === "true";

  try {
    let query = supabase.from("invoices").select("*").eq("doc_type", "invoice");
    if (!includeArchived) {
      query = query.eq("archived", false);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch invoices", details: error.message });
    }

    return res.json({ invoices: data || [] });
  } catch (err) {
    console.error("Supabase invoices fetch failed", err);
    return res.status(500).json({ error: "Failed to fetch invoices", details: err.message });
  }
});

app.get("/api/cashflow-summary", async (_req, res) => {
  try {
    const invoices = await getInvoices();

    const getInvoiceDueDate = (row) => {
      const raw = row.dueDate || row.due_date;
      if (!raw) return null;
      const parsed = new Date(raw);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    const isPaidStatus = (row) => {
      const status = (row.status || "").trim().toLowerCase();
      return status === "paid";
    };

    const today = new Date();
    const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    let totalPaid = 0;
    let totalOutstanding = 0;
    const overdueInvoices = [];
    const dueSoonInvoices = [];
    const next30Invoices = [];

    invoices
      .filter((inv) => inv.archived !== 1 && inv.archived !== true)
      .forEach((inv) => {
        const amount = Number(inv.amount) || 0;
        const paid = isPaidStatus(inv);
        const dueDate = getInvoiceDueDate(inv);

        if (paid) {
          totalPaid += amount;
          return;
        }

        totalOutstanding += amount;

        if (!dueDate) return; // exclude from date-based buckets if no valid due date

        if (dueDate < today) {
          overdueInvoices.push(inv);
        } else if (dueDate >= today && dueDate <= sevenDaysFromNow) {
          dueSoonInvoices.push(inv);
          next30Invoices.push(inv);
        } else if (dueDate > sevenDaysFromNow && dueDate <= thirtyDaysFromNow) {
          next30Invoices.push(inv);
        }
      });

    const metrics = {
      totalOutstanding,
      totalPaid,
      countOverdue: overdueInvoices.length,
      countDueSoon: dueSoonInvoices.length,
    };

    let summary = "AI summary is temporarily unavailable. Metrics are still accurate.";

    if (aiClient) {
      if (totalOutstanding === 0) {
        return res.json({
          metrics,
          summary: "There are no outstanding invoices. Cashflow looks clear at the moment.",
        });
      }

      const largestOverdue = [...overdueInvoices]
        .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
        .slice(0, 3)
        .map((inv) => `${inv.supplier} — ${inv.amount} due ${inv.due_date || inv.dueDate || "unknown"}`);

      const dueSoonList = [...dueSoonInvoices]
        .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
        .slice(0, 3)
        .map((inv) => `${inv.supplier} — ${inv.amount} due ${inv.due_date || inv.dueDate || "unknown"}`);

      const next30Total = next30Invoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

      const context = `
Metrics:
- Total outstanding (unpaid): ${totalOutstanding}
- Total paid: ${totalPaid}
- Overdue invoices: ${overdueInvoices.length}
- Due in next 7 days: ${dueSoonInvoices.length}
- Total due in next 30 days: ${next30Total}

Largest overdue (up to 3):
${largestOverdue.map((t, i) => `${i + 1}. ${t}`).join("\n") || "None"}

Due in next 7 days (up to 3):
${dueSoonList.map((t, i) => `${i + 1}. ${t}`).join("\n") || "None"}

Write 2-4 concise bullet points (or 2-3 short sentences) about upcoming cash out, overdue risk, and any spikes in the next 30 days. Use ONLY the data provided; do not invent invoices or amounts. Always express currency in GBP (£).`;

      try {
        const aiRes = await aiClient.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a financial analyst helping a business owner understand upcoming supplier payments and cashflow risks. Be concise and practical. Always express currency in GBP (£), never in $.",
            },
            { role: "user", content: context },
          ],
          temperature: 0.2,
        });
        const content = aiRes?.choices?.[0]?.message?.content;
        if (content && typeof content === "string") {
          summary = content.trim();
        }
      } catch (err) {
        console.error("AI cashflow summary failed:", err);
      }
    }

    return res.json({ metrics, summary });
  } catch (err) {
    console.error("Failed to generate cashflow summary", err);
    return res.status(500).json({ error: "Failed to generate cashflow summary" });
  }
});

app.get("/api/tips", async (_req, res) => {
  try {
    const tips = await getTips();
    res.json({ tips });
  } catch (err) {
    console.error("Failed to fetch tips", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/ai/invoices/:id/actions", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid invoice id" });
    const invoice = await findInvoiceById(id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    let history = [];
    if (invoice.supplier) {
      history = await getRecentInvoicesBySupplier(invoice.supplier, 10);
      history = history.filter((h) => h.id !== id);
    }
    try {
      const actions = await generateInvoiceActions(invoice, history);
      return res.json({ actions });
    } catch (err) {
      if (err.code === "NO_API_KEY") {
        return res.status(501).json({ error: "AI not configured (missing OPENAI_API_KEY)" });
      }
      console.error("AI actions failed", err);
      return res.status(500).json({ error: "AI request failed" });
    }
  } catch (err) {
    console.error("Failed to fetch AI actions", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/auto-approval-rules", async (req, res) => {
  try {
    const supplier = typeof req.query.supplier === "string" ? req.query.supplier : undefined;
    const rules = await getAutoApprovalRules({ supplier });
    res.json({ rules });
  } catch (err) {
    console.error("Failed to fetch auto-approval rules", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auto-approval-rules", requireAppKey, async (req, res) => {
  try {
    const { supplier, monthly_limit } = req.body || {};
    if (!supplier || typeof supplier !== "string") {
      return res.status(400).json({ error: "supplier is required" });
    }
    const limit = Number(monthly_limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      return res.status(400).json({ error: "monthly_limit must be greater than zero" });
    }
    const inserted = await insertAutoApprovalRule({ supplier, monthly_limit: limit });
    res.json(inserted);
  } catch (err) {
    console.error("Failed to insert auto-approval rule", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/invoices/:id/files", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid invoice id" });
    }
    const includeArchivedParam = String(req.query.includeArchived || "").toLowerCase();
    const includeArchived = includeArchivedParam === "1" || includeArchivedParam === "true";
    const files = await getFilesForOwner({ owner_type: "invoice", owner_id: id, includeArchived });
    res.json({ files });
  } catch (err) {
    console.error("Failed to fetch invoice files", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/receipts/:id/files", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid receipt id" });
    }
    const includeArchivedParam = String(req.query.includeArchived || "").toLowerCase();
    const includeArchived = includeArchivedParam === "1" || includeArchivedParam === "true";
    const files = await getFilesForOwner({ owner_type: "receipt", owner_id: id, includeArchived });
    res.json({ files });
  } catch (err) {
    console.error("Failed to fetch receipt files", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/files/:id/download", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid file id" });
    }
    const record = await findFileById(id);
    if (!record) {
      return res.status(404).json({ error: "File not found" });
    }

    return streamFileRecord(record, res);
  } catch (err) {
    console.error("Failed to download file", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/files/download-by-ref", requireAppKey, async (req, res) => {
  try {
    const ref = typeof req.query.ref === "string" ? req.query.ref : "";
    if (!ref) {
      return res.status(400).json({ error: "ref query parameter is required" });
    }
    const record = await findFileByRef(ref);
    if (!record) {
      return res.status(404).json({ error: "File not found" });
    }

    return streamFileRecord(record, res);
  } catch (err) {
    console.error("Failed to download file", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/staff", async (req, res) => {
  try {
    const includeInactiveParam = String(req.query.includeInactive || "").toLowerCase();
    const includeInactive = includeInactiveParam === "1" || includeInactiveParam === "true";
    const staff = await getStaff({ includeInactive });
    res.json({ staff });
  } catch (err) {
    console.error("Failed to fetch staff", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/staff", requireAppKey, async (req, res) => {
  try {
    const rawName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!rawName || rawName.length < 2) {
      return res.status(400).json({ error: "name must be at least 2 characters" });
    }
    try {
      const inserted = await insertStaff({ name: rawName });
      return res.json(inserted);
    } catch (err) {
      if (err && err.code === "SQLITE_CONSTRAINT") {
        return res.status(409).json({ error: "name already exists" });
      }
      throw err;
    }
  } catch (err) {
    console.error("Failed to insert staff", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/staff/:id/deactivate", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid staff id" });
    }
    const updated = await setStaffActive(id, false);
    if (!updated) return res.status(404).json({ error: "Staff not found" });
    res.json({ success: true, staff: updated });
  } catch (err) {
    console.error("Failed to deactivate staff", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/staff/:id/reactivate", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid staff id" });
    }
    const updated = await setStaffActive(id, true);
    if (!updated) return res.status(404).json({ error: "Staff not found" });
    res.json({ success: true, staff: updated });
  } catch (err) {
    console.error("Failed to reactivate staff", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/invoices/:id/mark-paid", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updated = await markInvoicePaid(id);
    if (!updated) return res.status(404).json({ error: "Invoice not found" });
    res.json(updated);
  } catch (err) {
    console.error("Failed to mark invoice as paid", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/invoices/:id/archive", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updated = await archiveInvoice(id);
    if (!updated) return res.status(404).json({ error: "Invoice not found" });
    res.json({ success: true, invoice: updated });
  } catch (err) {
    console.error("Failed to archive invoice", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/invoices/:id", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const allowed = ["supplier", "invoice_number", "issue_date", "due_date", "amount", "status", "category", "notes", "vat_amount"];
    const payload = {};
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        payload[key] = req.body[key];
      }
    });

    if ("amount" in payload) {
      const parsed = Number(payload.amount);
      payload.amount = Number.isFinite(parsed) ? parsed : null;
    }

    if ("vat_amount" in payload) {
      const parsedVat = Number(payload.vat_amount);
      payload.vat_amount = Number.isFinite(parsedVat) ? parsedVat : null;
    }

    ["supplier", "invoice_number", "status", "category", "notes"].forEach((key) => {
      if (key in payload && typeof payload[key] === "string") {
        const trimmed = payload[key].trim();
        payload[key] = trimmed.length ? trimmed : null;
      }
    });

    ["issue_date", "due_date"].forEach((key) => {
      if (key in payload && typeof payload[key] === "string" && payload[key].trim() === "") {
        payload[key] = null;
      }
    });

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }

    const updated = await updateInvoice(id, payload);
    if (!updated) return res.status(404).json({ error: "Invoice not found" });
    res.json(updated);
  } catch (err) {
    console.error("Failed to update invoice", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/tips", requireAppKey, async (req, res) => {
  try {
    const { tip_date, method, amount, note, customer_name, staff_name } = req.body || {};
    if (!tip_date) {
      return res.status(400).json({ error: "tip_date is required" });
    }
    const normalisedMethod = typeof method === "string" ? method.toLowerCase().trim() : "";
    if (normalisedMethod !== "cash" && normalisedMethod !== "card") {
      return res.status(400).json({ error: "method must be cash or card" });
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "amount must be greater than zero" });
    }
    const inserted = await insertTip({
      tip_date,
      method: normalisedMethod,
      amount: parsedAmount,
      note,
      customer_name: typeof customer_name === "string" ? customer_name.trim() || null : null,
      staff_name: typeof staff_name === "string" ? staff_name.trim() || null : null,
    });
    res.json(inserted);
  } catch (err) {
    console.error("Failed to insert tip", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/tips/:id", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const allowed = ["tip_date", "method", "amount", "note", "customer_name", "staff_name"];
    const payload = {};
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        payload[key] = req.body[key];
      }
    });

    if ("method" in payload) {
      const normalisedMethod = typeof payload.method === "string" ? payload.method.toLowerCase().trim() : "";
      if (normalisedMethod !== "cash" && normalisedMethod !== "card") {
        return res.status(400).json({ error: "method must be cash or card" });
      }
      payload.method = normalisedMethod;
    }

    if ("amount" in payload) {
      const parsedAmount = Number(payload.amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "amount must be greater than zero" });
      }
      payload.amount = parsedAmount;
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }

    if ("customer_name" in payload && typeof payload.customer_name === "string") {
      payload.customer_name = payload.customer_name.trim();
    }

    if ("staff_name" in payload && typeof payload.staff_name === "string") {
      payload.staff_name = payload.staff_name.trim();
    }

    const updated = await updateTip(id, payload);
    if (!updated) return res.status(404).json({ error: "Tip not found" });
    res.json(updated);
  } catch (err) {
    console.error("Failed to update tip", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/tips/:id/archive", requireAppKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const archived = await archiveTip(id);
    if (!archived) return res.status(404).json({ error: "Tip not found" });
    res.json({ success: true, tip: archived });
  } catch (err) {
    console.error("Failed to archive tip", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/upload-invoice", requireAppKey, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      console.warn("Upload attempted with no file");
      return res.status(400).json({ error: "No file uploaded" });
    }
    const fileRef = buildLocalFileRef(req.file);
    const mimetype = (req.file.mimetype || "").toLowerCase();
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif"];
    const isPdf = mimetype === "application/pdf" || mimetype === "application/x-pdf" || mimetype.includes("pdf") || ext === ".pdf";
    const isImage = mimetype.startsWith("image/") || imageExtensions.includes(ext);
    if (!isPdf && !isImage) {
      console.warn("Unsupported invoice upload type:", mimetype);
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: "Unsupported file type. Please upload a PDF or image invoice." });
    }

    console.log("Upload received:", {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      path: req.file.path,
      size: req.file.size,
    });

    const uploadedBuffer = await fs.promises.readFile(req.file.path);
    const fileHash = crypto.createHash("sha256").update(uploadedBuffer).digest("hex");
    const existing = await findFileByHash("invoice", fileHash);
    if (existing) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.json({ success: true, duplicate: true, existingOwnerId: existing.owner_id, fileId: existing.id });
    }

    const nowIso = new Date().toISOString();
    const today = new Date();
    const due = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const toISO = (d) => d.toISOString().slice(0, 10);
    const weekLabelFromDate = (date) => `Week of ${date}`;

    const fallbackInvoice = {
      supplier: "Uploaded invoice",
      invoice_number: req.file.originalname,
      issue_date: toISO(today),
      due_date: toISO(due),
      amount: null,
      status: "Upcoming",
      category: "Uncategorised",
      source: "Upload",
      week_label: weekLabelFromDate(toISO(due)),
      archived: 0,
      vat_amount: null,
      doc_type: "invoice",
      file_kind: isImage ? "image" : "pdf",
      created_at: nowIso,
      updated_at: nowIso,
      file_ref: fileRef,
      file_hash: fileHash,
      doc_kind: "invoice",
      needs_review: 0,
      confidence: null,
      extracted_source: null,
      extracted_json: null,
    };

    let rawText = "";
    let parseFailed = false;
    let extractedSource = null;
    const shouldTreatAsText =
      mimetype.startsWith("text/") ||
      mimetype === "application/octet-stream" ||
      ext === ".txt" ||
      ext === ".csv" ||
      ext === ".json";

    if (shouldTreatAsText) {
      try {
        rawText = uploadedBuffer.toString("utf8");
        console.log("Raw text source: plain text or extension-based text");
      } catch (readErr) {
        console.error("Text read failed, using fallback:", readErr);
        rawText = `Uploaded invoice file: ${req.file.originalname}. Extract key invoice details.`;
      }
    } else if (isPdf) {
      try {
        if (typeof PDFParse !== "function") {
          throw new Error("pdf-parse PDFParse class not available");
        }
        const parser = new PDFParse({ data: uploadedBuffer });
        const textResult = await parser.getText();
        rawText = (textResult && typeof textResult.text === "string") ? textResult.text : "";
        console.log("Raw text source: PDF via pdf-parse");
      } catch (pdfErr) {
        console.error("PDF parse failed:", pdfErr);
        parseFailed = true;
        rawText = `Uploaded invoice file: ${req.file.originalname}. Extract key invoice details.`;
        console.log("Falling back to generic prompt text for PDF.");
      }
    } else if (isImage) {
      let tmpDir;
      try {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "invoice-ocr-"));
        const inputPath = path.join(tmpDir, "input.bin");
        const pngPath = path.join(tmpDir, "converted.png");
        await fs.promises.writeFile(inputPath, uploadedBuffer);
        await new Promise((resolve, reject) => {
          execFile(
            "convert",
            [inputPath, "-auto-orient", "-colorspace", "Gray", "-density", "300", "-strip", "-normalize", pngPath],
            { timeout: 20000 },
            (err) => {
              if (err) return reject(err);
              resolve();
            },
          );
        });
        const ocrText = await new Promise((resolve, reject) => {
          execFile("tesseract", [pngPath, "stdout", "-l", "eng"], { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout || "");
          });
        });
        rawText = typeof ocrText === "string" ? ocrText.slice(0, 20000) : "";
        extractedSource = rawText ? "image_ocr" : extractedSource;
        if (!rawText) {
          parseFailed = true;
          rawText = `Uploaded invoice file: ${req.file.originalname}. Extract key invoice details.`;
        }
      } catch (ocrErr) {
        console.error("Image OCR failed:", ocrErr);
        parseFailed = true;
        rawText = "";
      } finally {
        if (tmpDir) {
          await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } else {
      rawText = `Uploaded invoice file: ${req.file.originalname}. Extract key invoice details.`;
      console.log("Raw text source: generic fallback for non-text/non-PDF");
    }

    console.log("Raw text snippet:", rawText.slice(0, 400));

    const parseAmount = (value) => {
      if (!value) return undefined;
      const cleaned = value.replace(/[^0-9.\-]+/g, "");
      const num = parseFloat(cleaned);
      return Number.isNaN(num) ? undefined : num;
    };
    const normaliseDate = (value) => {
      if (!value) return null;
      const str = String(value).trim();
      if (!str) return null;
      const parsed = new Date(str);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString().slice(0, 10);
    };
    const normaliseNumber = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const toNullableNumber = (value) => {
      if (value === null || value === undefined || value === "" || value === "NaN") return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const simpleExtract = (text) => {
      if (!text) return {};
      const lines = text.split(/\r?\n/);
      const findValue = (label) => {
        const line = lines.find((l) => l.toLowerCase().includes(label));
        if (!line) return undefined;
        const parts = line.split(/[:\-]/);
        return parts.length > 1 ? parts.slice(1).join(":").trim() : undefined;
      };
      const parseDate = (value) => {
        if (!value) return undefined;
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
      };

      return {
        supplier: findValue("supplier"),
        invoice_number: findValue("invoice number") || findValue("invoice no") || findValue("inv"),
        issue_date: parseDate(findValue("issue date")),
        due_date: parseDate(findValue("due date")),
        amount: parseAmount(findValue("amount") || findValue("total") || findValue("balance")),
      };
    };

    const simpleResult = simpleExtract(rawText);

    let aiResult = null;
    let aiFailed = false;
    try {
      aiResult = await extractInvoiceFromText(rawText);
      if (!extractedSource) {
        extractedSource = isImage ? "image_ocr" : "pdf_text";
      }
      console.log("AI extraction result:", aiResult);
    } catch (err) {
      console.error("AI extraction failed:", err);
      aiFailed = true;
    }

    const mergedInvoice = { ...fallbackInvoice };

    if (simpleResult && typeof simpleResult === "object") {
      mergedInvoice.supplier = simpleResult.supplier?.trim() || mergedInvoice.supplier;
      mergedInvoice.invoice_number = simpleResult.invoice_number?.toString().trim() || mergedInvoice.invoice_number;
      mergedInvoice.issue_date = simpleResult.issue_date || mergedInvoice.issue_date;
      mergedInvoice.due_date = simpleResult.due_date || mergedInvoice.due_date;
      if (typeof simpleResult.amount === "number" && !Number.isNaN(simpleResult.amount)) {
        mergedInvoice.amount = simpleResult.amount;
      }
    }

    if (aiResult && typeof aiResult === "object") {
      mergedInvoice.supplier =
        (typeof aiResult.supplier === "string" && aiResult.supplier.trim()) || mergedInvoice.supplier;
      mergedInvoice.invoice_number =
        (aiResult.invoice_number && aiResult.invoice_number.toString().trim()) || mergedInvoice.invoice_number;
      mergedInvoice.issue_date = aiResult.issue_date || mergedInvoice.issue_date;
      mergedInvoice.due_date = aiResult.due_date || mergedInvoice.due_date;
      const aiAmount =
        typeof aiResult.amount === "number" && Number.isFinite(aiResult.amount)
          ? aiResult.amount
          : typeof aiResult.amount === "string"
            ? parseAmount(aiResult.amount)
            : undefined;
      if (typeof aiAmount === "number" && Number.isFinite(aiAmount)) {
        mergedInvoice.amount = aiAmount;
      }
      const aiSubtotal =
        typeof aiResult.subtotal === "number" && Number.isFinite(aiResult.subtotal)
          ? aiResult.subtotal
          : typeof aiResult.subtotal === "string"
            ? parseAmount(aiResult.subtotal)
            : undefined;
      if (typeof aiSubtotal === "number" && Number.isFinite(aiSubtotal)) {
        mergedInvoice.subtotal = aiSubtotal;
      }
      const aiTax =
        typeof aiResult.tax === "number" && Number.isFinite(aiResult.tax)
          ? aiResult.tax
          : typeof aiResult.tax === "string"
            ? parseAmount(aiResult.tax)
            : undefined;
      if (typeof aiTax === "number" && Number.isFinite(aiTax)) {
        mergedInvoice.tax = aiTax;
      }
      mergedInvoice.status =
        (typeof aiResult.status === "string" && aiResult.status.trim()) || mergedInvoice.status;
      mergedInvoice.category =
        (typeof aiResult.category === "string" && aiResult.category.trim()) || mergedInvoice.category;
      mergedInvoice.week_label = aiResult.due_date ? weekLabelFromDate(aiResult.due_date) : mergedInvoice.week_label;
      mergedInvoice.confidence =
        typeof aiResult.confidence === "number" && Number.isFinite(aiResult.confidence) ? aiResult.confidence : null;
    } else {
      console.error("AI extraction failed or returned null:", aiResult);
    }

    mergedInvoice.file_ref = fileRef ?? mergedInvoice.file_ref;
    mergedInvoice.extracted_source = extractedSource;
    mergedInvoice.extracted_json = aiResult ? JSON.stringify(aiResult).slice(0, 8000) : null;

    const needsReview =
      parseFailed ||
      aiFailed ||
      !aiResult ||
      !mergedInvoice.supplier ||
      !mergedInvoice.invoice_number ||
      mergedInvoice.amount === null ||
      (typeof mergedInvoice.confidence === "number" && mergedInvoice.confidence < 0.5);
    if (needsReview) {
      mergedInvoice.status = "Needs info";
      mergedInvoice.needs_review = 1;
    } else {
      mergedInvoice.needs_review = 0;
    }

    mergedInvoice.issue_date = normaliseDate(mergedInvoice.issue_date);
    mergedInvoice.due_date = normaliseDate(mergedInvoice.due_date);
    mergedInvoice.amount = toNullableNumber(mergedInvoice.amount);
    mergedInvoice.vat_amount = toNullableNumber(mergedInvoice.vat_amount);
    mergedInvoice.merchant = mergedInvoice.merchant || null;
    mergedInvoice.category = mergedInvoice.category || null;
    mergedInvoice.supplier = (mergedInvoice.supplier || "").toString().trim() || null;
    mergedInvoice.invoice_number = (mergedInvoice.invoice_number || "").toString().trim() || null;

    try {
      const inserted = await insertInvoice(mergedInvoice);
      let storedFile = null;
      if (inserted?.id) {
        try {
          storedFile = await insertFile({
            owner_type: "invoice",
            owner_id: inserted.id,
            file_ref: fileRef || null,
            original_filename: req.file.originalname || null,
            mime_type: req.file.mimetype || null,
            file_size: req.file.size || null,
            file_hash: fileHash,
          });
        } catch (fileErr) {
          console.error("Failed to insert file metadata", fileErr);
        }
      }
      return res.json({
        success: true,
        status: "ok",
        message: "File uploaded",
        needs_review: needsReview,
        file: {
          originalName: req.file.originalname,
          storedName: req.file.filename,
          storedPath: req.file.path,
          source: "Upload",
        },
        invoice: inserted,
        file_ref: fileRef ?? null,
        file_record: storedFile,
      });
    } catch (err) {
      console.error("Upload insert error:", err);
      return res.status(500).json({ error: "Upload failed to save invoice" });
    }
  } catch (err) {
    console.error("Error in /api/upload-invoice:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

app.post("/api/upload-receipt", requireAppKey, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      console.warn("Receipt upload attempted with no file");
      return res.status(400).json({ error: "No file uploaded" });
    }
    const fileRef = buildLocalFileRef(req.file);

    console.log("Receipt upload received:", {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      path: req.file.path,
      size: req.file.size,
    });

    const uploadedBuffer = await fs.promises.readFile(req.file.path);
    const fileHash = crypto.createHash("sha256").update(uploadedBuffer).digest("hex");
    const existing = await findFileByHash("receipt", fileHash);
    if (existing) {
      return res.json({ duplicate: true, existingOwnerId: existing.owner_id, fileId: existing.id });
    }

    const now = new Date().toISOString();
    const baseReceipt = {
      supplier: "Receipt upload",
      invoice_number: req.file.originalname,
      issue_date: null,
      due_date: null,
      amount: null,
      status: "Needs info",
      category: "Uncategorised",
      source: "Upload",
      week_label: null,
      archived: 0,
      doc_type: "receipt",
      file_kind: "image",
      merchant: null,
      vat_amount: null,
      approved_at: null,
      approved_by: null,
      created_at: now,
      updated_at: now,
      file_ref: fileRef,
    };

    let aiResult = null;
    try {
      aiResult = await extractReceiptFromImage(req.file.path);
      console.log("Receipt AI extraction result:", aiResult);
    } catch (err) {
      console.error("AI receipt extraction failed:", err);
    }

    const merged = { ...baseReceipt };
    if (aiResult && typeof aiResult === "object") {
      merged.merchant = aiResult.merchant || merged.merchant;
      merged.issue_date = aiResult.issue_date || merged.issue_date;
      merged.amount = typeof aiResult.amount === "number" && !Number.isNaN(aiResult.amount) ? aiResult.amount : merged.amount;
      merged.vat_amount =
        typeof aiResult.vat_amount === "number" && !Number.isNaN(aiResult.vat_amount) ? aiResult.vat_amount : merged.vat_amount;
      if (typeof aiResult.confidence === "number" && aiResult.confidence >= 0.75) {
        merged.status = "Captured";
      }
      merged.week_label = merged.issue_date ? `Week of ${merged.issue_date}` : merged.week_label;
    }

    merged.file_ref = fileRef ?? merged.file_ref;

    try {
      const inserted = await insertReceipt(merged);
      let storedFile = null;
      if (inserted?.id) {
        try {
          storedFile = await insertFile({
            owner_type: "receipt",
            owner_id: inserted.id,
            file_ref: fileRef || null,
            original_filename: req.file.originalname || null,
            mime_type: req.file.mimetype || null,
            file_size: req.file.size || null,
            file_hash: fileHash,
          });
        } catch (fileErr) {
          console.error("Failed to insert file metadata", fileErr);
        }
      }
      return res.json({
        status: "ok",
        message: "Receipt uploaded",
        file: {
          originalName: req.file.originalname,
          storedName: req.file.filename,
          storedPath: req.file.path,
          source: "Upload",
        },
        invoice: inserted,
        file_ref: fileRef ?? null,
        file_record: storedFile,
      });
    } catch (err) {
      console.error("Receipt upload insert error:", err);
      return res.status(500).json({ error: "Upload failed to save receipt" });
    }
  } catch (err) {
    console.error("Error in /api/upload-receipt:", err);
    return res.status(500).json({ error: "Receipt upload failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Cashflow backend listening on http://127.0.0.1:${PORT}`);
});

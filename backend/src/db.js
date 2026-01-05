const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "..", "data", "cashflow.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);

const CREATE_INVOICES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT,
  invoice_number TEXT,
  issue_date TEXT,
  due_date TEXT,
  amount REAL,
  status TEXT,
  category TEXT,
  source TEXT,
  week_label TEXT,
  doc_type TEXT DEFAULT 'invoice',
  file_kind TEXT DEFAULT 'pdf',
  merchant TEXT,
  vat_amount REAL,
  file_hash TEXT,
  doc_kind TEXT DEFAULT 'invoice',
  needs_review INTEGER DEFAULT 0,
  confidence REAL,
  extracted_source TEXT,
  extracted_json TEXT,
  notes TEXT,
  approved_at TEXT,
  approved_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  file_ref TEXT,
  archived INTEGER DEFAULT 0
)`;

const CREATE_TIPS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tip_date TEXT,
  method TEXT,
  amount REAL,
  note TEXT,
  customer_name TEXT,
  staff_name TEXT,
  created_at TEXT,
  updated_at TEXT,
  archived INTEGER DEFAULT 0
)`;

const CREATE_FILES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  file_ref TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,
  created_at TEXT,
  updated_at TEXT,
  file_hash TEXT,
  archived INTEGER DEFAULT 0
)`;

const CREATE_AUTO_APPROVAL_RULES_SQL = `
CREATE TABLE IF NOT EXISTS auto_approval_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL,
  monthly_limit REAL NOT NULL,
  created_at TEXT
)`;

const CREATE_STAFF_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
)`;

const seedInvoices = [
  {
    supplier: "Northwind Utilities",
    invoice_number: "NW-2025-001",
    issue_date: "2025-08-25",
    due_date: "2025-09-10",
    amount: 820,
    status: "Paid",
    category: "Utilities",
    source: "Email",
    week_label: "Week of 08 Sep 2025",
  },
  {
    supplier: "BrightHire",
    invoice_number: "BH-2025-002",
    issue_date: "2025-09-20",
    due_date: "2025-10-05",
    amount: 1840,
    status: "Paid",
    category: "Staff",
    source: "Email",
    week_label: "Week of 06 Oct 2025",
  },
  {
    supplier: "CloudNova",
    invoice_number: "CN-2025-003",
    issue_date: "2025-09-10",
    due_date: "2025-09-25",
    amount: 1200,
    status: "Paid",
    category: "Software",
    source: "Upload",
    week_label: "Week of 22 Sep 2025",
  },
  {
    supplier: "Streamline Legal",
    invoice_number: "SL-2025-004",
    issue_date: "2025-10-01",
    due_date: "2025-10-20",
    amount: 950,
    status: "Paid",
    category: "Other",
    source: "Upload",
    week_label: "Week of 13 Oct 2025",
  },
  {
    supplier: "Harbor Office",
    invoice_number: "HO-2025-005",
    issue_date: "2025-10-20",
    due_date: "2025-11-05",
    amount: 640,
    status: "Overdue",
    category: "Rent",
    source: "Email",
    week_label: "Week of 03 Nov 2025",
  },
  {
    supplier: "PixelOps Design",
    invoice_number: "PO-2025-006",
    issue_date: "2025-10-30",
    due_date: "2025-11-14",
    amount: 1200,
    status: "Overdue",
    category: "Marketing",
    source: "Upload",
    week_label: "Week of 10 Nov 2025",
  },
  {
    supplier: "Supplier X",
    invoice_number: "SX-2025-007",
    issue_date: "2025-11-05",
    due_date: "2025-11-24",
    amount: 3200,
    status: "Due soon",
    category: "Other",
    source: "Upload",
    week_label: "Week of 24 Nov 2025",
  },
  {
    supplier: "ClearLine Telecom",
    invoice_number: "CT-2025-008",
    issue_date: "2025-11-10",
    due_date: "2025-11-28",
    amount: 480,
    status: "Upcoming",
    category: "Utilities",
    source: "Email",
    week_label: "Week of 24 Nov 2025",
  },
  {
    supplier: "Lumina Analytics",
    invoice_number: "LA-2025-009",
    issue_date: "2025-11-20",
    due_date: "2025-12-06",
    amount: 2100,
    status: "Upcoming",
    category: "Software",
    source: "Email",
    week_label: "Week of 08 Dec 2025",
  },
  {
    supplier: "DemoCo",
    invoice_number: "DC-2025-010",
    issue_date: "2025-11-25",
    due_date: "2025-12-15",
    amount: 2500,
    status: "Upcoming",
    category: "Uncategorised",
    source: "Upload",
    week_label: "Week of 15 Dec 2025",
  },
  {
    supplier: "KALYAN AI",
    invoice_number: "KA-2026-011",
    issue_date: "2025-12-20",
    due_date: "2026-01-15",
    amount: 743,
    status: "unpaid",
    category: "Utilities",
    source: "Upload",
    week_label: "Week of 12 Jan 2026",
  },
  {
    supplier: "The Spa by Kaajal Consulting",
    invoice_number: "KAC-2026-012",
    issue_date: "2026-01-10",
    due_date: "2026-02-10",
    amount: 1500,
    status: "Upcoming",
    category: "Services",
    source: "Upload",
    week_label: "Week of 09 Feb 2026",
  },
];

db.serialize(() => {
  db.run(CREATE_INVOICES_TABLE_SQL);
  db.all("PRAGMA table_info(invoices);", (err, rows) => {
    if (err) {
      console.error("Failed to read table info for invoices", err);
      return;
    }
    const existingColumns = new Set(rows.map((r) => r.name));
    const addColumnIfMissing = (name, sql) => {
      if (existingColumns.has(name)) return;
      db.run(sql, (alterErr) => {
        if (alterErr) {
          console.error(`Failed to add column ${name}`, alterErr);
        } else {
          console.log(`Added column ${name}`);
        }
      });
    };

    addColumnIfMissing("doc_type", "ALTER TABLE invoices ADD COLUMN doc_type TEXT DEFAULT 'invoice'");
    addColumnIfMissing("file_kind", "ALTER TABLE invoices ADD COLUMN file_kind TEXT DEFAULT 'pdf'");
    addColumnIfMissing("merchant", "ALTER TABLE invoices ADD COLUMN merchant TEXT");
    addColumnIfMissing("vat_amount", "ALTER TABLE invoices ADD COLUMN vat_amount REAL");
    addColumnIfMissing("approved_at", "ALTER TABLE invoices ADD COLUMN approved_at TEXT");
    addColumnIfMissing("approved_by", "ALTER TABLE invoices ADD COLUMN approved_by TEXT");
    addColumnIfMissing("created_at", "ALTER TABLE invoices ADD COLUMN created_at TEXT");
    addColumnIfMissing("updated_at", "ALTER TABLE invoices ADD COLUMN updated_at TEXT");
    addColumnIfMissing("file_ref", "ALTER TABLE invoices ADD COLUMN file_ref TEXT");
    addColumnIfMissing("notes", "ALTER TABLE invoices ADD COLUMN notes TEXT");
    addColumnIfMissing("file_hash", "ALTER TABLE invoices ADD COLUMN file_hash TEXT");
    addColumnIfMissing("doc_kind", "ALTER TABLE invoices ADD COLUMN doc_kind TEXT DEFAULT 'invoice'");
    addColumnIfMissing("needs_review", "ALTER TABLE invoices ADD COLUMN needs_review INTEGER DEFAULT 0");
    addColumnIfMissing("confidence", "ALTER TABLE invoices ADD COLUMN confidence REAL");
    addColumnIfMissing("extracted_source", "ALTER TABLE invoices ADD COLUMN extracted_source TEXT");
    addColumnIfMissing("extracted_json", "ALTER TABLE invoices ADD COLUMN extracted_json TEXT");

    db.run("UPDATE invoices SET doc_type = 'invoice' WHERE doc_type IS NULL");
    db.run("UPDATE invoices SET file_kind = 'pdf' WHERE file_kind IS NULL");
    if (existingColumns.has("doc_kind")) {
      db.run("UPDATE invoices SET doc_kind = 'invoice' WHERE doc_kind IS NULL");
    }
    if (existingColumns.has("file_hash")) {
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_file_hash ON invoices(file_hash)");
    }
  });
  db.run(CREATE_TIPS_TABLE_SQL);
  db.all("PRAGMA table_info(tips);", (err, rows) => {
    if (err) {
      console.error("Failed to read table info for tips", err);
      return;
    }
    const existingColumns = new Set(rows.map((r) => r.name));
    const addColumnIfMissing = (name, sql) => {
      if (existingColumns.has(name)) return;
      db.run(sql, (alterErr) => {
        if (alterErr) {
          console.error(`Failed to add column ${name}`, alterErr);
        } else {
          console.log(`Added column ${name}`);
        }
      });
    };

    addColumnIfMissing("tip_date", "ALTER TABLE tips ADD COLUMN tip_date TEXT");
    addColumnIfMissing("method", "ALTER TABLE tips ADD COLUMN method TEXT");
    addColumnIfMissing("amount", "ALTER TABLE tips ADD COLUMN amount REAL");
    addColumnIfMissing("note", "ALTER TABLE tips ADD COLUMN note TEXT");
    addColumnIfMissing("customer_name", "ALTER TABLE tips ADD COLUMN customer_name TEXT");
    addColumnIfMissing("staff_name", "ALTER TABLE tips ADD COLUMN staff_name TEXT");
    addColumnIfMissing("created_at", "ALTER TABLE tips ADD COLUMN created_at TEXT");
    addColumnIfMissing("updated_at", "ALTER TABLE tips ADD COLUMN updated_at TEXT");
    addColumnIfMissing("archived", "ALTER TABLE tips ADD COLUMN archived INTEGER DEFAULT 0");
  });
  db.run(CREATE_FILES_TABLE_SQL);
  db.all("PRAGMA table_info(files);", (err, rows) => {
    if (err) {
      console.error("Failed to read table info for files", err);
      return;
    }
    const existingColumns = new Set(rows.map((r) => r.name));
    const addColumnIfMissing = (name, sql) => {
      if (existingColumns.has(name)) return;
      db.run(sql, (alterErr) => {
        if (alterErr) {
          console.error(`Failed to add column ${name}`, alterErr);
        } else {
          console.log(`Added column ${name}`);
        }
      });
    };

    addColumnIfMissing("file_hash", "ALTER TABLE files ADD COLUMN file_hash TEXT");
    db.run("CREATE INDEX IF NOT EXISTS idx_files_owner_type_hash ON files(owner_type, file_hash)");
  });
  db.run("CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_type, owner_id)");
  db.run(CREATE_AUTO_APPROVAL_RULES_SQL);
  db.run(CREATE_STAFF_TABLE_SQL);
  db.all("PRAGMA table_info(staff);", (err, rows) => {
    if (err) {
      console.error("Failed to read table info for staff", err);
      return;
    }
    const existingColumns = new Set(rows.map((r) => r.name));
    const addColumnIfMissing = (name, sql) => {
      if (existingColumns.has(name)) return;
      db.run(sql, (alterErr) => {
        if (alterErr) {
          console.error(`Failed to add column ${name}`, alterErr);
        } else {
          console.log(`Added column ${name}`);
        }
      });
    };

    addColumnIfMissing("name", "ALTER TABLE staff ADD COLUMN name TEXT UNIQUE");
    addColumnIfMissing("active", "ALTER TABLE staff ADD COLUMN active INTEGER DEFAULT 1");
    addColumnIfMissing("created_at", "ALTER TABLE staff ADD COLUMN created_at TEXT");
    addColumnIfMissing("updated_at", "ALTER TABLE staff ADD COLUMN updated_at TEXT");
  });
  db.get("SELECT COUNT(*) as count FROM invoices", (err, row) => {
    if (err) {
      console.error("Failed to read invoice count", err);
      return;
    }
    if (row.count === 0) {
      const stmt = db.prepare(
        `INSERT INTO invoices (supplier, invoice_number, issue_date, due_date, amount, status, category, source, week_label, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      );
      seedInvoices.forEach((inv) => {
        stmt.run(
          inv.supplier,
          inv.invoice_number,
          inv.issue_date,
          inv.due_date,
          inv.amount,
          inv.status,
          inv.category,
          inv.source,
          inv.week_label
        );
      });
      stmt.finalize();
      console.log("Seeded invoices table with demo data");
    }
  });
});

const getInvoices = ({ includeArchived = false } = {}) =>
  new Promise((resolve, reject) => {
    let sql = "SELECT *, COALESCE(CAST(archived AS INTEGER), 0) AS archived FROM invoices";
    if (!includeArchived) {
      sql += " WHERE COALESCE(CAST(archived AS INTEGER), 0) = 0";
    }
    db.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const findInvoiceById = (id) =>
  new Promise((resolve, reject) => {
    db.get("SELECT * FROM invoices WHERE id = ?", [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const findTipById = (id) =>
  new Promise((resolve, reject) => {
    db.get("SELECT * FROM tips WHERE id = ?", [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const findStaffById = (id) =>
  new Promise((resolve, reject) => {
    db.get("SELECT * FROM staff WHERE id = ?", [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const findFileById = (id) =>
  new Promise((resolve, reject) => {
    db.get("SELECT * FROM files WHERE id = ?", [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const findFileByRef = (file_ref) =>
  new Promise((resolve, reject) => {
    db.get("SELECT * FROM files WHERE file_ref = ?", [file_ref], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const findFileByHash = (owner_type, file_hash) =>
  new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM files WHERE owner_type = ? AND file_hash = ? AND archived = 0 LIMIT 1",
      [owner_type, file_hash],
      (err, row) => {
        if (err) return reject(err);
        resolve(row);
      },
    );
  });

const markInvoicePaid = async (id) => {
  const existing = await findInvoiceById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  await new Promise((resolve, reject) => {
    db.run("UPDATE invoices SET status = 'Paid', updated_at = ? WHERE id = ?", [now, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  return findInvoiceById(id);
};

const archiveInvoice = async (id) => {
  const existing = await findInvoiceById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  await new Promise((resolve, reject) => {
    db.run("UPDATE invoices SET archived = 1, updated_at = ? WHERE id = ?", [now, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  return findInvoiceById(id);
};

const getTips = ({ includeArchived = false } = {}) =>
  new Promise((resolve, reject) => {
    const sql = includeArchived
      ? "SELECT * FROM tips ORDER BY tip_date DESC, id DESC"
      : "SELECT * FROM tips WHERE archived = 0 ORDER BY tip_date DESC, id DESC";
    db.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const getStaff = ({ includeInactive = false } = {}) =>
  new Promise((resolve, reject) => {
    const sql = includeInactive
      ? "SELECT * FROM staff ORDER BY name ASC"
      : "SELECT * FROM staff WHERE active = 1 ORDER BY name ASC";
    db.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const insertStaff = async ({ name }) => {
  const now = new Date().toISOString();
  const trimmed = (name || "").trim();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO staff (name, active, created_at, updated_at)
       VALUES (?, 1, ?, ?)`,
      [trimmed, now, now],
      function (err) {
        if (err) return reject(err);
        const id = this.lastID;
        findStaffById(id)
          .then((row) => resolve(row))
          .catch(reject);
      },
    );
  });
};

const setStaffActive = async (id, active) => {
  const now = new Date().toISOString();
  const value = active ? 1 : 0;
  await new Promise((resolve, reject) => {
    db.run("UPDATE staff SET active = ?, updated_at = ? WHERE id = ?", [value, now, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  return findStaffById(id);
};

const insertTip = async ({ tip_date, method, amount, note, customer_name, staff_name }) => {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO tips (tip_date, method, amount, note, customer_name, staff_name, created_at, updated_at, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [tip_date, method, amount, note ?? null, customer_name ?? null, staff_name ?? null, now, now],
      function (err) {
        if (err) return reject(err);
        const id = this.lastID;
        findTipById(id)
          .then((row) => resolve(row))
          .catch(reject);
      },
    );
  });
};

const updateTip = async (id, fields) => {
  const allowed = ["tip_date", "method", "amount", "note", "customer_name", "staff_name"];
  const keys = allowed.filter((key) => Object.prototype.hasOwnProperty.call(fields, key));
  if (keys.length === 0) return findTipById(id);

  const setClause = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => fields[key]);
  const now = new Date().toISOString();

  await new Promise((resolve, reject) => {
    db.run(`UPDATE tips SET ${setClause}, updated_at = ? WHERE id = ?`, [...values, now, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  return findTipById(id);
};

const archiveTip = async (id) => {
  const existing = await findTipById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  await new Promise((resolve, reject) => {
    db.run("UPDATE tips SET archived = 1, updated_at = ? WHERE id = ?", [now, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  return findTipById(id);
};

const insertInvoice = async (invoice) => {
  const now = new Date().toISOString();
  const createdAt = invoice.created_at || now;
  const updatedAt = invoice.updated_at || now;
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO invoices (supplier, invoice_number, issue_date, due_date, amount, status, category, source, week_label, archived, doc_type, file_kind, merchant, vat_amount, notes, approved_at, approved_by, created_at, updated_at, file_ref, file_hash, doc_kind, needs_review, confidence, extracted_source, extracted_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoice.supplier,
        invoice.invoice_number,
        invoice.issue_date,
        invoice.due_date,
        invoice.amount,
        invoice.status,
        invoice.category,
        invoice.source,
        invoice.week_label,
        invoice.archived ?? 0,
        invoice.doc_type || "invoice",
        invoice.file_kind || "pdf",
        invoice.merchant ?? null,
        invoice.vat_amount ?? null,
        invoice.notes ?? null,
        invoice.approved_at ?? null,
        invoice.approved_by ?? null,
        createdAt,
        updatedAt,
        invoice.file_ref ?? null,
        invoice.file_hash ?? null,
        invoice.doc_kind || "invoice",
        invoice.needs_review ? 1 : 0,
        invoice.confidence ?? null,
        invoice.extracted_source ?? null,
        invoice.extracted_json ?? null,
      ],
      function (err) {
        if (err) return reject(err);
        const id = this.lastID;
        findInvoiceById(id)
          .then((row) => resolve(row))
          .catch(reject);
      },
    );
  });
};

const insertFile = async ({ owner_type, owner_id, file_ref, original_filename, mime_type, file_size, file_hash }) => {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO files (owner_type, owner_id, file_ref, original_filename, mime_type, file_size, created_at, updated_at, file_hash, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        owner_type,
        owner_id,
        file_ref,
        original_filename ?? null,
        mime_type ?? null,
        file_size ?? null,
        now,
        now,
        file_hash ?? null,
      ],
      function (err) {
        if (err) return reject(err);
        const id = this.lastID;
        findFileById(id)
          .then((row) => resolve(row))
          .catch(reject);
      },
    );
  });
};

const getFilesForOwner = ({ owner_type, owner_id, includeArchived = false }) =>
  new Promise((resolve, reject) => {
    const sql = includeArchived
      ? "SELECT * FROM files WHERE owner_type = ? AND owner_id = ?"
      : "SELECT * FROM files WHERE owner_type = ? AND owner_id = ? AND archived = 0";
    db.all(sql, [owner_type, owner_id], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const archiveFile = async (id) => {
  const now = new Date().toISOString();
  await new Promise((resolve, reject) => {
    db.run("UPDATE files SET archived = 1, updated_at = ? WHERE id = ?", [now, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  return findFileById(id);
};

const getRecentInvoicesBySupplier = (supplier, limit = 10) =>
  new Promise((resolve, reject) => {
    db.all(
      "SELECT *, COALESCE(CAST(archived AS INTEGER), 0) AS archived FROM invoices WHERE supplier = ? AND COALESCE(CAST(archived AS INTEGER), 0) = 0 ORDER BY id DESC LIMIT ?",
      [supplier, limit],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      },
    );
  });

const insertAutoApprovalRule = async ({ supplier, monthly_limit }) => {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO auto_approval_rules (supplier, monthly_limit, created_at)
       VALUES (?, ?, ?)`,
      [supplier, monthly_limit, now],
      function (err) {
        if (err) return reject(err);
        const id = this.lastID;
        db.get("SELECT * FROM auto_approval_rules WHERE id = ?", [id], (getErr, row) => {
          if (getErr) return reject(getErr);
          resolve(row);
        });
      },
    );
  });
};

const getAutoApprovalRules = ({ supplier } = {}) =>
  new Promise((resolve, reject) => {
    if (supplier) {
      db.all("SELECT * FROM auto_approval_rules WHERE supplier = ? ORDER BY id DESC", [supplier], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    } else {
      db.all("SELECT * FROM auto_approval_rules ORDER BY id DESC", (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    }
  });

const insertReceipt = async (data) =>
  new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO invoices (supplier, invoice_number, issue_date, due_date, amount, status, category, source, week_label, archived, doc_type, file_kind, merchant, vat_amount, approved_at, approved_by, created_at, updated_at, file_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.supplier,
        data.invoice_number,
        data.issue_date,
        data.due_date,
        data.amount,
        data.status,
        data.category,
        data.source,
        data.week_label,
        data.archived ?? 0,
        data.doc_type,
        data.file_kind,
        data.merchant,
        data.vat_amount,
        data.approved_at,
        data.approved_by,
        data.created_at,
        data.updated_at,
        data.file_ref ?? null,
      ],
      function (err) {
        if (err) return reject(err);
        const id = this.lastID;
        findInvoiceById(id)
          .then((row) => resolve(row))
          .catch(reject);
      },
    );
  });

const updateInvoice = async (id, fields) => {
  const allowed = ["supplier", "invoice_number", "issue_date", "due_date", "amount", "status", "category", "notes", "vat_amount", "needs_review", "confidence", "extracted_source", "extracted_json", "file_hash", "doc_kind"];
  const keys = allowed.filter((key) => Object.prototype.hasOwnProperty.call(fields, key));
  if (keys.length === 0) return findInvoiceById(id);

  const setClause = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => fields[key]);
  const now = new Date().toISOString();

  await new Promise((resolve, reject) => {
    db.run(`UPDATE invoices SET ${setClause}, updated_at = ? WHERE id = ?`, [...values, now, id], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  return findInvoiceById(id);
};

module.exports = {
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
  archiveFile,
  findFileById,
  findFileByRef,
  findFileByHash,
  findInvoiceById,
  getRecentInvoicesBySupplier,
  insertAutoApprovalRule,
  getAutoApprovalRules,
};

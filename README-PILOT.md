# Spa Finance Admin – Pilot Readiness

## Purpose
This document defines the **pilot-ready state** of Spa Finance Admin, what is included, what is intentionally out of scope, and how the system is operated, secured, and rolled back during the pilot.

The goal of the pilot is to validate **real-world usage**, **data integrity**, and **time savings** with minimal operational risk.

---

## Pilot Scope (What This System Does)

### Included
- Tips \& gratuities tracking (manual entry with audit trail)
- Cashflow weekly view (week-by-week payment timeline from invoice due dates)
- Invoice capture via:
  - Manual upload (PDF / image)
  - Email ingestion from IONOS IMAP
- Receipt capture (manual upload)
- Automatic storage of all documents in **Google Drive** (system of record)
- Metadata storage and workflow state in **Supabase**
- Cashflow dashboard with correct totals (excludes unknown amounts)
- Archiving of invoices and receipts
- CSV export (Invoices / Receipts / All)
- JWT-authenticated access via Supabase (Google sign-in)

### Explicitly Out of Scope (Pilot)
- Automatic posting to accounting software (e.g. Xero)
- Auto-approval or auto-payment
- Multi-entity / multi-branch support
- Historical data migration
- Bulk unarchive or delete

---

## Security Posture (Pilot)

### Authentication
- **JWT-only authentication** using Supabase sessions
- All non-public API routes require a valid `Authorization: Bearer <token>`
- Legacy app-key / shared-secret access is **disabled**
- Public routes are limited to:
  - `/health`
  - `/api/health`
  - `/api/version`

### Authorisation Model
- Pilot assumes a **trusted single-business domain**
- User identity is enforced by Supabase Auth
- All actions are attributable to an authenticated user

### API Exposure
- API is only accessible through the application domain
- Direct unauthenticated access returns `401 Unauthorized`

---

## Data Handling & Privacy

### System of Record
- **Google Drive** is the authoritative storage for all documents
- The application stores:
  - Metadata only (supplier, dates, amounts, status)
  - Google Drive file IDs and view links

### Local File Handling
- Uploaded files are written to disk **temporarily only**
- All local files are deleted immediately after success or failure
- No persistent document storage on the server

### Retention
- No documents are retained outside Google Drive
- No email bodies are permanently stored

---

## Email Ingestion (IONOS IMAP)

### Behaviour
- Background worker polls the mailbox on a fixed interval
- Only PDF and image attachments are processed
- Each attachment is uploaded to Google Drive

### Idempotency Guarantees
The system prevents duplicates at multiple layers:
- **Email-level:** unique ingest key per mailbox/message/attachment
- **File-level:** unique hash per document
- **DB-level:** unique constraints prevent duplicate records

Reprocessing the same email or retrying after a timeout **will not** create duplicate invoices.

Manual uploads are treated as intentional user actions and are deduplicated by file hash.

---

## CSV Export

- JWT-protected endpoint
- Modes:
  - Invoices
  - Receipts
  - All
- Accountant-safe output:
  - Blank amounts remain blank (not coerced to £0)
  - `amount_missing` flag included
  - No archived items unless explicitly exported

---

## Operational Readiness

### Deployment
- Backend: Node.js (PM2-managed)
- Frontend: Static build served by Nginx
- Reverse proxy routes `/api` to backend

### Observability
- PM2 process supervision
- Structured logs for ingestion and uploads
- Email ingestion status available via API/UI

---

## Rollback & Recovery

### Code Rollback
- Git-based version control with known stable commits
- Immediate rollback available via:
  ```bash
  cd /home/zax/apps/spa-finance-admin/backend
  git reset --hard <known-good-commit>
  pm2 restart 10 --update-env
Data Safety
No destructive operations during pilot

Archived items are hidden, not deleted

Google Drive retains all original documents

Known Pilot Limitations
Manual upload of a document already ingested via email is allowed once (by design)

No unarchive UI (archived items are intentionally final for pilot)

Limited ingestion summary visibility (operator logs only)

These are intentional constraints to reduce complexity during pilot validation.

Support & Change Control (Pilot)
Changes during pilot are:

Bug fixes only

No schema-breaking changes

No workflow redesign without agreement

Feedback is captured for Post-Pilot Phase 2

Pilot Success Criteria
The pilot is considered successful if:

Invoices and receipts are reliably captured

No duplicate documents are created

Cashflow totals remain accurate

CSV exports are usable by finance/admin

Manual admin time is materially reduced

Status: ✅ Pilot Ready

This system is safe to run in a live business environment for controlled pilot usage.

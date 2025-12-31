Spa Finance Admin — Tasks (Slice 1 + Roadmap)
Status

Current focus: Slice 1 (invoice + receipt capture) stabilisation and production hardening.

Next immediate step when resuming work: Begin Storage Strategy Phase 2 (metadata + safe view/download) design and implementation.

Slice 1 — Must Deliver (Invoice + Receipts Capture)
A) DONE — App Key (Access Control)
- Key gate works locally and via Nginx when the key is sent correctly; GET /api/auth-status added (no secret leakage).
- Settings UI now shows key required/validity (colour-coded), has Save key, and Tips writes include X-APP-KEY with 401-specific messaging.

B) Invoices — Capture + Workflow
- Upload invoice files (PDF/JPG/PNG/DOCX) with extracted fields stored; PATCH edits persist; archive supported. File_ref now stored for new uploads.
- Statuses remain calculated where applicable; archive is soft-delete.

C) Receipts — Capture (Paper Receipts)
- Receipt uploads (JPG/PNG/PDF) store metadata and extracted fields; optional AI extraction; stored separately with doc_type='receipt'. File_ref stored for new uploads.
- Linking to invoices remains optional (future).

D) Weekly Finance Pack (Pilot-level, minimal)
- Due/overdue lists and totals available; export remains CSV-level for now.

Phase 2 — Tips Tab (New Requirement)
E) DONE — Tips Tracking (Cash + Card)
- Tips tab exists; data model includes tip_date, method (cash/card), amount, note, customer_name, staff_name, archived; staff table with active/inactive.
- Form supports customer + received-by dropdown, inline “Add new staff”; totals added (today/week/month + today cash/card split); UI archive via POST /api/tips/:id/archive.

Production Direction — Data Ownership (Google Drive, minimal sensitive data)
F) Storage Strategy — Design Now, Implement Incrementally
- File_ref persisted on uploads (local:uploads/<filename>); storage boundary helper in place. Drive migration remains future work.

G) Files API
- files table added with owner_type/owner_id + metadata; GET /api/invoices/:id/files and /api/receipts/:id/files list rows; GET /api/files/:id/download streams local files (key-gated) and returns 501 for gdrive refs.

H) Modal UX fixes (invoices)
- “Open” now downloads linked files when present; shows “No file attached” or “Google Drive files coming soon” when not available.
- Auto-approval action left as disabled “Coming soon” until backend exists.
- Draft email now copies a prefilled message; amounts/dates guard against NaN (show “—” when missing).

Production Direction — Data Ownership (Google Drive, minimal sensitive data)
F) Storage Strategy — Design Now, Implement Incrementally

Goal: Spa owns and controls files in Google Drive; we store operational metadata only.

Define storage abstraction

Interface for file storage: StorageProvider

put(file) -> { providerId, url?, mime, size }

get(providerId) -> stream/url

delete(providerId)

Implementations:

LocalDiskStorage (current, for dev/testing)

GoogleDriveStorage (production target)

Database changes (metadata-only)

Store:

provider (local | gdrive)

providerFileId

originalFilename

mimeType

size

createdAt

Avoid storing full document content beyond what’s needed.

PII/Sensitive handling

Ensure logs do not print extracted text, full filenames, or invoice contents.

Add redaction rules and document them.

UI/UX and Branding (Later)

Replace “Kalyan AI” placeholders with Spa branding

Theme colours and typography refresh

Navigation and layout polish

Reduce “demo/mock” feel; remove mock fallbacks once stable

Hardening / Ops Tasks

Backend reliability

Health endpoint

PM2 process definition verified

Restart on crash

Nginx routing sanity

Confirm /spa-finance/ serves frontend

Confirm /spa-finance-api/ proxies to backend

CORS / headers

Keep tight in production

Audit trail (lightweight)

Record who/when changed invoice fields (even if only “system/admin” now)

Testing Checklist (Minimum)

App loads without console errors

App key:

wrong key = blocked

right key = allowed

Upload invoice → extracted fields visible

Edit invoice → persists and reload reflects changes

Upload receipt → visible in receipts list

Tips tab:

add cash tip entry

add card tip entry

totals update correctly

Notes / Open Decisions

Which endpoints require X-APP-KEY immediately vs later?

Do we want staff list (users) in Slice 1 or keep staff name as free text?

Receipt linking: required for Slice 1 or Phase 2?

Next steps (practical, ordered)
1) Storage Strategy Phase 2:
   - Persist minimal file metadata (original filename, mime type, size) alongside file_ref
   - Add safe “View/Download” handling for local: refs (and later gdrive:)
   - Define Google Drive provider integration plan (service account vs OAuth, folder structure, permissions)
2) Optional UI admin:
   - Add a simple “Manage staff” section to deactivate/reactivate staff from UI (keep history)
3) Invoice/Receipt workflow completion:
   - Ensure invoice/receipt rows store file metadata + file_ref
   - Confirm allowed upload types and document them
   - Add archive/restore views for invoices/receipts if not already

---

## Deferred / Troubleshooting — API auth key (X-APP-KEY) returning 401

### Goal
Protect `/spa-finance-api/*` with a simple header-based gate (`X-APP-KEY`) using `APP_SHARED_SECRET` in backend `.env`, but keep it human-friendly.

### What we observed
- Initial 401s when testing via Nginx (`https://www.kalyanai.io/spa-finance-api/...`).
- Backend key comparison logic (Express) checks `req.get("x-app-key")` against `process.env.APP_SHARED_SECRET`.
- We successfully got **HTTP 200** at least once when using a key containing an `@` (implying the mechanism can work end-to-end).
- After rotating to a new “human-friendly” passphrase and updating `.env`, curl tests returned **401** again.
- We verified `.env` loads and key exists:
  - `APP_SHARED_SECRET_SET true`
  - `APP_SHARED_SECRET_LEN 15`
  - `APP_REQUIRE_KEY 1`
- A diagnostic run showed `SENT_LEN 0` because the `KEY=...` shell variable was not exported into the Python process environment (so Python saw an empty string). This can lead to misleading diagnostics.

### Likely causes (ranked)
1. **Curl/header quoting issue** when the key contains special characters (or when quotes were omitted), resulting in the header not being sent as expected.
2. **Hidden characters** in the stored key (e.g., trailing `\r` / whitespace from editing), causing mismatch even when it “looks” identical.
3. **Nginx not forwarding the custom header** (less likely, but possible depending on config).
4. **Process/env mismatch** (pm2 not running with the updated `.env` or restart not picking up the new value).

### Next time: quickest, definitive isolation tests
- Bypass Nginx entirely:
  - `curl -i -H 'X-APP-KEY: <key>' http://127.0.0.1:3102/api/invoices`
- Then test through Nginx:
  - `curl -kI -H 'X-APP-KEY: <key>' https://www.kalyanai.io/spa-finance-api/api/invoices`
- Add a temporary debug endpoint (dev-only) that returns whether `x-app-key` header is present (never echo the secret).
- Ensure `.env` line endings are LF and strip trailing whitespace.
- Decide final auth UX: human-friendly passphrase vs autogenerated token; store it once in the UI (localStorage) and provide a “copy key” + “reset key” flow.

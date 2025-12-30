Spa Finance Admin — Tasks (Slice 1 + Roadmap)
Status

Current focus: Slice 1 (invoice + receipt capture) stabilisation and production hardening.

Next immediate step when resuming work: Test App Key (X-APP-KEY) end-to-end across all API routes and UI flows.

Slice 1 — Must Deliver (Invoice + Receipts Capture)
A) App Key (Access Control) — Critical

Validate “App Key required” behaviour

Backend must reject requests without valid X-APP-KEY (where required).

Frontend must:

Prompt/store app key (local storage is fine for now).

Include header in all relevant requests via shared API helper.

Show clear “Not authorised / wrong key” messaging.

Define which endpoints require app key

Read-only endpoints may be allowed without key during pilot, but uploads/edits/actions must require it.

Document the rule in backend README and in context.md.

Automated check

Add a minimal smoke test script (curl examples in README are fine initially).

Later: add a lightweight test file (Node test runner) if time.

B) Invoices — Capture + Workflow

Upload invoice file

Supported types: PDF/JPG/PNG/DOCX (confirm actual allowed list).

Store:

File metadata

Link/path to file

Extracted fields (supplier, invoice number, dates, amount, VAT, category, status)

Source = Upload / Email (even if email ingestion is “later”)

Manual edit / correction

Edit extracted fields in UI

PATCH persists to backend

Ensure TypeScript build has no unused vars; no silent failures

Statuses

Minimum: Captured, Needs info, Ready, Approved

“Overdue / Due soon / Upcoming” can be calculated from due date, but keep status separate.

Archive

Archive invoice (soft remove from default view)

Restore from archive

Deletion rules (if any) should be explicit and safe (prefer soft-delete only for now)

C) Receipts — Capture (Paper Receipts)

Receipt upload flow

Upload photos (JPG/PNG/PDF)

Store metadata + extracted fields:

merchant/supplier

date

amount

VAT (if possible)

payment method (cash/card if known)

category

UI should make “quick corrections” easy.

Receipt–Invoice linking (optional for Slice 1)

Simple association if user selects an invoice and attaches receipt(s).

If not implemented, store separately with a “linkedInvoiceId” nullable.

D) Weekly Finance Pack (Pilot-level, minimal)

“Due this week” list

Overdue list

Totals by category

Export pack

CSV export is enough for Slice 1

PDF export can be later

Phase 2 — Tips Tab (New Requirement)
E) Tips Tracking (Cash + Card)

Add a new top-level tab: Tips

Two entry modes

Cash tips (manual quick entry)

date

staff member (optional first version)

amount

notes (optional)

Card tips tracking

Either manual entry initially, or imported/derived later

Track totals per day/week

Views

Daily totals

Weekly totals

Per-staff totals (optional if staff list exists)

Data model

tips table with:

id

date

amount

method (cash | card)

staffName/staffId (nullable)

createdAt/updatedAt

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


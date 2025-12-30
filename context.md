# Spa Finance Admin — Context

## Purpose
Build a Finance Admin Panel for Spa by Kaajal that centralises invoice + receipt capture, provides an approval workflow (Mo), and produces a weekly finance pack/dashboard — reducing finance admin time and missing receipts, while maintaining strong privacy controls.

This is Slice 1: **Invoice + receipts capture + review + approval queue** (human-in-the-loop; no automatic posting to accounting systems).

## Stakeholders & roles
- **Mo** — Approver / decision maker (final approval).
- **Kaajal / team** — Capture + operational users (upload receipts, manage invoices, track documents).
- **Kalyan AI (Zax)** — Builder/operator during pilot; production will minimise sensitive data storage.

## Problems being solved (from current spreadsheets)
Current operations are tracked across multiple spreadsheets/manual logs:
- Monthly/weekly KPI revenue breakdown (Card transactions, Gift vouchers, Stripe, Deposits used, Tips on card, Cash tips).
- Operational metrics (cancellations, rebooks, bookings, etc.).
- Stock/consumables levels and reorder flags.
- Gift vouchers register (voucher number, amount, notes, date used, remaining balance).
- Tips tracker (cash tips and card tips allocations).
- Staff commission calculations (pay periods, hours, VAT, commission %, tips, amounts paid).

Goal: replace the manual “finance admin” portion with a single capture + workflow system first, and add focused “fast entry” tooling (e.g., Tips) without rebuilding everything at once.

## Slice 1 scope (current build focus)
### In scope
1. **Invoice capture**
   - Upload invoice files (PDF/JPG/PNG/DOCX etc.).
   - Store document metadata (supplier, invoice #, issue/due dates, amount, category, status).
   - Support email-forwarding capture later (inboxes listed below).
2. **Receipt capture (paper receipts e.g., Costco)**
   - Photo upload from phone/desktop.
   - Store receipt metadata (supplier/merchant, date, amount, category, payment method, notes).
3. **Approval workflow**
   - Status pipeline: e.g. Captured → Needs info → Ready → Approved.
   - Mo approval action & audit trail.
4. **Dashboard + weekly finance pack foundation**
   - “Due this week”, “Overdue”, “Upcoming”, totals by week/category.
   - Export/pack generation later (but dashboard must be accurate).
5. **Security gate**
   - App key / shared secret gate for write actions and sensitive reads (pilot-grade access control).

### Explicit near-term additions
- **Tips tab**
  - Fast manual entry for **cash tips**.
  - Track **tips on card** (either manual entry or imported totals initially).
  - Simple reporting: by day/week, by staff member, totals and splits.

### Out of scope (for now)
- Full accounting integration (e.g., Xero posting) without explicit approval.
- Automating stock management/ordering (captured as future roadmap).
- Full rebuild of KPI/commission/voucher tooling (we will add incrementally).

## Operating volumes (pilot assumptions)
- ~20 supplier invoices/month across multiple inboxes.
- ~10 receipts go missing/month currently.
- ~12 hours/week finance admin time between team + Mo.
- Inboxes used today:
  - kaajal@thespabykaajal.com
  - kaajaljk@hotmail.com
  - info@thespabykaajal.com
  - mo@thespabykaajal.co.uk

## Data handling principle (critical)
**Production direction:** do not store sensitive originals long-term on Kalyan AI infrastructure.
- The spa will use **Google Drive** as the system of record for originals (invoices/receipts).
- Our system stores **operational metadata only** (what’s needed for workflow, approvals, and reporting).
- During early build/testing we can continue with SQLite + local file storage, but we must design so switching storage is configuration-based, not a refactor.

### Storage model (target)
- Document metadata stored in DB (SQLite for now; later Postgres possible).
- Original files stored in Google Drive (future), referenced by:
  - `driveFileId`, `driveWebViewLink`, checksum/hash, uploadedBy, timestamps.
- Local files (pilot/testing) stored only as needed and should be easy to disable.

## System architecture (current)
Repo root:
- `/home/zax/apps/spa-finance-admin/`

Backend:
- `/home/zax/apps/spa-finance-admin/backend`
- Node/Express API
- Health endpoint: `/health`
- Reverse-proxied behind Nginx at: `/spa-finance-api`
- Deployed process managed by pm2 (confirm name in pm2 list when needed)

Frontend:
- `/home/zax/apps/spa-finance-admin/frontend`
- Vite/React build
- Static deployed to: `/var/www/spa-finance/`
- Served at: `https://www.kalyanai.io/spa-finance/`

Nginx:
- `/etc/nginx/conf.d/kalyanai-live.conf`
- Must avoid duplicate `server_name` blocks for `www.kalyanai.io` to prevent unpredictable routing.

## Environment & routing rules
- **Production frontend** must call backend via the Nginx path: `/spa-finance-api`
- **Development** may call relative `/api` via Vite proxy (pointing to `127.0.0.1:3102` per current setup).
- All frontend fetches must be centralised through a single API helper (no hard-coded hosts).

## Authentication / App Key
The UI supports an “App key” (shared secret) used for protected actions.
- Next immediate task when we resume: **test the key end-to-end** (frontend sends header; backend enforces; confirm behaviour).

## UX / branding
Current UI is a functional derivative of an existing cashflow UI.
- Later task: redesign theme, colours, naming, and overall UX to match Spa by Kaajal branding.
- Do not block Slice 1 delivery on redesign.

## Working method & guardrails
- Make changes in small, verifiable steps.
- Prefer configuration switches over refactors (especially for Drive migration).
- Add minimal but useful documentation and task tracking (`context.md`, `tasks.md`).
- Keep production stable: validate via curl/health + browser network checks after each deployment.

## Immediate next actions (when we resume)
1. Test App Key behaviour end-to-end (frontend → backend via `/spa-finance-api`).
2. Add `tasks.md` with prioritised backlog (Tips tab, Drive storage abstraction, receipt workflow details, approvals/audit trail, export/weekly pack, UI rebrand).

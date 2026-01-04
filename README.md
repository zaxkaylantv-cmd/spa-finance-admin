# Spa Finance Admin Panel

Slice 1: Invoice + receipt capture with approval workflow.

## Notes (Archive + Dedupe + Auth header)

- Archive behaviour: archiving sets `invoices.archived = 1` (record remains in storage; it is hidden from the UI by default).
- API list: `GET /api/invoices` returns non-archived invoices by default; use `?includeArchived=1` if you ever need archived rows.
- Upload dedupe: uploads compute a SHA-256 hash and will not create a new file/invoice record if the same file is uploaded again (duplicate detection).
- Auth header: when APP_REQUIRE_KEY is enabled, write the shared secret to localStorage under `appKey`; the frontend sends `x-app-key` on API calls.

## Objective and constraints
- Ingest invoices from the IonOS mailbox via IMAP without forwarding.
- Read-only IMAP access; never mutate mailbox state.
- Prioritise robustness: bounded timeouts, conservative polling, no duplicate inserts.

## Current architecture
- Discovery status (`/api/email/status`) uses a lightweight poller to list unseen/sample messages.
- Ingestion worker (optional) runs batch cycles via `runIngestCycle`, respecting backoff and cursor state.
- Supabase tables:
  - `processed_emails`: message/attachment idempotency + status (processed/duplicate/etc.).
  - `email_ingest_state`: cursor/backoff (`last_uid`, `attempts`, `next_retry_at`, `last_error`).
- Attachments are uploaded to Google Drive; `files` table is upserted; `invoices` created with links to Drive.

## Key configuration (.env)
- Enablement: `EMAIL_INGEST_ENABLED`, `EMAIL_INGEST_MODE` (`process`), `EMAIL_INGEST_WORKER` (1 to poll), `EMAIL_INGEST_POLL_SECONDS` (default 120).
- IMAP: `EMAIL_IMAP_HOST/PORT/SECURE/USER/PASS/MAILBOX` (fallback IMAP_*), read-only mode.
- Timeouts/limits: `EMAIL_IMAP_SOCKET_TIMEOUT_MS`, `EMAIL_IMAP_GREETING_TIMEOUT_MS`, `EMAIL_IMAP_AUTH_TIMEOUT_MS`, `EMAIL_IMAP_STEP_TIMEOUT_MS`, `EMAIL_IMAP_SOURCE_TIMEOUT_MS`, `EMAIL_IMAP_UID_SCAN_LIMIT`.
- Manual trigger flag: `EMAIL_INGEST_ALLOW_MANUAL` (default 0) disables `/api/email/run-cycle` in production unless explicitly set to 1 (still requires secret).

## State and idempotency
- Cursor/backoff stored in `email_ingest_state` (`last_uid`, `attempts`, `next_retry_at`, `last_error`).
- Per-attachment idempotency via `processed_emails` keyed on `mailbox`, `message_id`, `attachment_index`, plus `imap_uid`.
- Duplicate file protection via `files.file_hash` (owner_type=invoice) before uploads; duplicates recorded in `processed_emails` with status `duplicate` and skipped.

## Operational runbook
- Verify worker: check pm2 logs (e.g., `pm2 logs 10 --lines 200`) for `[email][worker]` start/end and status lines.
- Force a debug run: temporarily set `EMAIL_INGEST_ALLOW_MANUAL=1`, restart (`pm2 restart 10 --update-env`), call `POST /api/email/run-cycle` with `x-email-ingest-secret`, then revert the flag and restart.
- Inspect Supabase: `email_ingest_state` for cursor/backoff; `processed_emails` for outcomes; `files`/`invoices` for created records.

## Troubleshooting
- Common issues: socket timeout during fetch, schema mismatches (nonexistent columns), attachment detection when MIME is generic.
- Mitigations applied: cleared fetch timers, switched batch path to part downloads (`downloadPartToBuffer`) instead of full message fetch, increased timeouts, bounded batch size (max 1 message), strict logout in `finally`.

## Safety notes
- Documents stored in Drive; DB keeps references/metadata only.
- Batch limits and timeouts prevent long hangs; worker mutex avoids overlap.
- Manual trigger is disabled by default; polling uses conservative caps.
- Scope limited to email ingest components; do not alter other apps or mailboxes.

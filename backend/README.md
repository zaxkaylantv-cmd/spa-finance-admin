## Email ingest flags

- `EMAIL_INGEST_WORKER=1` enables periodic ingest polling when enabled and in process mode.
- `EMAIL_INGEST_ALLOW_MANUAL=1` enables manual `/api/email/run-cycle` trigger (for debugging only).

## Supabase Schema Backups

A schema-only backup of the Supabase `public` schema is kept for reference and recovery.

- Location: `backend/backups/`
- Format: SQL (schema only — no data)
- Source: Supabase Schema Visualizer / pg_dump equivalent
- Naming: `spa-finance-schema-YYYY-MM-DD.sql`

These files are for auditing, diffing, and disaster recovery reference.
They do not affect runtime behaviour.

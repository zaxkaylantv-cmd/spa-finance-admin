# Spa Finance Admin

## Production
- URL: https://spa-finance.kalyanai.io/
- DNS A: spa-finance.kalyanai.io → 185.151.29.141
- Repo: /home/zax/apps/spa-finance-admin
- Backend: Node/Express on 127.0.0.1:3102 (PM2 name spa-finance-admin-backend, id 10)
  - Restart: pm2 restart 10 --update-env
  - Logs: pm2 logs 10 --lines 200
- Frontend build: /home/zax/apps/spa-finance-admin/frontend/dist
- Deploy:
  - sudo rsync -a --delete /home/zax/apps/spa-finance-admin/frontend/dist/ /var/www/spa-finance/
  - sudo restorecon -R /var/www/spa-finance
  - sudo systemctl reload nginx
- Nginx: serves /var/www/spa-finance and proxies /api -> 127.0.0.1:3102 (config: /etc/nginx/conf.d/spa-finance.kalyanai.io.conf)

## Auth
- Supabase Auth (Google, Workspace); frontend uses Supabase client
- Backend requires Supabase JWT (Authorization: Bearer <access_token>) on /api/*; /api/health is public
- Legacy x-app-key disabled (APP_REQUIRE_KEY=0)

## Supabase (system of record)
- Env: SUPABASE_URL, SUPABASE_ANON_KEY (frontend+backend), SUPABASE_SERVICE_ROLE_KEY (backend only)
- Tables: public.invoices (doc_type invoice/receipt), public.files, public.audit_log, public.google_tokens
- google_tokens is server-only via service role; not exposed to clients

## Google Drive storage
- OAuth client + one-time admin connect (Workspace blocks service account JSON)
- Endpoints: GET /api/google/drive/status, /api/google/drive/connect, /api/google/oauth/callback
- Folder: GOOGLE_DRIVE_DOCS_FOLDER_ID=1UOgXJ6Hdox73V76J3zn6F5kRdPvAE-Dl
- Upload contract: Drive upload → upsert public.files (drive_file_id, web_view_link, etc.) → set invoice/receipt file_ref=gdrive:<id> (file_kind=gdrive) → delete local file on success; on failure local file kept and error returned; needs_review still set by AI/validation rules

## Dedupe / idempotency (pilot)
- file_hash computed; dedupe checks Supabase public.files by (owner_type, file_hash)
- Unique indexes: ux_files_owner_type_hash (owner_type, file_hash where file_hash not null); ux_files_drive_file_id (drive_file_id where not null); unique (owner_type, owner_id)

## Local development
- Vite dev: http://localhost:5176/
- API base: relative /api (proxy in dev)

## Runbook
- Drive disconnected: use /api/google/drive/connect to reconnect
- PostgREST schema cache issues after migrations: run `select pg_notify('pgrst','reload schema');`
- Smoke test: login → upload invoice → open Drive preview → re-upload same file (expect duplicate detection)

## Recent commits (known)
- d1c26a6 Fix subdomain API base and add /api/health alias
- 7e9585f Upload docs to Google Drive and enable viewing gdrive files
- [placeholder] Dedupe now checks Supabase public.files by (owner_type, file_hash)

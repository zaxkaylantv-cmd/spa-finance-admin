# Spa Finance Admin — Backend (API)

This is the backend API for the Spa Finance Admin panel.

## Key paths

- Repo root: `/home/zax/apps/spa-finance-admin`
- Backend: `/home/zax/apps/spa-finance-admin/backend`
- Frontend build output (served by Nginx): `/var/www/spa-finance`
- Public URL (frontend): `https://www.kalyanai.io/spa-finance/`
- Public URL (API via proxy): `https://www.kalyanai.io/spa-finance-api/`

## Runtime / Ports

- Backend listens on: `127.0.0.1:3102` (via `PORT=3102`)
- Nginx proxies `/spa-finance-api/` to `http://127.0.0.1:3102/`

## Environment variables

Create/edit `.env` in `backend/`:

- `PORT=3102`
- `APP_SHARED_SECRET=...`  
  Shared secret used for write operations (uploads/edits) when `APP_REQUIRE_KEY=1`.
- `APP_REQUIRE_KEY=1`  
  When `1`, write endpoints require `X-APP-KEY` header matching `APP_SHARED_SECRET`.
- `OPENAI_API_KEY=` (optional)  
  Only needed if using AI extraction features.

Example:

```env
PORT=3102
APP_SHARED_SECRET=CHANGE_ME
OPENAI_API_KEY=
APP_REQUIRE_KEY=1
Install & run (manual)
From the backend folder:

bash
Copy code
cd /home/zax/apps/spa-finance-admin/backend
npm install
npm run dev   # or npm start depending on package.json
Verify locally on the server:

bash
Copy code
curl -s http://127.0.0.1:3102/health
ss -ltnp | grep ':3102' || echo "not listening"
Nginx integration (production)
This backend is intended to be accessed only via Nginx path proxy:

Public path: /spa-finance-api/

Upstream: http://127.0.0.1:3102/

See: /etc/nginx/conf.d/spa-finance.locations.inc (included into the live server block).

Health check through Nginx (SNI-correct local test):

bash
Copy code
curl -kI https://www.kalyanai.io/spa-finance-api/health --resolve www.kalyanai.io:443:127.0.0.1
Write-security model (App Key)
When APP_REQUIRE_KEY=1:

Read endpoints can remain open (as designed)

Write endpoints require request header:

X-APP-KEY: <APP_SHARED_SECRET>

The frontend stores the app key locally (browser localStorage) and sends it on write requests.

Troubleshooting
502 Bad Gateway from /spa-finance-api/...
Backend is not running or not listening on 127.0.0.1:3102

Check:

bash
Copy code
ss -ltnp | grep ':3102' || echo "stopped"
curl -s http://127.0.0.1:3102/health
401/403 on uploads/edits
APP_REQUIRE_KEY=1 requires X-APP-KEY

Confirm frontend has the key set in Settings and that the request includes X-APP-KEY.

Safety note
This system is hosted alongside other KalyanAI apps. Any Nginx changes must be minimal, targeted, and syntax-checked:

bash
Copy code
sudo nginx -t && sudo systemctl reload nginx
Avoid changes to unrelated server blocks or shared paths.

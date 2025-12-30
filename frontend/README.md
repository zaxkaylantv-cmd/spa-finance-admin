## `frontend/README.md` (paste)

```md
# Spa Finance Admin — Frontend (SPA)

This is the frontend Single Page Application for Spa Finance Admin.

## Key paths

- Repo root: `/home/zax/apps/spa-finance-admin`
- Frontend: `/home/zax/apps/spa-finance-admin/frontend`
- Production deploy dir: `/var/www/spa-finance`
- Public URL: `https://www.kalyanai.io/spa-finance/`
- API base (prod via Nginx): `https://www.kalyanai.io/spa-finance-api/`

## API routing model

The frontend must not call the backend by IP/port in production (mixed content + CORS + security).

Production:
- All API calls go to: `/spa-finance-api/...` (same origin)
- Nginx proxies that to: `http://127.0.0.1:3102/`

Development:
- Typically uses Vite dev server + proxy to the backend.
- In this project, dev may use a relative `/api` base and a Vite proxy (see `vite.config.*` if present).

## App Key (write security)

If the backend has `APP_REQUIRE_KEY=1`, the frontend must send `X-APP-KEY` for write operations.
The UI provides an **App Key** field in Settings which is persisted in localStorage.

Expected behaviour:
- Without key: uploads/edits fail (401/403)
- With correct key: uploads/edits succeed

## Build (production)

```bash
cd /home/zax/apps/spa-finance-admin/frontend
npm install
npm run build
Output:

dist/

Deploy to Nginx
Copy the build output to the web root used by Nginx:

bash
Copy code
sudo mkdir -p /var/www/spa-finance
sudo rsync -a --delete /home/zax/apps/spa-finance-admin/frontend/dist/ /var/www/spa-finance/
sudo restorecon -R /var/www/spa-finance
sudo systemctl reload nginx
SNI-correct local tests:

bash
Copy code
curl -kI https://www.kalyanai.io/spa-finance/ --resolve www.kalyanai.io:443:127.0.0.1 | head -n 12
curl -kI https://www.kalyanai.io/spa-finance/assets/ --resolve www.kalyanai.io:443:127.0.0.1
Nginx configuration (reference)
The live site is served by:

/etc/nginx/conf.d/kalyanai-live.conf (server blocks)

Includes this file inside the server_name www.kalyanai.io; TLS server block:

/etc/nginx/conf.d/spa-finance.locations.inc

Current include content (reference):

nginx
Copy code
# Spa Finance Admin — locations include (safe, no server{})

# Serve static SPA (use ^~ so it beats the regex static-file location)
location ^~ /spa-finance/ {
  root /var/www;
  try_files $uri $uri/ /spa-finance/index.html;
}

# Proxy API to backend
location ^~ /spa-finance-api/ {
  proxy_pass http://127.0.0.1:3102/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
SELinux (AlmaLinux)
If the SPA loads but assets return 403/404 inconsistently, confirm SELinux labels:

bash
Copy code
getenforce
ls -ldZ /var/www/spa-finance
sudo restorecon -R /var/www/spa-finance
Troubleshooting
Blank page + 404 for assets
Usually means Nginx is serving index.html but not resolving /spa-finance/assets/....
Confirm the SPA location is root /var/www; and the deploy output exists in:

/var/www/spa-finance/assets/...

Mixed content error in browser devtools
Frontend is attempting to call http://<ip>:<port> from an https:// page.
Fix is to ensure production API base uses /spa-finance-api only.

Safety note
This system shares Nginx with the live website and other apps. Any Nginx changes must be:

isolated to spa-finance.locations.inc and the single include line in kalyanai-live.conf

validated with:

bash
Copy code
sudo nginx -t && sudo systemctl reload nginx

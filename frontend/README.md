# Document & Cashflow Copilot Frontend

React + Vite single-page app with Dashboard, Documents, Cashflow, and Settings tabs. Supports uploading invoices, marking paid/archived, and viewing cashflow summaries (with backend-provided AI summary when available).

## Run locally
1) Install deps: `npm install`
2) Dev server: `npm run dev`
3) Build: `npm run build`
4) Preview build: `npm run preview`

## Backend/API connectivity
- API requests target `/api/...` paths in dev and `/spa-finance-api/api/...` in production (single base, no fallbacks).
- In dev, Vite proxies `/api` to the backend (see `vite.config.ts`).
- Configure hosting to forward `/spa-finance-api` to the backend.

## Deployment notes
- Build output: `dist/`
- Static host should serve the SPA with a fallback for client routing.
- Asset base is relative (`"./"`), so it can be hosted under a subpath; ensure the `/spa-finance-api` proxy is present for API calls.

## Troubleshooting
- API calls failing: likely missing proxy to the backend (ensure `/spa-finance-api` or `/api` is forwarded).
- Upload failures: backend unreachable or proxy misconfigured.
- Seeing only mock data: frontend could not reach the backend and fell back to mock invoices.

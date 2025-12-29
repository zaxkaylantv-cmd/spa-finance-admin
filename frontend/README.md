# Document & Cashflow Copilot Frontend

React + Vite single-page app with Dashboard, Documents, Cashflow, and Settings tabs. Supports uploading invoices, marking paid/archived, and viewing cashflow summaries (with backend-provided AI summary when available).

## Run locally
1) Install deps: `npm install`
2) Dev server: `npm run dev`
3) Build: `npm run build`
4) Preview build: `npm run preview`

## Backend/API connectivity
- API requests target `/api/...` paths via a helper that tries multiple bases; in production it expects a proxy path such as `/cashflow-api`.
- In dev, Vite proxies `/api` to the backend (see `vite.config.ts`).
- Configure hosting to forward `/cashflow-api` to the cashflow backend (default backend port 3002).

## Deployment notes
- Build output: `dist/`
- Static host should serve the SPA with a fallback for client routing.
- Asset base is relative (`"./"`), so it can be hosted under a subpath; ensure the `/cashflow-api` proxy is present for API calls.

## Troubleshooting
- API calls failing: likely missing proxy to the backend (ensure `/cashflow-api` or `/api` is forwarded).
- Upload failures: backend unreachable or proxy misconfigured.
- Seeing only mock data: frontend could not reach the backend and fell back to mock invoices.

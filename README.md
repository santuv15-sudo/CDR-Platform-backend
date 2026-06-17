# CSI CDR Backend NestJS

This is the NestJS backend replacement for the original `backend/` Next.js API service. It preserves the same public API paths so the existing frontend can point `BACKEND_API_URL` at this service.

## Local Setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run db:setup
npm run dev
```

The service listens on `PORT`, defaulting to `8080`.

Uploads accept `.csv`, `.xlsx`, and `.xlsm`. Legacy `.xls` is intentionally rejected in this NestJS backend because the common SheetJS parser has unresolved high-severity advisories; convert `.xls` files to `.xlsx` or `.csv` before upload.

## Scripts

- `npm run dev`: Nest watch mode.
- `npm run build`: compile to `dist/`.
- `npm start`: run `dist/main.js`.
- `npm test`: parser/helper tests.
- `npm run db:migrate`: apply SQL migrations.
- `npm run db:setup`: migrations plus demo mapping/users.

## API Compatibility

The following paths are preserved:

- Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`.
- Admin: `/api/admin/users`, `/api/admin/mapping`.
- Ingest: `/api/ingest/mapping`, `/api/ingest/cdr`, `/api/ingest/batches`, `/api/ingest/issues`, `DELETE /api/ingest/batches/:id`.
- Analytics: `/api/metrics/kpis`, `/daily`, `/hourly`, `/branches`, `/manager`, `/agents`, `/agents/:id`, `/cdr-records`, `/recovery`, `/health`, `/coaching`, `/coverage`, `/quality`, `/filters`.
- Exports: `/api/exports/cdr`, `/api/exports/branch-health`, `/api/exports/agent-coaching`.
- Health: `GET /healthz`, `GET /readyz`.

## Frontend Switch

Set the frontend environment to this service:

```bash
BACKEND_API_URL=http://localhost:8080
```

The frontend keeps using its same-origin proxy and HTTP-only `csi_token` cookie.

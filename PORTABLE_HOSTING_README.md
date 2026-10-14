# MAYAVI CARGO — COMPLETE SOURCE BACKUP AND HOSTING GUIDE

Backup date: 2026-10-14
Working application source commit: `92db8a2c25d322bad3be10a09f4942a14fb9d126`
Production source branch when frozen: `v2-clean-scratch`
Stable archived branch: `backup/mayavi-portable-2026-10-14`

This archive contains the complete tracked project source at the commit above: Next.js pages, dashboards, Import, Export, Other Countries, Speed Post, OCR, airline-specific trackers, auth, cron routes, browser bridge, tests, Vercel configuration, and package definitions. The frozen-column divider has a softer border and lighter shadow; the functional airline and Speed Post tracking code is otherwise preserved.

**Important: A source ZIP is not a database backup.** Production shipment records, users, password hashes, Speed Post ED entries, stored data, and private API/environment credentials live outside the GitHub repository. They are NOT included here. Preserve the database and secret configuration separately to run the same project with the same live data.

## Running on another provider

This is a **server-side Next.js application**, not a static HTML website. Pick a hosting service that runs an always-on or sufficiently long-running **Node.js 24.x** application (Linux recommended) and supports server-side API routes and outbound website/browser requests. Some airline trackers and OCR functions use `puppeteer-core`, `@sparticuz/chromium`, and `tesseract.js`; ensure that the host permits headless Chromium and has suitable CPU, RAM, executable filesystem/binaries, and long request timeouts. Some carrier websites may limit automated tracking on a new host/IP. Do not assume identical live results without testing.

1. Extract the ZIP, open a terminal inside the extracted project directory.
2. Install Node.js 24.x and npm.
3. Run `npm install` to install packages from `package.json` (network access needed).
4. Copy `.env.example` to `.env.local` and set the real environment values privately. Do **not** commit a filled `.env.local` to Git.
5. To retain existing shipments, configure `DATABASE_URL` to use the **same existing Neon Postgres database** (with authorization and secure network connection). To move to a new database, obtain and restore a separate PostgreSQL dump, including tables, rows, users, and schema. Arrange this directly via your database provider; it is not part of this source ZIP.
6. Run `npm run build`. This also runs the existing frozen-airline and Speed Post OCR regression checks.
7. Run `npm start` (Next.js serves on port 3000 by default). In production, configure the hosting service's start command as `npm start`, route traffic to the application port, and enable HTTPS, a persistent service, and your domain.
8. Test sign-in, existing shipment rows, Weight from TrackParcel, EMS tariffs, Import/Export, and the active airline trackers before switching DNS.
9. Set up external cron/scheduler jobs as below. `vercel.json` is a reference for these schedules; most other hosts **do not execute Vercel Cron automatically**.

## Private environment variables

* `DATABASE_URL` — Neon/Postgres connection URL. Existing code accepts alternative names `POSTGRES_URL`, `NEON_DATABASE_URL`, or `DATABASE_URL_UNPOOLED`.
* `MAYAVI_SESSION_SECRET` — strong, random private secret for authentication sessions. Keep unchanged when possible during cutover.
* `MAYAVI_ADMIN_KEY` — existing admin/internal key where used. Keep secret.
* `CRON_SECRET` — strong, random shared secret sent to protected scheduled endpoints as `Authorization: Bearer YOUR_CRON_SECRET`.

These values are deployment-specific and are intentionally NOT included. Read each new host's environment-variable setup documentation; do not place secrets into the public ZIP.

## Scheduled jobs (UTC, copied from vercel.json)

| Schedule | Endpoint | Purpose |
|---|---|---|
| `0 */3 * * *` | `/api/cron/refresh` | Import/Export master tracking updates |
| `0 19 * * *` | `/api/cron/monthly-archive` | Monthwise archives |
| `*/30 * * * *` | `/api/cron/ethiopian` | Ethiopian tracking updates |
| `15 */3 * * *` | `/api/cron/speedpost` | Speed Post updates |

Keep the same UTC schedule and appropriate authentication header on the new host. For example, a secure external scheduler can call a route using HTTPS with `Authorization: Bearer $CRON_SECRET`. Never expose the secret in a public URL or source file. Some routes have different authorization behaviors; inspect each route before enabling external schedules.

## What is inside / outside this backup

Included: tracked source code at the frozen commit, `package.json`, the original `vercel.json` as reference, browser bridge, test scripts, all airline integrations and Speed Post OCR.

Not included: `node_modules`, server runtime/binary installations, Vercel deployment settings or projects, domain/DNS ownership, Neon/Postgres database dump or live entries, live passwords/keys, external third-party services, private assets/files never committed to this repository.

For an exact migration of production **data**, take a database backup or securely reuse the existing database first. Keep the original Vercel site running until login, rows, scheduled refreshes, and key airline/Speed Post results are verified on the new provider.

## Source integrity

Full application code was copied from GitHub commit `92db8a2c25d322bad3be10a09f4942a14fb9d126`. Only portable-hosting documentation was added on this archival branch. Do not develop directly on the archival branch; create a new branch/copy for future changes.

# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-10-05

### Added

- SCORM package validator and auto-fixer (`src/lib/scorm/`): safe ZIP
  handling with zip-slip/zip-bomb guards, imsmanifest.xml parsing and
  rewriting, SCORM version/sequencing detection, scormtype correction,
  launch-file case correction, title normalization. 30 unit tests against
  5 fixture manifests plus an inline SCORM-2004-without-sequencing case.
- Upload pipeline: `POST /api/uploads/init` (server-side size + Free-tier
  limit enforcement) and `PUT /api/uploads/:packageId/file` (upload routed
  through the Worker to R2, atomic Free-tier counter increment, enqueues
  the processing message). Presigned direct-to-R2 upload was in the
  original design but needs separate R2 API credentials we don't have
  set up yet — revisit if bulk/larger uploads need it.
- Queue consumer (`src/lib/queue-consumer.ts`): validates, fixes, uploads
  the fixed ZIP, records issues, and updates job/package status, with
  per-message retry on unexpected failures so one bad package doesn't
  retry the whole batch.
- Jobs API: `GET /api/jobs`, `GET /api/jobs/:id` (packages + issues, for
  progress polling), `GET /api/jobs/:id/download/:packageId`,
  `DELETE /api/jobs/:id`.
- Real `/app` upload UI: dropzone, live job progress polling, per-package
  issue list and download, recent-uploads history.
- `MAX_PACKAGE_SIZE_BYTES` config var (default 50MB).

## [0.1.0] - 2026-10-05

### Added

- Repo scaffold: Cloudflare Workers (Hono) + static-asset frontend, D1
  (Drizzle ORM), R2 (EU jurisdiction), Queues, and cron trigger bindings in
  `wrangler.toml`.
- Initial D1 schema and migration: better-auth core tables, better-auth's
  organization plugin tables (orgs / members / invitations), and app tables
  for subscriptions, usage counters, jobs, packages, package issues, audit
  log, contact-sales leads, and the connector framework stub.
- Authentication via better-auth: email + password with required email
  verification, magic-link sign-in, and the organization plugin for
  Enterprise roles — all emailed through SendGrid.
- Server-side middleware skeletons: `requireAuth`, `resolvePlanTier` /
  `requirePlan`, `requireOrgRole`, `requireAdmin` (founder-only allowlist).
- React landing page (problem → how it works → pricing → FAQ → contact
  form wired to `/api/contact-sales`), `/pricing`, `/sign-in`, `/sign-up`,
  authenticated `/app`, `/account`, `/admin` shells, and placeholder legal
  pages (Impressum, Datenschutzerklärung, Terms) marked with explicit TODOs
  pending legal review.
- `GET /api/usage`, `POST /api/contact-sales`, `GET /api/admin/ping`,
  `GET /api/health`.
- `.github/workflows/deploy.yml`: on push to `main`, applies D1 migrations
  and deploys to Cloudflare Workers using a repo-level `CLOUDFLARE_API_TOKEN`
  secret and `CLOUDFLARE_ACCOUNT_ID` variable — no token ever shared outside
  GitHub's own secret store.

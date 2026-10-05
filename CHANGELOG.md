# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

# SENtoArc

Validates and auto-fixes SCORM packages exported from SAP Enable Now (SEN)
so they import cleanly into WalkMe Learning Arc (SCORM 1.2 only).

Not affiliated with SAP SE or WalkMe Inc. See the in-app footer for the full
trademark disclaimer.

## Stack

All-Cloudflare: Workers (Hono) + D1 (Drizzle ORM) + R2 (EU jurisdiction) +
Queues, with a React/Vite/Tailwind frontend served as static assets from the
same Worker. Auth is [better-auth](https://www.better-auth.com) (email +
password, magic link, and its organization plugin for Enterprise
roles). Payments are Stripe Checkout + Customer Portal + webhooks. Email is
sent via SendGrid.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in secrets
npm run db:migrate:local         # applies migrations/ to a local D1
npm run dev                      # wrangler dev, serves API + built frontend
npm run dev:frontend              # vite dev server with /api proxied to wrangler dev
```

## Project layout

```
src/
  index.ts              Worker entry: fetch / queue / scheduled handlers
  routes/                Hono route modules, mounted under /api
  middleware/             requireAuth, requirePlan, requireOrgRole, requireAdmin
  lib/
    auth/                 better-auth configuration
    db/                   Drizzle schema + D1 client
    email/                SendGrid sender
    scorm/                validator/fixer (Phase 2)
    billing/               Stripe client (Phase 3)
  frontend/               React app (landing, /app, /pricing, /account, /admin)
migrations/               Numbered D1 SQL migrations (applied via wrangler, not drizzle-kit's own runner)
test/fixtures/manifests/  Sample imsmanifest.xml fixtures for validator/fixer tests (Phase 2)
```

## Status

Phase 1 (repo setup, D1/R2/Queues bindings, auth, landing page) is in
progress — see `CHANGELOG.md`. Upload/validate/fix, billing, and
organizations land in later phases per the roadmap agreed with the project
owner.

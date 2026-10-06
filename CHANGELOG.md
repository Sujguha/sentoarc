# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.7.0] - 2026-10-06

### Added

- Data retention is now actually enforced -- `scheduled()` in
  `src/index.ts` was a literal stub (`console.log("scheduled cron
  fired")`) since the original scaffold; the 24h-Free/30-day-Pro
  retention named in `wrangler.toml`'s vars and the pricing copy was
  never backed by any code, so nothing ever purged old jobs from D1 or
  R2. New `src/lib/retention.ts`:
  - `computeRetentionExpiresAt`: called at job creation (both
    `/api/uploads/init` and `/api/uploads/bulk/init`, using the tier
    already resolved there) to stamp `job.retentionExpiresAt` --
    computed once at creation, not at completion, so a job that never
    finishes processing still gets cleaned up on schedule.
  - `purgeExpiredJobs`: deletes every job (and its packages, issues, R2
    objects) whose `retentionExpiresAt` has passed. A job created
    before this shipped has `retentionExpiresAt = NULL` and is left
    alone rather than purged immediately.
  - `sweepAbandonedUploads`: separately cleans up a reservation
    (`POST .../init` ran, the file's `PUT` never did) stuck at
    `job.status = "queued"` past a fixed 1-hour grace period --
    doesn't wait out the full tier retention window, since there's no
    real uploaded data there to begin with.
  - `deleteJobAndArtifacts` (the actual deletion logic) is shared with
    `DELETE /api/jobs/:id`, which used to duplicate it inline.
  - The hourly cron (`wrangler.toml`'s existing `[triggers]`) now calls
    both sweeps instead of logging a placeholder string.
  - 11 new tests against real D1/R2 bindings
    (`test/retention.test.ts`); verified live that `retentionExpiresAt`
    is actually populated on a real upload
    (`e2e-upload-test.yml`) -- the cron's own firing isn't practical to
    trigger on demand against a deployed Worker, so that side relies on
    the unit tests against the same D1/R2 bindings the cron itself uses.

## [0.6.0] - 2026-10-06

### Fixed

- **Critical**: every package that actually needed a manifest fix (not
  the "pass"-through case) has likely been failing silently in
  production since 0.3.2. `buildFixedZipStream` produces a plain
  `ReadableStream` with no declared length; R2's single-shot `put()`
  rejects that outright ("must have a known length") -- workerd is the
  same engine locally and in production, so this wasn't a test-only
  quirk. "pass" packages were unaffected (they reuse the original
  bytes verbatim, a `Uint8Array`, never touching this code path),
  which is why the 0.3.2 perf-test verification didn't catch it: those
  fixtures apparently didn't need an actual rewrite. Found while adding
  a test that exercises the translation-path fix end-to-end through R2
  (below) -- the first test to do that for *any* fix rule.
  `queue-consumer.ts` now uploads a streamed `fixedZip` via R2
  multipart upload instead (buffered into >= 5MiB parts, so memory
  stays bounded regardless of package size); a plain `Uint8Array`
  still goes through `put()` directly. New regression test
  (`test/queue-consumer.test.ts`) uploads a fixed package through the
  real pipeline and reads it back from R2 to confirm it round-trips.

### Added

- Translation-path rewrite (Pro/Enterprise only), the last gap the
  pricing-page audit found with zero backing code. `validator.ts`
  gains an opt-in check (`checkTranslationPaths`, off by default so
  Free-tier results are unchanged): every `<file>` a resource declares
  under a locale folder (`en-US/`, `de_DE/`, etc.) -- not just the
  launch href, which was already covered for every tier -- is checked
  against the package's actual contents. A path/case mismatch is
  fixed (rewritten to the real path); a translated asset that's
  entirely missing is reported as an unfixable error, same convention
  as a missing launch file. `fixer.ts`/`queue-consumer.ts` thread the
  option through, resolving the job owner's tier the same way the
  ZIP-of-ZIPs bulk-upload gate does. New fixtures
  (`translation-path-mismatch.xml`, `translation-asset-missing.xml`)
  and tests at the validator, fixer, and queue-consumer levels.

## [0.5.1] - 2026-10-06

### Added

- CSV report export (Pro/Enterprise only), closing another gap the
  pricing-page audit found: "CSV report export" had zero backing code
  before this. `GET /api/jobs/:id/export.csv`, gated by the same
  `requirePlan(["pro","enterprise"])` bulk upload now uses. One row per
  package: filename, status, input/output format, size, error message,
  and a `|`-joined summary of its issues. `/app` shows an "Export CSV"
  link next to the report for Pro/Enterprise accounts. New tests cover
  the CSV field/row escaping (commas, quotes, newlines).

## [0.5.0] - 2026-10-06

### Added

- Bulk upload is now real (Pro/Enterprise-gated), closing the gap found
  auditing the pricing page against the actual code: "Bulk upload" and
  "Single packages only" were marketing copy with no backing logic
  before this.
  - `POST /api/uploads/bulk/init`: multiple files selected at once,
    gated by `requirePlan(["pro","enterprise"])` (previously-dead-code
    middleware, now actually wired in). Creates one job with N package
    rows; each file is PUT through the existing per-package upload
    endpoint.
  - ZIP-of-ZIPs: uploading a single ZIP whose own entries are
    themselves whole `.zip` files (two or more, at the top level) is
    now auto-detected (`detect.ts`'s new `zip-of-zips` type) and
    expanded by the queue consumer into one package per inner ZIP,
    each processed through the normal validate/fix pipeline. Free-tier
    uploads of this shape fail cleanly with an upgrade prompt rather
    than being silently mishandled; the gate is enforced in the queue
    consumer itself (tier is resolved from D1 via a new
    `resolvePlanTierFor`, shared with the request-time middleware)
    since the container/bundle shape is only knowable after inspecting
    the uploaded bytes, not at upload time.
  - `/app` upload UI: multi-file selection is offered only to
    Pro/Enterprise accounts (native file input's `multiple` attribute);
    Free accounts keep the existing single-file picker, consistent with
    "single packages only".
  - New tests: `test/require-plan.test.ts` (tier resolution +
    `requirePlan` gating — previously untested entirely) and
    `test/queue-consumer.test.ts` (ZIP-of-ZIPs expansion, both the
    free-tier rejection and the pro-tier expand-then-process path).

## [0.4.1] - 2026-10-06

### Changed

- Real Pro pricing: EUR 19/month, EUR 190/year, replacing the EUR
  29/290 placeholder. Stripe Prices are immutable once created, so
  this created two new Prices on the existing Pro Product and archived
  (not deleted) the old two via a new one-off workflow
  (`.github/workflows/update-stripe-pricing.yml`) -- the Product and
  webhook endpoint were left untouched to avoid duplicating either.
  `STRIPE_PRICE_ID_MONTHLY`/`STRIPE_PRICE_ID_YEARLY` updated in
  `wrangler.toml` accordingly.

## [0.4.0] - 2026-10-06

### Added

- Phase 3: Stripe Checkout, Billing Portal, and webhook-driven Pro
  subscriptions. `requirePlan`/`resolvePlanTier` needed no changes --
  they already read tier from the `subscription` table, so wiring
  Stripe in was purely additive.
  - `POST /api/billing/checkout`: creates a Stripe Checkout session for
    the Pro price (monthly or yearly), reusing the user's existing
    Stripe customer if they have one. Seats fixed at 1 -- multi-seat
    stays the Enterprise contact-sales flow, not self-serve.
  - `POST /api/billing/portal`: Stripe Billing Portal session so Pro
    customers manage/cancel their own subscription.
  - `POST /api/billing/webhook`: verifies the Stripe signature (Workers
    needs the async + SubtleCrypto verification path, not Node's
    crypto) and is the *only* thing that ever writes to the
    `subscription` table -- plan tier is never taken from a client.
    Syncs `checkout.session.completed` / `customer.subscription.updated`
    / `customer.subscription.deleted`.
  - Account page: Upgrade to Pro (monthly/yearly) for Free users,
    Manage billing for Pro users.
  - Test infra: vitest-pool-workers' D1 instance had no schema applied,
    so any test touching `env.DB` would have failed outright --
    wired up `applyD1Migrations` against the real migration files (the
    same ones `deploy.yml` applies). 6 new tests cover webhook signature
    verification and the subscription-row sync.
  - Provisioned via a one-off workflow
    (`.github/workflows/provision-stripe.yml`): created the Pro Product
    and two Prices in a Stripe Sandbox, registered the webhook endpoint,
    and pushed `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` to Cloudflare
    as Worker secrets.
  - Pricing is a placeholder (€29/month, €290/year) pending a real
    decision -- trivial to change later in the Stripe dashboard, no
    code change needed.
  - Verified live (`.github/workflows/e2e-billing-test.yml`): Checkout
    returns a real `checkout.stripe.com` session URL (`cs_test_...`,
    confirming Sandbox/test mode, not live), the Portal route correctly
    refuses a user with no Stripe customer yet (`400
    no_stripe_customer`), and the webhook route is live and rejects
    unsigned requests (`400 missing_signature`).

## [0.3.2] - 2026-10-05

### Fixed

- A performance test (`.github/workflows/perf-test.yml`) against the live
  deployment found that any package above a few MB never finished
  processing: the Worker hit Cloudflare's CPU-time limit and/or its
  128MB-per-invocation memory ceiling, and Queues kept silently retrying
  the same message forever, leaving the job stuck at "Processing…" with
  no error ever surfacing. Root cause: `fixPackage` always fully
  decompressed *and* recompressed every file in the package, even when
  nothing needed to change (the common "pass" case) — and the only file
  whose content fixer.ts ever actually rewrites is imsmanifest.xml.
  - `zip-utils.ts`: added `listZipEntries` (entry names + declared sizes
    straight from the central directory, no inflation at all) and
    `decompressSingleEntry` (inflate exactly one named entry), used by
    `detect.ts`/`validator.ts` instead of fully unzipping just to check
    names or read the manifest.
  - `fixPackage`'s "pass" case now returns the original uploaded bytes
    verbatim — no rebuild. Its "fixed" case uses a new
    `buildFixedZipStream`: a streaming rebuild (fflate's `Unzip`/`Zip`
    push APIs) that replaces only the manifest entry and pipes every
    other entry's already-compressed bytes straight through, chunked to
    bound memory regardless of package size.
  - `wrapper.ts`: PDF/MP4/PPTX (already-compressed formats) are now
    embedded as STORED zip entries instead of being wastefully deflated
    again — that redundant compression pass was the other half of the
    measured CPU blowup (hit on the 95MB PDF wrap case specifically).
  - Tried adding an explicit `limits.cpu_ms` in `wrangler.toml` as extra
    margin, but Cloudflare rejected the deploy: CPU limits require a
    paid Workers plan, and this account is on the Free plan. Reverted —
    the streaming rewrite above is what actually fixes this, not a
    configured limit, so it isn't needed.
  - Verified live: re-ran the same perf-test cases against the deployed
    fix. All four now complete cleanly (2MB: 17s, 30MB: 22s, 95MB SCORM:
    33s, 95MB PDF: 36s — previously the 30MB and both 95MB cases never
    finished at all), with no CPU/memory errors in the Worker logs.

### Investigated

- Re-checked whether WalkMe exposes a public API that could automate the
  SCORM-into-Learning-Arc import step (the manual step the "Open WalkMe
  Learning Arc" button exists to shortcut — see 0.3.1). WalkMe does have
  a real public REST API (`api.walkme.com`, OAuth2 client-credentials
  auth) — that part of the earlier assessment was outdated. But walking
  its full documented surface (every category in both the JavaScript API
  and REST API navigation: Systems, User Provisioning/SCIM, Data
  Platform, Multi-Language API v1/v2, Discovery Apps, Self-Hosted,
  Checksum, Activity Log, End User Update, Workstation Notification,
  Segments (Beta), WalkMe Access API) turned up nothing for Learning Arc,
  courses, or SCORM content. The API's entire surface is core-platform
  guidance content, account/user administration, and translation
  import/export — Learning Arc isn't on it. Conclusion: no automation
  path exists today through documented means; keeping the current button
  as-is until that changes (e.g. WalkMe adds Learning Arc API coverage,
  or confirms a private/partner API exists via direct contact — neither
  checked here, both would need to come from WalkMe directly).

## [0.3.1] - 2026-10-05

### Added

- "Open WalkMe Learning Arc" button next to each completed package's
  download, opening WalkMe's own app in a new tab so the next step (drag
  the downloaded file into Import SCORM) needs no menu-hunting. Links to
  the account base URL only (`app.learningarc.com`) — not a deep link to
  the Assets/Import-SCORM screen itself, since that exact path hasn't
  been confirmed from a real account. No automated upload: WalkMe has no
  confirmed public API for this and credential-based UI automation was
  explicitly ruled out (ToS risk, credential-storage liability, breaks on
  every WalkMe UI change, incompatible with SSO/MFA anyway).

## [0.3.0] - 2026-10-05

### Added

- Accept non-SCORM uploads (PDF, MP4, PPTX, HTML/ZIP of web content) and
  auto-package them into a SCORM 1.2 course instead of rejecting them:
  - `detect.ts`: content-sniffs the upload (magic bytes / ZIP structure)
    rather than trusting the filename extension.
  - `scormapi-runtime.ts`: a standard SCORM 1.2 API-discovery JS shim
    (walks the parent/opener window chain for `window.API`), shared by
    every generated launch page.
  - `wrapper.ts`: generates a full package (manifest + launch page +
    content) per type — video auto-completes on the `ended` event,
    everything else uses a manual "Mark as Complete" button. PPTX does
    **not** render slides (that needs a real conversion engine, a new
    dependency decision) — v1 links out to download the file instead.
  - Every wrapper's output is validated against our own existing SCORM
    validator in tests (dogfooding), the same bar a real SEN export is
    held to.
  - `package.input_format` tracks what the upload actually was, shown in
    the report.
  - Upload size cap raised to 100MB to accommodate video.
- Landing page and `/app` copy broadened: SEN SCORM fixing is still the
  lead, but packaging arbitrary content into SCORM is now a stated
  capability, not just a fallback.

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

import { env, applyD1Migrations } from "cloudflare:test";

// Runs once before the test suite: brings the in-memory D1 instance used
// by vitest-pool-workers up to the same schema as production, via the
// same migration files deploy.yml applies. Without this, any test that
// touches env.DB hits "no such table" -- see vitest.config.ts for how
// TEST_MIGRATIONS gets populated.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

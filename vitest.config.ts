import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  return {
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Deterministic test-only values for secrets not in
              // wrangler.toml (never committed) -- deliberately NOT
              // shaped like a real Stripe key (GitHub's push protection
              // flags that pattern even for obvious placeholders), since
              // nothing in the test suite calls out to Stripe's API.
              STRIPE_SECRET_KEY: "not-a-real-key--vitest-placeholder",
              STRIPE_WEBHOOK_SECRET: "not-a-real-secret--vitest-placeholder",
              // wrangler.toml leaves this empty (no metered Price exists
              // yet) -- tests need a stable, known value to assert tier
              // resolution picks "metered" for a subscription on this
              // exact price id and "pro" for any other.
              STRIPE_PRICE_ID_METERED: "price_test_metered",
            },
          },
        },
      },
    },
  };
});

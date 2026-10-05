import { Hono } from "hono";
import { createAuth } from "./lib/auth";
import { healthRoute } from "./routes/health";
import { usageRoute } from "./routes/usage";
import { contactSalesRoute } from "./routes/contact-sales";
import { adminRoute } from "./routes/admin";
import { uploadsRoute } from "./routes/uploads";
import { jobsRoute } from "./routes/jobs";
import { processPackageMessage } from "./lib/queue-consumer";
import type { AppBindings } from "./types/hono";
import type { Env, ProcessingQueueMessage } from "./types/env";

const app = new Hono<AppBindings>();

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

app.route("/api/health", healthRoute);
app.route("/api/usage", usageRoute);
app.route("/api/contact-sales", contactSalesRoute);
app.route("/api/admin", adminRoute);
app.route("/api/uploads", uploadsRoute);
app.route("/api/jobs", jobsRoute);

// Everything that isn't /api/* falls through to the static SPA build.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<ProcessingQueueMessage>, env: Env) {
    for (const message of batch.messages) {
      try {
        await processPackageMessage(message.body, env);
      } catch (err) {
        // Terminal outcomes (invalid zip, unfixable manifest) are handled
        // inside processPackageMessage and never throw. Anything that
        // does throw here is unexpected (D1/R2 transient failure) and
        // worth Queues' built-in retry — retried per-message so the rest
        // of the batch isn't punished for one bad package.
        console.error("package-processing message failed", message.body.packageId, err);
        message.retry();
      }
    }
  },

  // Phase 3 adds the retention purge + abandoned-upload-reservation sweep.
  async scheduled(_event: ScheduledEvent, _env: Env) {
    console.log("scheduled cron fired");
  },
};

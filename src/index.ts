import { Hono } from "hono";
import { createAuth } from "./lib/auth";
import { healthRoute } from "./routes/health";
import { usageRoute } from "./routes/usage";
import { contactSalesRoute } from "./routes/contact-sales";
import { adminRoute } from "./routes/admin";
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

// Everything that isn't /api/* falls through to the static SPA build.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  // Phase 2 wires in the real validate/fix pipeline; for now this just
  // proves the binding and batch contract end to end.
  async queue(batch: MessageBatch<ProcessingQueueMessage>, _env: Env) {
    for (const message of batch.messages) {
      console.log("package-processing message received", message.body.type, message.body.packageId);
      message.ack();
    }
  },

  // Phase 3 adds the retention purge + abandoned-upload-reservation sweep.
  async scheduled(_event: ScheduledEvent, _env: Env) {
    console.log("scheduled cron fired");
  },
};

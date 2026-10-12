import { Hono } from "hono";
import type { AppBindings } from "../types/hono";

// Non-sensitive, client-needed config that doesn't belong to any one
// feature's own route file. The Turnstile site key is public by design
// (embedded in every page that renders the widget), so there's nothing
// here that needs auth.
export const publicConfigRoute = new Hono<AppBindings>().get("/", (c) => {
  const turnstileEnabled = c.env.TURNSTILE_ENABLED === "true";
  return c.json({
    turnstileEnabled,
    turnstileSiteKey: turnstileEnabled ? c.env.TURNSTILE_SITE_KEY : null,
  });
});

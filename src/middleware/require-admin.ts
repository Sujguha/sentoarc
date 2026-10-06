import { createMiddleware } from "hono/factory";
import { isFounderEmail } from "../lib/founder-access";
import type { AppBindings } from "../types/hono";

// "Admin" here means the founder's own allowlisted email(s), not an
// organization role — /admin is for the operator of SENtoArc, not customers.
export const requireAdmin = createMiddleware<AppBindings>(async (c, next) => {
  const user = c.get("user");

  if (!isFounderEmail(c.env, user.email)) {
    return c.json({ error: "forbidden" }, 403);
  }

  await next();
});

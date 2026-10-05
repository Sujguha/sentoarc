import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../types/hono";

// "Admin" here means the founder's own allowlisted email(s), not an
// organization role — /admin is for the operator of SENtoArc, not customers.
export const requireAdmin = createMiddleware<AppBindings>(async (c, next) => {
  const user = c.get("user");
  const allowed = c.env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase());

  if (!allowed.includes(user.email.toLowerCase())) {
    return c.json({ error: "forbidden" }, 403);
  }

  await next();
});

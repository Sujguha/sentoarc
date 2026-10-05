import { createMiddleware } from "hono/factory";
import { createAuth } from "../lib/auth";
import type { AppBindings } from "../types/hono";

export const requireAuth = createMiddleware<AppBindings>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  await next();
});

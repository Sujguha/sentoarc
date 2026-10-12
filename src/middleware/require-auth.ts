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
  // The organization plugin (unconditional -- see auth/index.ts) adds
  // activeOrganizationId to the session row at runtime; TypeScript loses
  // that augmentation here only because createAuth's plugins array also
  // conditionally spreads in the captcha plugin, which widens the whole
  // array's inferred type from a tuple to a looser union.
  const activeOrganizationId = (session.session as typeof session.session & { activeOrganizationId?: string | null }).activeOrganizationId;
  c.set("activeOrganizationId", activeOrganizationId ?? null);

  await next();
});

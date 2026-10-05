import { Hono } from "hono";
import { requireAuth } from "../middleware/require-auth";
import { requireAdmin } from "../middleware/require-admin";
import type { AppBindings } from "../types/hono";

export const adminRoute = new Hono<AppBindings>().get(
  "/ping",
  requireAuth,
  requireAdmin,
  (c) => c.json({ ok: true })
);

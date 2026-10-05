import { Hono } from "hono";
import type { AppBindings } from "../types/hono";

export const healthRoute = new Hono<AppBindings>().get("/", (c) =>
  c.json({ status: "ok", service: "sentoarc" })
);

import { Hono } from "hono";
import { createDb } from "../lib/db/client";
import { contactSalesLead } from "../lib/db/schema";
import type { AppBindings } from "../types/hono";

interface ContactSalesBody {
  companyName: string;
  contactName: string;
  email: string;
  companySize?: string;
  message?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const contactSalesRoute = new Hono<AppBindings>().post("/", async (c) => {
  const body = await c.req.json<Partial<ContactSalesBody>>().catch(() => null);

  if (!body?.companyName || !body?.contactName || !body?.email) {
    return c.json({ error: "companyName, contactName, and email are required" }, 400);
  }
  if (!isValidEmail(body.email)) {
    return c.json({ error: "invalid_email" }, 400);
  }

  const db = createDb(c.env.DB);
  await db.insert(contactSalesLead).values({
    id: crypto.randomUUID(),
    companyName: body.companyName,
    contactName: body.contactName,
    email: body.email,
    companySize: body.companySize ?? null,
    message: body.message ?? null,
    status: "new",
    createdAt: new Date(),
  });

  return c.json({ ok: true });
});

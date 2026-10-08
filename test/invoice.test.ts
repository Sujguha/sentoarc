import { describe, expect, it } from "vitest";
import { generateInvoicePdf, invoiceNumberFor } from "../src/lib/billing/invoice";

describe("invoiceNumberFor", () => {
  it("is deterministic for the same purchase", () => {
    const purchase = { id: "abcd1234-ef56-7890-abcd-ef1234567890", packTier: "project_pack" as const, amountCents: 49900, createdAt: new Date("2026-03-14T00:00:00Z") };
    expect(invoiceNumberFor(purchase)).toBe(invoiceNumberFor(purchase));
    expect(invoiceNumberFor(purchase)).toBe("SEN-20260314-ABCD1234");
  });

  it("differs between two different purchases", () => {
    const base = { packTier: "project_pack" as const, amountCents: 49900, createdAt: new Date("2026-03-14T00:00:00Z") };
    const a = invoiceNumberFor({ ...base, id: "aaaaaaaa-0000-0000-0000-000000000000" });
    const b = invoiceNumberFor({ ...base, id: "bbbbbbbb-0000-0000-0000-000000000000" });
    expect(a).not.toBe(b);
  });
});

describe("generateInvoicePdf", () => {
  it("produces a valid PDF for a Project Pack purchase", async () => {
    const bytes = await generateInvoicePdf(
      { id: "abcd1234-ef56-7890-abcd-ef1234567890", packTier: "project_pack", amountCents: 49900, createdAt: new Date("2026-03-14T00:00:00Z") },
      "buyer@example.com"
    );
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("produces a valid PDF for an Enterprise Migration purchase", async () => {
    const bytes = await generateInvoicePdf(
      { id: "ffff1234-ef56-7890-abcd-ef1234567890", packTier: "enterprise", amountCents: 199900, createdAt: new Date("2026-03-14T00:00:00Z") },
      "buyer@example.com"
    );
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });
});

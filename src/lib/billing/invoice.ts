import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Seller details for invoices -- not secrets, so plain constants rather
// than env vars (same reasoning as the hardcoded pack names in
// billing.ts). No VAT ID yet: omitted rather than guessed at, per
// Sujoy's instruction, until one is issued.
const SELLER_NAME = "Sujoy Guha Consulting";
const SELLER_SERVICE_NAME = "SENtoArc";
const SELLER_ADDRESS_LINES = ["Situlistraße 35", "80939 München", "Germany"];
const SELLER_EMAIL = "no-reply@sentoarc.de";

const PACK_LABEL: Record<"project_pack" | "enterprise", string> = {
  project_pack: "SENtoArc Project Pack (100 objects)",
  enterprise: "SENtoArc Enterprise Migration (unlimited objects)",
};

export interface InvoicePurchase {
  id: string;
  packTier: "project_pack" | "enterprise";
  amountCents: number;
  createdAt: Date;
}

// Deterministic from the purchase itself, so re-downloading the same
// invoice later always shows the same number -- no counter to persist.
export function invoiceNumberFor(purchase: InvoicePurchase): string {
  const datePart = purchase.createdAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `SEN-${datePart}-${purchase.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export async function generateInvoicePdf(purchase: InvoicePurchase, customerEmail: string): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  let y = 841.89 - margin;
  const black = rgb(0.12, 0.14, 0.18);
  const gray = rgb(0.4, 0.43, 0.48);

  function text(value: string, x: number, size: number, f = font, color = black) {
    page.drawText(value, { x, y, size, font: f, color });
  }

  text(SELLER_SERVICE_NAME, margin, 20, bold);
  y -= 26;
  text("INVOICE", margin, 14, bold, gray);
  y -= 32;

  text(`Invoice number: ${invoiceNumberFor(purchase)}`, margin, 10, font, gray);
  y -= 14;
  text(`Date: ${purchase.createdAt.toISOString().slice(0, 10)}`, margin, 10, font, gray);
  y -= 32;

  text("From", margin, 10, bold);
  y -= 14;
  text(SELLER_NAME, margin, 10);
  y -= 13;
  for (const line of SELLER_ADDRESS_LINES) {
    text(line, margin, 10);
    y -= 13;
  }
  text(SELLER_EMAIL, margin, 10);
  y -= 28;

  text("Bill to", margin, 10, bold);
  y -= 14;
  text(customerEmail, margin, 10);
  y -= 32;

  const colDesc = margin;
  const colAmount = 595.28 - margin - 80;
  text("Description", colDesc, 10, bold);
  text("Amount", colAmount, 10, bold);
  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 595.28 - margin, y },
    thickness: 0.5,
    color: gray,
  });
  y -= 20;

  text(PACK_LABEL[purchase.packTier], colDesc, 10);
  text(`EUR ${(purchase.amountCents / 100).toFixed(2)}`, colAmount, 10);
  y -= 24;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 595.28 - margin, y },
    thickness: 0.5,
    color: gray,
  });
  y -= 20;

  text("Total", colDesc, 11, bold);
  text(`EUR ${(purchase.amountCents / 100).toFixed(2)}`, colAmount, 11, bold);
  y -= 32;

  text("Paid via Stripe.", margin, 9, font, gray);

  return Uint8Array.from(await doc.save());
}

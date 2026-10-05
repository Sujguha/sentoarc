const SENDGRID_ENDPOINT = "https://api.sendgrid.net/v3/mail/send";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  fromEmail?: string;
  fromName?: string;
}

// TODO: confirm the verified SendGrid sender identity/domain before launch.
const DEFAULT_FROM_EMAIL = "noreply@sentoarc.app";
const DEFAULT_FROM_NAME = "SENtoArc";

export async function sendEmail(apiKey: string, options: SendEmailOptions): Promise<void> {
  const res = await fetch(SENDGRID_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: options.to }] }],
      from: {
        email: options.fromEmail ?? DEFAULT_FROM_EMAIL,
        name: options.fromName ?? DEFAULT_FROM_NAME,
      },
      subject: options.subject,
      content: [{ type: "text/html", value: options.html }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid send failed (${res.status}): ${body}`);
  }
}

const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  fromEmail: string;
  fromName: string;
}

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
        email: options.fromEmail,
        name: options.fromName,
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

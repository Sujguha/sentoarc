import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, organization } from "better-auth/plugins";
import { createDb } from "../db/client";
import { sendEmail } from "../email/sendgrid";
import type { Env } from "../../types/env";

export function createAuth(env: Env) {
  const db = createDb(env.DB);

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_BASE_URL,
    trustedOrigins: [env.APP_BASE_URL],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },

    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env.SENDGRID_API_KEY, {
          to: user.email,
          subject: "Verify your SENtoArc account",
          html: `<p>Confirm your email to finish setting up your SENtoArc account.</p><p><a href="${url}">Verify email</a></p>`,
        });
      },
    },

    // Workers' built-in Rate Limiting binding guards these endpoints too
    // (added in Phase 1 wrangler config once abuse patterns are observed).
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
    },

    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(env.SENDGRID_API_KEY, {
            to: email,
            subject: "Your SENtoArc sign-in link",
            html: `<p>Click to sign in to SENtoArc:</p><p><a href="${url}">Sign in</a></p><p>This link expires shortly and can only be used once.</p>`,
          });
        },
      }),
      // Enterprise orgs + roles (admin / editor / viewer enforced in app code).
      organization({
        creatorRole: "admin",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

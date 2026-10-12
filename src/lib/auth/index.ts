import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, organization, captcha } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { createDb } from "../db/client";
import { sendEmail } from "../email/sendgrid";
import { logAudit } from "../audit";
import { orgAccessControl, orgRoles } from "../org-access-control";
import { isFounderEmail } from "../founder-access";
import type { Env } from "../../types/env";

// Mirrors the client-side check in SignUp.tsx -- enforced here too since
// the UI check alone can be bypassed by calling the API directly.
// "More than 8 characters" -> minimum 9.
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{9,}$/;
// Path -> the body field holding the new/raw password on that endpoint.
const PASSWORD_FIELD_BY_PATH: Record<string, string> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
};

export function createAuth(env: Env) {
  const db = createDb(env.DB);

  // A single array literal (vs. building it up with .push) so TypeScript
  // infers the exact plugin set from this one expression -- the
  // organization plugin's session-field augmentation (activeOrganizationId,
  // used in require-auth.ts) depends on that precise inference and is lost
  // if the array is typed or assembled any more loosely than this.
  const plugins = [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(env.SENDGRID_API_KEY, {
            to: email,
            fromEmail: env.SENDGRID_FROM_EMAIL,
            fromName: env.SENDGRID_FROM_NAME,
            subject: "Your SENtoArc sign-in link",
            html: `<p>Click to sign in to SENtoArc:</p><p><a href="${url}">Sign in</a></p><p>This link expires shortly and can only be used once.</p>`,
          });
        },
      }),
      // Enterprise orgs + roles. admin/editor/viewer semantics are
      // enforced in app code (requireOrgRole, src/middleware); this
      // plugin just needs valid role names for its own invite/membership
      // validation (ac/roles below) and to fire the audit-log hooks.
      organization({
        creatorRole: "admin",
        disableOrganizationDeletion: true,
        ac: orgAccessControl,
        roles: orgRoles,
        // Enterprise ("multiple users with roles") is sales-assisted on
        // the pricing page, not self-serve -- without this, better-auth's
        // default (allowUserToCreateOrganization: true) lets any signed-in
        // user, on any tier, create an org and get the full roles/invite/
        // audit-log experience for free. Only org *creation* is gated
        // here; a customer who's already a member of an org the founder
        // provisioned can still manage it day to day (invite teammates,
        // change roles) through the rest of this same plugin.
        allowUserToCreateOrganization: (user) => isFounderEmail(env, user.email),
        // better-auth's own default for this is already 100 -- set it
        // explicitly rather than relying on that, so the cap is a
        // deliberate decision visible in our own config, not an
        // implicit library default that could silently change.
        // Enforced on both the invite-creation and member-add paths
        // (whichever a given addition goes through), surfacing
        // "Organization membership limit reached" to the inviter.
        membershipLimit: 100,
        sendInvitationEmail: async (data) => {
          const url = `${env.APP_BASE_URL}/accept-invitation?id=${data.invitation.id}`;
          await sendEmail(env.SENDGRID_API_KEY, {
            to: data.email,
            fromEmail: env.SENDGRID_FROM_EMAIL,
            fromName: env.SENDGRID_FROM_NAME,
            subject: `You've been invited to join ${data.organization.name} on SENtoArc`,
            html: `<p>${data.inviter.user.name} invited you to join <strong>${data.organization.name}</strong> on SENtoArc as ${data.role}.</p><p><a href="${url}">Accept invitation</a></p>`,
          });
        },
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, user }) => {
            await logAudit(db, {
              organizationId: org.id,
              actorUserId: user.id,
              action: "organization.created",
              targetType: "organization",
              targetId: org.id,
              metadata: { name: org.name },
            });
          },
          afterAddMember: async ({ member: m, user, organization: org }) => {
            await logAudit(db, {
              organizationId: org.id,
              actorUserId: user.id,
              action: "member.added",
              targetType: "member",
              targetId: m.id,
              metadata: { memberUserId: m.userId, role: m.role },
            });
          },
          afterRemoveMember: async ({ member: m, user, organization: org }) => {
            await logAudit(db, {
              organizationId: org.id,
              actorUserId: user.id,
              action: "member.removed",
              targetType: "member",
              targetId: m.id,
              metadata: { memberUserId: m.userId, role: m.role },
            });
          },
          afterUpdateMemberRole: async ({ member: m, previousRole, user, organization: org }) => {
            await logAudit(db, {
              organizationId: org.id,
              actorUserId: user.id,
              action: "member.role_changed",
              targetType: "member",
              targetId: m.id,
              metadata: { memberUserId: m.userId, previousRole, newRole: m.role },
            });
          },
          afterCreateInvitation: async ({ invitation, inviter, organization: org }) => {
            await logAudit(db, {
              organizationId: org.id,
              actorUserId: inviter.id,
              action: "invitation.created",
              targetType: "invitation",
              targetId: invitation.id,
              metadata: { email: invitation.email, role: invitation.role },
            });
          },
        },
      }),
      // Off until a Turnstile widget exists and both keys are set (see
      // TURNSTILE_ENABLED in env.d.ts) -- auth works unchanged with it
      // off. Spread into this same array literal, not pushed after the
      // fact, so TypeScript's inference of the plugin set (see note
      // above) still covers this branch too.
      ...(env.TURNSTILE_ENABLED === "true"
        ? [
            captcha({
              provider: "cloudflare-turnstile" as const,
              secretKey: env.TURNSTILE_SECRET_KEY,
              endpoints: ["/sign-up/email", "/sign-in/email", "/sign-in/magic-link"],
            }),
          ]
        : []),
  ];

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_BASE_URL,
    trustedOrigins: [env.APP_BASE_URL],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const field = PASSWORD_FIELD_BY_PATH[ctx.path];
        if (!field) return;
        const password = (ctx.body as Record<string, unknown> | undefined)?.[field];
        if (typeof password === "string" && !PASSWORD_COMPLEXITY_REGEX.test(password)) {
          throw new APIError("BAD_REQUEST", {
            message: "Password must be more than 8 characters and include an uppercase letter, a number, and a special character.",
          });
        }
      }),
    },

    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env.SENDGRID_API_KEY, {
          to: user.email,
          fromEmail: env.SENDGRID_FROM_EMAIL,
          fromName: env.SENDGRID_FROM_NAME,
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

    plugins,
  });
}

export type Auth = ReturnType<typeof createAuth>;

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, organization } from "better-auth/plugins";
import { createDb } from "../db/client";
import { sendEmail } from "../email/sendgrid";
import { logAudit } from "../audit";
import { orgAccessControl, orgRoles } from "../org-access-control";
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

    plugins: [
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
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

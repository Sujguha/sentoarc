import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

// Shared by the server auth config (src/lib/auth/index.ts) and the
// frontend auth client (src/frontend/lib/auth-client.ts) so both sides
// agree on the same role definitions -- this module touches nothing
// env/db/Node-specific, safe to import from either.
//
// admin/editor/viewer replace better-auth's default owner/admin/member
// set. This `ac` only governs better-auth's own org-management
// endpoints (invite, remove member, update org, etc.); SENtoArc's own
// semantics (upload vs. view-only) are enforced separately by
// requireOrgRole against the plain `member.role` string in app routes
// -- editor and viewer get identical (minimal) rights here.
export const orgAccessControl = createAccessControl(defaultStatements);

export const adminRole = orgAccessControl.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: [],
  ac: [],
});

export const editorRole = orgAccessControl.newRole({ organization: [], member: [], invitation: [], team: [], ac: [] });
export const viewerRole = orgAccessControl.newRole({ organization: [], member: [], invitation: [], team: [], ac: [] });

export const orgRoles = { admin: adminRole, editor: editorRole, viewer: viewerRole };

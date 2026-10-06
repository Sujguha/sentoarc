import { createAuthClient } from "better-auth/react";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { orgAccessControl, orgRoles } from "../../lib/org-access-control";

export const authClient = createAuthClient({
  plugins: [magicLinkClient(), organizationClient({ ac: orgAccessControl, roles: orgRoles })],
});

export const { useSession, signIn, signOut, signUp } = authClient;

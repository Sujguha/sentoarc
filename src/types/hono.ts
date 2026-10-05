import type { Env } from "./env";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

export interface HonoVariables {
  user: AuthedUser;
  planTier: "free" | "pro" | "enterprise";
}

export interface AppBindings {
  Bindings: Env;
  Variables: HonoVariables;
}

import { describe, expect, it } from "vitest";
import { isFounderEmail } from "../src/lib/founder-access";
import type { Env } from "../src/types/env";

function fakeEnv(adminEmails: string): Env {
  return { ADMIN_EMAILS: adminEmails } as Env;
}

describe("isFounderEmail", () => {
  it("matches an allowlisted email", () => {
    expect(isFounderEmail(fakeEnv("founder@example.com"), "founder@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFounderEmail(fakeEnv("Founder@Example.com"), "founder@example.com")).toBe(true);
    expect(isFounderEmail(fakeEnv("founder@example.com"), "FOUNDER@EXAMPLE.COM")).toBe(true);
  });

  it("rejects an email not on the list", () => {
    expect(isFounderEmail(fakeEnv("founder@example.com"), "customer@example.com")).toBe(false);
  });

  it("supports multiple comma-separated emails with surrounding whitespace", () => {
    const env = fakeEnv("founder@example.com, second-admin@example.com ,third@example.com");
    expect(isFounderEmail(env, "second-admin@example.com")).toBe(true);
    expect(isFounderEmail(env, "third@example.com")).toBe(true);
    expect(isFounderEmail(env, "nobody@example.com")).toBe(false);
  });
});

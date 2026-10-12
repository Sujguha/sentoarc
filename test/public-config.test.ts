import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/public-config", () => {
  it("reports Turnstile's enabled state and site key from env, matching wrangler.toml", async () => {
    const res = await SELF.fetch("https://example.com/api/public-config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turnstileEnabled: boolean; turnstileSiteKey: string | null };
    expect(body.turnstileEnabled).toBe(true);
    expect(body.turnstileSiteKey).toBe("0x4AAAAAAFUVhBI1ddEECbqZ");
  });
});

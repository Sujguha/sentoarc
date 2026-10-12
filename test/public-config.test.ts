import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/public-config", () => {
  it("reports Turnstile as disabled and withholds the site key while it's off", async () => {
    const res = await SELF.fetch("https://example.com/api/public-config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ turnstileEnabled: false, turnstileSiteKey: null });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GatewayAssistantModel } from "../src/server/assistant/gateway-assistant-model";

describe("AI Gateway availability", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("recognizes a Vercel deployment whose OIDC token lives in request context", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(new GatewayAssistantModel().isAvailable()).toBe(true);
  });

  it("requires credentials outside Vercel", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_ENV", "");
    expect(new GatewayAssistantModel().isAvailable()).toBe(false);
  });
});

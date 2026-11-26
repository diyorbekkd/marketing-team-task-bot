import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

describe("API same-origin boundary", () => {
  it("blocks browser mutation requests from another origin", async () => {
    const response = proxy(new NextRequest("https://tasks.example.com/api/tasks", {
      method: "POST",
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-site request blocked." });
  });

  it("allows same-origin browser writes", () => {
    const response = proxy(new NextRequest("https://tasks.example.com/api/tasks", {
      method: "PATCH",
      headers: { origin: "https://tasks.example.com", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows signed server-to-server webhooks without browser headers", () => {
    const response = proxy(new NextRequest("https://tasks.example.com/api/telegram/webhook", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

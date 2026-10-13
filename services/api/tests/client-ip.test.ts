import { describe, expect, it } from "vitest";
import type { HttpRequest } from "../src/http.js";
import { clientIp, clientIpHash, sha256 } from "../src/routes/context.js";

describe("resolved client IP", () => {
  it("uses only the server-resolved address, never public forwarding headers", () => {
    const request: HttpRequest = {
      method: "GET",
      path: "/health",
      requestId: "test",
      sourceIp: "203.0.113.7",
      headers: {
        "x-forwarded-for": "198.51.100.20",
        "x-elixir-drop-viewer-ip": "198.51.100.20",
      },
    };
    expect(clientIp(request)).toBe("203.0.113.7");
    expect(clientIpHash(request)).toBe(sha256("203.0.113.7"));
  });
});

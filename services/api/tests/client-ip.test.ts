import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { clientIp, clientIpHash, sha256 } from "../src/routes/context.js";

const ORIGIN_TOKEN = "private-cloudfront-origin-token";

function request(headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/health",
    rawQueryString: "",
    headers,
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/health",
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.7",
        userAgent: "vitest",
      },
      requestId: "request-client-ip",
      routeKey: "$default",
      stage: "$default",
      time: "22/Aug/2026:08:00:00 +0000",
      timeEpoch: 1_787_408_000_000,
    },
    isBase64Encoded: false,
  };
}

describe("trusted client IP", () => {
  it("uses API Gateway's connection address for direct requests", () => {
    const event = request({
      "x-elixir-drop-viewer-ip": "198.51.100.20",
      "x-elixir-drop-origin": "caller-controlled-value",
    });

    expect(clientIp(event, ORIGIN_TOKEN)).toBe("203.0.113.7");
    expect(clientIpHash(event, ORIGIN_TOKEN)).toBe(sha256("203.0.113.7"));
  });

  it("uses CloudFront's viewer address only with the private origin marker", () => {
    const event = request({
      "X-Elixir-Drop-Viewer-Ip": "198.51.100.20",
      "X-Elixir-Drop-Origin": ORIGIN_TOKEN,
    });

    expect(clientIp(event, ORIGIN_TOKEN)).toBe("198.51.100.20");
  });

  it("accepts IPv6 viewer addresses and fails closed on bad values", () => {
    expect(
      clientIp(
        request({
          "x-elixir-drop-viewer-ip": "2001:db8::7",
          "x-elixir-drop-origin": ORIGIN_TOKEN,
        }),
        ORIGIN_TOKEN,
      ),
    ).toBe("2001:db8::7");

    expect(
      clientIp(
        request({
          "x-elixir-drop-viewer-ip": "not-an-address",
          "x-elixir-drop-origin": ORIGIN_TOKEN,
        }),
        ORIGIN_TOKEN,
      ),
    ).toBe("203.0.113.7");
  });
});

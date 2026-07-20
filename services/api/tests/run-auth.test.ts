import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler } from "../src/handler.js";

function event(
  path: string,
  body: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "18/Jul/2026:00:00:00 +0000",
      timeEpoch: 1_768_000_000_000,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

async function invoke(
  path: string,
  body: Record<string, unknown>,
): Promise<APIGatewayProxyStructuredResultV2> {
  const response = await handler(event(path, body), {} as Context, vi.fn());
  return response as APIGatewayProxyStructuredResultV2;
}

describe("run authentication", () => {
  beforeEach(() => {
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Signed-out callers are no longer rejected at /runs/start or /runs/complete:
  // they play as guests (scored but never recorded). Guest coverage lives in
  // guest-play.test.ts. A /runs/complete carrying a NON-guest run token but no
  // session is still refused, but that path rate-limits first (real DynamoDB),
  // so it is exercised with a mocked Repository in guest-play.test.ts instead.

  it("returns a useful client error for masked email addresses", async () => {
    const response = await invoke("/auth/request", {
      email: "e***@p***.com",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body || "{}")).toEqual({
      error: {
        code: "invalid_request",
        message: "Enter your complete email address, not a masked address.",
      },
    });
  });
});

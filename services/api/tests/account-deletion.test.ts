import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";

const deleteAccount = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    deleteAccount = deleteAccount;
  },
}));

import { handler } from "../src/handler.js";

const secret = "test-session-secret";

function event(confirmation: string): APIGatewayProxyEventV2 {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const session = signToken(
    {
      type: "session",
      sub: "player-sub",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/me",
    rawQueryString: "",
    headers: {
      authorization: `Bearer ${session}`,
      "content-type": "application/json",
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "DELETE",
        path: "/me",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "18/Jul/2026:12:00:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    body: JSON.stringify({ confirmation }),
    isBase64Encoded: false,
  };
}

describe("account deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("requires an exact destructive-action confirmation", async () => {
    const response = (await handler(
      event("delete"),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the authenticated player and returns no replacement session", async () => {
    deleteAccount.mockResolvedValue({ deletedGames: 42 });

    const response = (await handler(
      event("DELETE"),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body || "{}")).toEqual({ ok: true });
    expect(deleteAccount).toHaveBeenCalledWith("player-sub");
  });
});

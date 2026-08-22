import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  publishTinylyticsEvent,
  TINYLYTICS_SITE_ID,
  tinylyticsEventBody,
} from "../src/tinylytics.js";

function request(): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/runs/complete",
    rawQueryString: "",
    headers: {
      "user-agent": "ignored-header-agent",
      "x-forwarded-for": "198.51.100.99",
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/runs/complete",
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.7",
        userAgent: "Safari test agent",
      },
      requestId: "request-tinylytics",
      routeKey: "$default",
      stage: "$default",
      time: "16/Aug/2026:09:00:00 +0000",
      timeEpoch: 1_787_000_000_000,
    },
    isBase64Encoded: false,
  };
}

describe("Tinylytics server events", () => {
  it("uses only low-cardinality event context and API Gateway's trusted client IP", () => {
    expect(
      tinylyticsEventBody(request(), {
        event: "game.completed",
        value: "surge",
        path: "/surge",
      }),
    ).toEqual({
      event: "game.completed",
      value: "surge",
      path: "/surge",
      ip_address: "203.0.113.7",
      user_agent: "Safari test agent",
    });
  });

  it("uses the trusted CloudFront viewer address for same-origin API traffic", () => {
    const event = request();
    event.headers["x-elixir-drop-origin"] = "private-origin-token";
    event.headers["x-elixir-drop-viewer-ip"] = "198.51.100.8";

    expect(
      tinylyticsEventBody(
        event,
        { event: "game.completed", value: "surge", path: "/surge" },
        "private-origin-token",
      ).ip_address,
    ).toBe("198.51.100.8");
  });

  it("posts once with the full-access key kept in the authorization header", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 201 });

    await publishTinylyticsEvent(
      { apiToken: "test-full-access-key" },
      request(),
      {
        event: "account.login_completed",
        value: "returning",
        path: "/login",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://tinylytics.app/api/v1/sites/${TINYLYTICS_SITE_ID}/events`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-full-access-key",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      event: "account.login_completed",
      value: "returning",
      path: "/login",
      ip_address: "203.0.113.7",
      user_agent: "Safari test agent",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("is disabled without a key and never lets delivery failures escape", async () => {
    const disabled = vi.fn();
    await publishTinylyticsEvent(
      {},
      request(),
      { event: "account.login_requested", path: "/login" },
      disabled,
    );
    expect(disabled).not.toHaveBeenCalled();

    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      publishTinylyticsEvent(
        { apiToken: "test-full-access-key" },
        request(),
        { event: "game.personal_best", value: "rain", path: "/rain" },
        async () => ({ ok: false, status: 429 }),
      ),
    ).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith("Tinylytics event delivery failed", {
      event: "game.personal_best",
      statusCode: 429,
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("203.0.113.7");
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      "test-full-access-key",
    );
    warning.mockRestore();
  });
});

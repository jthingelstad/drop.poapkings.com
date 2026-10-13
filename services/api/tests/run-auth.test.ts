import type { HttpRequest, HttpResponse } from "../src/http.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../src/app.js";
function event(path: string, body: Record<string, unknown>): HttpRequest {
  return {
    path,
    headers: { "content-type": "application/json" },
    method: "POST",
    sourceIp: "127.0.0.1",
    requestId: "request-1",
    body: JSON.stringify(body),
  };
}
async function invoke(
  path: string,
  body: Record<string, unknown>,
): Promise<HttpResponse> {
  const response = await dispatch(event(path, body));
  return response as HttpResponse;
}
describe("run authentication", () => {
  beforeEach(() => {
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
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
  it("the retired email sign-in route is gone", async () => {
    const response = await invoke("/auth/request", {
      email: "player@example.com",
    });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body || "{}")).toMatchObject({
      error: { code: "not_found" },
    });
  });
});

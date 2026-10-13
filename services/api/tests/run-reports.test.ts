import { runReference } from "@elixir-drop/contracts";
import type { HttpRequest, HttpResponse } from "../src/http.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";
const repository = vi.hoisted(() => ({
  getRun: vi.fn(),
  upsertRunReport: vi.fn(),
  useRateLimit: vi.fn(),
}));
vi.mock("../src/repository.js", () => ({
  Repository: class {
    getRun = repository.getRun;
    upsertRunReport = repository.upsertRunReport;
    useRateLimit = repository.useRateLimit;
  },
}));
import { dispatch } from "../src/app.js";
const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1000);
function sessionToken(sub = "player-sub"): string {
  return signToken(
    { type: "session", sub, iat: nowSeconds - 60, exp: nowSeconds + 3600 },
    secret,
  );
}
function runToken(
  options: {
    guest?: boolean;
    owner?: string;
  } = {},
): string {
  const owner = options.owner ?? (options.guest ? "guest" : "player-sub");
  return signToken(
    {
      type: "run",
      runId: "run-report-1",
      owner,
      mode: "surge",
      ...(options.guest ? { guest: true } : {}),
      iat: nowSeconds - 300,
      exp: nowSeconds + 3600,
    },
    secret,
  );
}
function event(
  body: Record<string, unknown>,
  authorization?: string,
): HttpRequest {
  return {
    path: "/run-reports",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
    },
    method: "POST",
    sourceIp: "127.0.0.1",
    requestId: "request-1",
    body: JSON.stringify(body),
  } as HttpRequest;
}
function reportBody(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-report-1",
    runToken: runToken(),
    failure: { code: "run_expired", status: 410 },
    client: {
      buildId: "abc123",
      online: true,
      visibility: "visible",
      displayMode: "standalone",
    },
    ...overrides,
  };
}
async function invoke(
  body: Record<string, unknown>,
  authorization?: string,
): Promise<HttpResponse> {
  return (await dispatch(event(body, authorization))) as HttpResponse;
}
describe("run failure reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-report-1",
      sk: "RUN",
      runId: "run-report-1",
      owner: "player-sub",
      mode: "surge",
      challenge: { mode: "surge", cardIds: [] },
      state: "started",
      startedAt: new Date((nowSeconds - 300) * 1000).toISOString(),
      expiresAt: nowSeconds - 1,
    });
    repository.upsertRunReport.mockImplementation((input) =>
      Promise.resolve({
        ...input,
        reportId: "report-1",
        runReference: runReference(input.runId),
      }),
    );
  });
  it("stores a run-bound, identity-free report and optional player context", async () => {
    const response = await invoke(
      reportBody({ context: "The final answer button stopped responding." }),
      sessionToken(),
    );
    const body = JSON.parse(response.body || "{}");
    expect(response.statusCode).toBe(202);
    expect(body).toEqual({
      accepted: true,
      reportId: "report-1",
      runReference: runReference("run-report-1"),
      contextSaved: true,
    });
    const stored = repository.upsertRunReport.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      runId: "run-report-1",
      runReference: runReference("run-report-1"),
      mode: "surge",
      failureCode: "run_expired",
      failureStatus: 410,
      clientBuildId: "abc123",
      clientOnline: true,
      clientVisibility: "visible",
      clientDisplayMode: "standalone",
      runFound: true,
      runState: "started",
      guest: false,
      context: "The final answer button stopped responding.",
    });
    expect(JSON.stringify(stored)).not.toContain("player-sub");
    expect(JSON.stringify(stored)).not.toContain("127.0.0.1");
    expect(JSON.stringify(stored)).not.toContain("vitest");
  });
  it("uses the signed-in owner when the failed run token is invalid", async () => {
    const response = await invoke(
      reportBody({ runToken: "invalid-token" }),
      sessionToken(),
    );
    expect(response.statusCode).toBe(202);
    expect(repository.upsertRunReport).toHaveBeenCalledOnce();
  });
  it("accepts a valid guest run token even after its run row is gone", async () => {
    repository.getRun.mockResolvedValue(undefined);
    const response = await invoke(
      reportBody({ runToken: runToken({ guest: true }) }),
    );
    expect(response.statusCode).toBe(202);
    expect(repository.upsertRunReport).toHaveBeenCalledWith(
      expect.objectContaining({
        guest: true,
        runFound: false,
        runState: "missing",
      }),
    );
  });
  it("rejects an arbitrary run id without a valid run token or owner session", async () => {
    repository.getRun.mockResolvedValue(undefined);
    const response = await invoke(reportBody({ runToken: "invalid-token" }));
    expect(response.statusCode).toBe(403);
    expect(repository.upsertRunReport).not.toHaveBeenCalled();
  });
  it("rejects overlong player context", async () => {
    const response = await invoke(
      reportBody({ context: "x".repeat(1001) }),
      sessionToken(),
    );
    expect(response.statusCode).toBe(400);
    expect(repository.upsertRunReport).not.toHaveBeenCalled();
  });
  it.each([
    ["network_unavailable", 0],
    ["service_unavailable", 503],
  ])(
    "stores retryable %s failures for operational diagnosis",
    async (code, status) => {
      const response = await invoke(
        reportBody({
          failure: { code, status },
        }),
        sessionToken(),
      );
      expect(response.statusCode).toBe(202);
      expect(repository.upsertRunReport).toHaveBeenCalledWith(
        expect.objectContaining({ failureCode: code, failureStatus: status }),
      );
    },
  );
});

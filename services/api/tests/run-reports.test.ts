import { runReference } from "@elixir-drop/contracts";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
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

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);

function sessionToken(sub = "player-sub"): string {
  return signToken(
    { type: "session", sub, iat: nowSeconds - 60, exp: nowSeconds + 3_600 },
    secret,
  );
}

function runToken(options: { guest?: boolean; owner?: string } = {}): string {
  const owner = options.owner ?? (options.guest ? "guest" : "player-sub");
  return signToken(
    {
      type: "run",
      runId: "run-report-1",
      owner,
      mode: "surge",
      ...(options.guest ? { guest: true } : {}),
      iat: nowSeconds - 300,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
}

function event(
  body: Record<string, unknown>,
  authorization?: string,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/run-reports",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/run-reports",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "21/Aug/2026:20:00:00 -0500",
      timeEpoch: nowSeconds * 1_000,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
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
): Promise<APIGatewayProxyStructuredResultV2> {
  return (await handler(
    event(body, authorization),
    {} as Context,
    vi.fn(),
  )) as APIGatewayProxyStructuredResultV2;
}

describe("run failure reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-report-1",
      sk: "RUN",
      runId: "run-report-1",
      owner: "player-sub",
      mode: "surge",
      challenge: { mode: "surge", cardIds: [] },
      state: "started",
      startedAt: new Date((nowSeconds - 300) * 1_000).toISOString(),
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
      reportBody({ context: "x".repeat(1_001) }),
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

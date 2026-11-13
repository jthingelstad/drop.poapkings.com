import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each deployed entry point against the same stand-in Secrets Manager, so the
// fail-closed path is proven through the handlers, not only the loader.
const secretString = vi.hoisted(() => ({ current: "{}" }));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  GetSecretValueCommand: class {},
  SecretsManagerClient: class {
    send = async () => ({ SecretString: secretString.current });
  },
}));

const { dispatch } = await import("../src/app.js");
const { crResultHandler } = await import("../src/cr-results.js");
const { refreshHandler } = await import("../src/refresh-worker.js");
const { resetRuntimeSecretsForTests } =
  await import("../src/runtime-secrets.js");

const request = (path: string) =>
  ({
    method: "GET",
    path,
    headers: {},
    query: {},
    requestId: "test",
  }) as unknown as Parameters<typeof dispatch>[0];

const CREDENTIALS = [
  "SESSION_SECRET",
  "TELEMETRY_PEPPER",
  "ELIXIR_DROP_UPDATES_PUBLISH_TOKEN",
  "ELIXIR_OAUTH_CLIENT_SECRET",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of [...CREDENTIALS, "RUNTIME_SECRET_ID"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.RUNTIME_SECRET_ID = "elixir-drop-runtime";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  resetRuntimeSecretsForTests();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRuntimeSecretsForTests();
  vi.restoreAllMocks();
});

describe("fail closed at each entry point", () => {
  it("the API answers 500 without its credentials, and health still answers", async () => {
    secretString.current = JSON.stringify({ SESSION_SECRET: "only-this" });
    expect((await dispatch(request("/stats"))).statusCode).toBe(500);
    expect((await dispatch(request("/health"))).statusCode).toBe(200);
  });

  it("refresh holds no credential: it runs with the secret empty", async () => {
    process.env.TABLE_NAME ??= "table";
    secretString.current = JSON.stringify({});
    await expect(refreshHandler({ Records: [] })).resolves.toEqual({
      batchItemFailures: [],
    });
  });

  it("cr-results throws without the two names its config needs", async () => {
    secretString.current = JSON.stringify({ ELIXIR_INTEGRATION_KEY: "x" });
    await expect(crResultHandler({ Records: [] })).rejects.toThrow(
      "Runtime secret lacks SESSION_SECRET, TELEMETRY_PEPPER",
    );
  });
});

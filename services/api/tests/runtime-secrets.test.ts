import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_SECRET_KEYS,
  CR_RESULTS_SECRET_KEYS,
  loadRuntimeSecrets,
  resetRuntimeSecretsForTests,
  RUNTIME_SECRET_KEYS,
  runtimeSecretValues,
} from "../src/runtime-secrets.js";

const client = (result: unknown) => ({
  send: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { SecretString: result };
  }),
});

const SECRET_ID = { RUNTIME_SECRET_ID: "elixir-drop-runtime" };

afterEach(() => {
  resetRuntimeSecretsForTests();
  vi.restoreAllMocks();
});

describe("runtime secret", () => {
  it("is a no-op without RUNTIME_SECRET_ID", async () => {
    const secrets = client("{}");
    const env: NodeJS.ProcessEnv = { SESSION_SECRET: "from-env" };
    await loadRuntimeSecrets(API_SECRET_KEYS, { env, client: secrets });
    expect(secrets.send).not.toHaveBeenCalled();
    expect(env.SESSION_SECRET).toBe("from-env");
  });

  it("places the secret's values in the environment and logs names only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { ...SECRET_ID };
    const secrets = client(
      JSON.stringify({
        SESSION_SECRET: "session-value",
        TELEMETRY_PEPPER: "pepper-value",
        // Retired 2026-11-13; still in the secret until Jamie removes it.
        ELIXIR_INTEGRATION_KEY: "retired-value",
        UNKNOWN: "ignored",
      }),
    );
    await loadRuntimeSecrets(CR_RESULTS_SECRET_KEYS, { env, client: secrets });
    expect(env.SESSION_SECRET).toBe("session-value");
    expect(env.TELEMETRY_PEPPER).toBe("pepper-value");
    expect(env.ELIXIR_INTEGRATION_KEY).toBeUndefined();
    expect(env.UNKNOWN).toBeUndefined();
    const line = info.mock.calls[0]![0] as Record<string, string[]>;
    expect(line.fromSecret).toEqual(["SESSION_SECRET", "TELEMETRY_PEPPER"]);
    expect(line.absent).toContain("ELIXIR_OAUTH_CLIENT_SECRET");
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("session-value");
    expect(logged).not.toContain("pepper-value");
    expect(logged).not.toContain("retired-value");
  });

  it("the secret wins over a value already in the environment", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { ...SECRET_ID, SESSION_SECRET: "stale" };
    await loadRuntimeSecrets([], {
      env,
      client: client(JSON.stringify({ SESSION_SECRET: "from-secret" })),
    });
    expect(env.SESSION_SECRET).toBe("from-secret");
  });

  it("fails on a missing required name, naming it, and applies nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { ...SECRET_ID };
    await expect(
      loadRuntimeSecrets(CR_RESULTS_SECRET_KEYS, {
        env,
        client: client(JSON.stringify({ SESSION_SECRET: "session-value" })),
      }),
    ).rejects.toThrow("Runtime secret lacks TELEMETRY_PEPPER");
    expect(env.SESSION_SECRET).toBeUndefined();
    expect(error).toHaveBeenCalledWith({
      event: "runtime_secrets.load_failed",
      error: "missing_required",
      missing: ["TELEMETRY_PEPPER"],
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("session-value");
  });

  it("a value in the environment does not stand in for a missing name", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { ...SECRET_ID, SESSION_SECRET: "stale" };
    await expect(
      loadRuntimeSecrets(CR_RESULTS_SECRET_KEYS, {
        env,
        client: client(JSON.stringify({ TELEMETRY_PEPPER: "pepper" })),
      }),
    ).rejects.toThrow("Runtime secret lacks SESSION_SECRET");
  });

  it("a blank required value counts as missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      loadRuntimeSecrets(["SESSION_SECRET"], {
        env: { ...SECRET_ID },
        client: client(JSON.stringify({ SESSION_SECRET: "  " })),
      }),
    ).rejects.toThrow("Runtime secret lacks SESSION_SECRET");
  });

  it("an unreadable secret fails closed and logs only the error's name", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const denied = Object.assign(new Error("denied"), {
      name: "AccessDeniedException",
    });
    await expect(
      loadRuntimeSecrets(API_SECRET_KEYS, {
        env: { ...SECRET_ID },
        client: client(denied),
      }),
    ).rejects.toThrow("Runtime secret could not be read");
    expect(error).toHaveBeenCalledWith({
      event: "runtime_secrets.load_failed",
      error: "AccessDeniedException",
    });
  });

  it("malformed JSON never carries the secret's text into an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = await loadRuntimeSecrets(API_SECRET_KEYS, {
      env: { ...SECRET_ID },
      client: client('{"SESSION_SECRET": "leak-me'),
    }).catch((caught: unknown) => caught as Error);
    expect((failure as Error).message).toBe("Runtime secret could not be read");
    expect((failure as Error).cause).toBeUndefined();
    expect(JSON.stringify(error.mock.calls)).not.toContain("leak-me");
  });

  it("reads the secret once per container after a success", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { ...SECRET_ID };
    const secrets = client("{}");
    await Promise.all([
      loadRuntimeSecrets([], { env, client: secrets }),
      loadRuntimeSecrets([], { env, client: secrets }),
    ]);
    await loadRuntimeSecrets([], { env, client: secrets });
    expect(secrets.send).toHaveBeenCalledTimes(1);
  });

  it("a failed load is retried, so a brief outage does not poison a container", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { ...SECRET_ID };
    const secrets = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error("throttled"))
        .mockResolvedValue({
          SecretString: JSON.stringify({ SESSION_SECRET: "from-secret" }),
        }),
    };
    await expect(
      loadRuntimeSecrets(["SESSION_SECRET"], { env, client: secrets }),
    ).rejects.toThrow();
    await loadRuntimeSecrets(["SESSION_SECRET"], { env, client: secrets });
    expect(env.SESSION_SECRET).toBe("from-secret");
    expect(secrets.send).toHaveBeenCalledTimes(2);
  });

  it("rejects a secret that is not a JSON object", () => {
    expect(() => runtimeSecretValues("[]")).toThrow(/JSON object/);
    expect(() => runtimeSecretValues("not json")).toThrow();
  });

  it("each function requires what it needs, and only the API all four", () => {
    expect(API_SECRET_KEYS).toEqual(RUNTIME_SECRET_KEYS);
    // Drop's Elixir integration key was retired on 2026-11-13.
    expect(RUNTIME_SECRET_KEYS).toEqual([
      "SESSION_SECRET",
      "TELEMETRY_PEPPER",
      "ELIXIR_DROP_UPDATES_PUBLISH_TOKEN",
      "ELIXIR_OAUTH_CLIENT_SECRET",
    ]);
    expect(CR_RESULTS_SECRET_KEYS).toEqual([
      "SESSION_SECRET",
      "TELEMETRY_PEPPER",
    ]);
  });
});

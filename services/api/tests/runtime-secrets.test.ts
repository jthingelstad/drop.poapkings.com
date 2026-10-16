import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadRuntimeSecrets,
  resetRuntimeSecretsForTests,
  runtimeSecretValues,
} from "../src/runtime-secrets.js";

const client = (result: unknown) => ({
  send: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { SecretString: result };
  }),
});

afterEach(() => {
  resetRuntimeSecretsForTests();
  vi.restoreAllMocks();
});

describe("runtime secret", () => {
  it("is a no-op without RUNTIME_SECRET_ID", async () => {
    const secrets = client("{}");
    const env: NodeJS.ProcessEnv = { SESSION_SECRET: "from-env" };
    await loadRuntimeSecrets({ env, client: secrets });
    expect(secrets.send).not.toHaveBeenCalled();
    expect(env.SESSION_SECRET).toBe("from-env");
  });

  it("prefers the secret and keeps the environment for a name it lacks", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = {
      RUNTIME_SECRET_ID: "elixir-drop-runtime",
      SESSION_SECRET: "from-env",
      TELEMETRY_PEPPER: "pepper-from-env",
    };
    const secrets = client(
      JSON.stringify({ SESSION_SECRET: "from-secret", UNKNOWN: "ignored" }),
    );
    await loadRuntimeSecrets({ env, client: secrets });
    expect(env.SESSION_SECRET).toBe("from-secret");
    expect(env.TELEMETRY_PEPPER).toBe("pepper-from-env");
    expect(env.UNKNOWN).toBeUndefined();
    const line = info.mock.calls[0]![0] as Record<string, string[]>;
    expect(line.fromSecret).toEqual(["SESSION_SECRET"]);
    expect(line.fromEnvironment).toEqual(["TELEMETRY_PEPPER"]);
    expect(line.absent).toContain("ELIXIR_OAUTH_CLIENT_SECRET");
    // Names only: no value reaches the log.
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("from-secret");
    expect(logged).not.toContain("pepper-from-env");
  });

  it("an empty secret leaves every value in the environment", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = {
      RUNTIME_SECRET_ID: "elixir-drop-runtime",
      SESSION_SECRET: "from-env",
    };
    await loadRuntimeSecrets({ env, client: client("{}") });
    expect(env.SESSION_SECRET).toBe("from-env");
  });

  it("a blank value in the secret never overrides the environment", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = {
      RUNTIME_SECRET_ID: "elixir-drop-runtime",
      SESSION_SECRET: "from-env",
    };
    await loadRuntimeSecrets({
      env,
      client: client(JSON.stringify({ SESSION_SECRET: "  " })),
    });
    expect(env.SESSION_SECRET).toBe("from-env");
  });

  it("a failed read keeps serving on the environment and logs no value", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = {
      RUNTIME_SECRET_ID: "elixir-drop-runtime",
      SESSION_SECRET: "from-env",
    };
    const denied = Object.assign(new Error("denied"), {
      name: "AccessDeniedException",
    });
    await loadRuntimeSecrets({ env, client: client(denied) });
    expect(env.SESSION_SECRET).toBe("from-env");
    expect(error).toHaveBeenCalledWith({
      event: "runtime_secrets.load_failed",
      error: "AccessDeniedException",
    });
  });

  it("reads the secret once per container", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = { RUNTIME_SECRET_ID: "elixir-drop-runtime" };
    const secrets = client("{}");
    await Promise.all([
      loadRuntimeSecrets({ env, client: secrets }),
      loadRuntimeSecrets({ env, client: secrets }),
    ]);
    await loadRuntimeSecrets({ env, client: secrets });
    expect(secrets.send).toHaveBeenCalledTimes(1);
  });

  it("rejects a secret that is not a JSON object", () => {
    expect(() => runtimeSecretValues("[]")).toThrow(/JSON object/);
    expect(() => runtimeSecretValues("not json")).toThrow();
  });
});

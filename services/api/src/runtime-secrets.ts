import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

// Drop's credentials live in one Secrets Manager secret, elixir-drop-runtime: a
// JSON object of the env-style names below. Jamie keeps it by hand; no stack
// parameter or function environment carries them (2026-11-04), so no function
// configuration or retained revision holds a copy. The secret is readable only
// by the three function roles. Each container reads it once, before its first
// config read, and places its values in process.env, so config.ts and
// refresh-worker.ts read them unchanged. Values exist only in memory and are
// never logged: the log lines carry names only.
//
// The load fails closed: an unreadable secret, or one missing a name the
// calling function needs, throws. A container caches a successful load only,
// so a transient failure is retried by the next request or message. An edit to
// the secret reaches a container at its next cold start (infra/README.md,
// "Runtime secret").

export const RUNTIME_SECRET_KEYS = [
  "SESSION_SECRET",
  "TELEMETRY_PEPPER",
  "ELIXIR_DROP_UPDATES_PUBLISH_TOKEN",
  "ELIXIR_INTEGRATION_KEY",
  "ELIXIR_MCP_KEY",
  "ELIXIR_OAUTH_CLIENT_SECRET",
] as const;

type RuntimeSecretKey = (typeof RUNTIME_SECRET_KEYS)[number];

// What each function cannot run without. refresh reads the hub keys only.
// cr-results uses no credential itself, but its shared getConfig() refuses to
// start without these two.
export const API_SECRET_KEYS: readonly RuntimeSecretKey[] = RUNTIME_SECRET_KEYS;
export const REFRESH_SECRET_KEYS: readonly RuntimeSecretKey[] = [
  "ELIXIR_INTEGRATION_KEY",
  "ELIXIR_MCP_KEY",
];
export const CR_RESULTS_SECRET_KEYS: readonly RuntimeSecretKey[] = [
  "SESSION_SECRET",
  "TELEMETRY_PEPPER",
];

type SecretsClient = Pick<SecretsManagerClient, "send">;

export interface RuntimeSecretOptions {
  env?: NodeJS.ProcessEnv;
  client?: SecretsClient;
}

let loaded: Promise<void> | undefined;

/** The known names with a non-blank string value; anything else is ignored. */
export function runtimeSecretValues(
  secretString: string | undefined,
): Record<string, string> {
  const parsed: unknown = JSON.parse(secretString ?? "");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Runtime secret is not a JSON object");
  const values: Record<string, string> = {};
  for (const key of RUNTIME_SECRET_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) values[key] = value;
  }
  return values;
}

async function load(
  secretId: string,
  required: readonly RuntimeSecretKey[],
  client: SecretsClient,
  env: NodeJS.ProcessEnv,
) {
  let values: Record<string, string>;
  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    values = runtimeSecretValues(response.SecretString);
  } catch (error) {
    console.error({
      event: "runtime_secrets.load_failed",
      error: error instanceof Error ? error.name : "unknown",
    });
    // The original is dropped: a JSON parse message quotes the secret's text.
    throw new Error("Runtime secret could not be read");
  }
  const missing = required.filter((key) => !(key in values)).sort();
  if (missing.length) {
    console.error({
      event: "runtime_secrets.load_failed",
      error: "missing_required",
      missing,
    });
    throw new Error(`Runtime secret lacks ${missing.join(", ")}`);
  }
  for (const [key, value] of Object.entries(values)) env[key] = value;
  console.info({
    event: "runtime_secrets.loaded",
    fromSecret: Object.keys(values).sort(),
    absent: RUNTIME_SECRET_KEYS.filter((key) => !(key in values)).sort(),
  });
}

/**
 * Settle the runtime secret into the environment once per container, or throw.
 * A no-op when RUNTIME_SECRET_ID is unset (local runs and tests, which set the
 * variables directly); every deployed function sets it, which
 * infra/tests/runtime-secret.test.mjs guards.
 */
export function loadRuntimeSecrets(
  required: readonly RuntimeSecretKey[],
  options: RuntimeSecretOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const secretId = env.RUNTIME_SECRET_ID?.trim();
  if (!secretId) return Promise.resolve();
  loaded ??= load(
    secretId,
    required,
    options.client ?? new SecretsManagerClient({}),
    env,
  ).catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

/** Test seam: forget the settled load. */
export function resetRuntimeSecretsForTests() {
  loaded = undefined;
}

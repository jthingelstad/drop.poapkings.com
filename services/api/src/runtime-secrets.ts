import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

// Drop's credentials are moving out of the function configuration into one
// Secrets Manager secret, elixir-drop-runtime: a JSON object of the env-style
// names below. CloudFormation writes the NoEcho stack parameters into the
// function configuration as plaintext, readable by anyone who can read the
// function and kept in every retained revision; the secret is readable only
// by the three function roles. Each container reads the secret once, before
// its first config read, and places its values in process.env, so config.ts
// and refresh-worker.ts read them unchanged. Values exist only in memory and
// are never logged: the log line carries names only.
//
// Transition (2026-10-16): a name the secret lacks keeps the value the stack
// parameter already put in the environment, and a failed read leaves the
// environment as it is, so the parameters stay the fallback until the secret
// holds every name. Once `runtime_secrets.loaded` reports every name in
// `fromSecret`, the parameters are removed from the template and this load
// fails closed (infra/README.md, "Runtime secret").

export const RUNTIME_SECRET_KEYS = [
  "SESSION_SECRET",
  "TELEMETRY_PEPPER",
  "ELIXIR_DROP_UPDATES_PUBLISH_TOKEN",
  "ELIXIR_INTEGRATION_KEY",
  "ELIXIR_MCP_KEY",
  "ELIXIR_OAUTH_CLIENT_SECRET",
] as const;

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
  client: SecretsClient,
  env: NodeJS.ProcessEnv,
) {
  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    const values = runtimeSecretValues(response.SecretString);
    for (const [key, value] of Object.entries(values)) env[key] = value;
    const rest = RUNTIME_SECRET_KEYS.filter((key) => !(key in values));
    console.info({
      event: "runtime_secrets.loaded",
      fromSecret: Object.keys(values).sort(),
      fromEnvironment: rest.filter((key) => env[key]?.trim()).sort(),
      absent: rest.filter((key) => !env[key]?.trim()).sort(),
    });
  } catch (error) {
    // Transition: keep serving on the values already in the environment.
    console.error({
      event: "runtime_secrets.load_failed",
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

/**
 * Settle the runtime secret into the environment once per container. A no-op
 * when RUNTIME_SECRET_ID is unset (local runs and tests, which set the
 * variables directly).
 */
export function loadRuntimeSecrets(
  options: RuntimeSecretOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const secretId = env.RUNTIME_SECRET_ID?.trim();
  if (!secretId) return Promise.resolve();
  loaded ??= load(
    secretId,
    options.client ?? new SecretsManagerClient({}),
    env,
  );
  return loaded;
}

/** Test seam: forget the settled load. */
export function resetRuntimeSecretsForTests() {
  loaded = undefined;
}

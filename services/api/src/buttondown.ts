import { createHash } from "node:crypto";

export interface ButtondownConfig {
  apiKey?: string;
  newsletterId?: string;
}

type ButtondownFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

function headers(config: Required<ButtondownConfig>): Record<string, string> {
  return {
    Authorization: `Token ${config.apiKey}`,
    "Buttondown-Context": config.newsletterId,
    "Content-Type": "application/json",
  };
}

function configured(
  config: ButtondownConfig,
): Required<ButtondownConfig> | undefined {
  if (!config.apiKey || !config.newsletterId) return undefined;
  return config as Required<ButtondownConfig>;
}

export async function enrollButtondownSubscriber(
  config: ButtondownConfig,
  email: string,
  fetcher: ButtondownFetch = fetch,
): Promise<void> {
  const active = configured(config);
  if (!active) return;
  try {
    const response = await fetcher(
      "https://api.buttondown.com/v1/subscribers",
      {
        method: "POST",
        headers: {
          ...headers(active),
          "X-Idempotency-Key": `elixir-drop-login-${createHash("sha256").update(email).digest("hex")}`,
        },
        body: JSON.stringify({
          email_address: email,
          type: "regular",
          metadata: { source: "elixir-drop-magic-link" },
        }),
        signal: AbortSignal.timeout(3_000),
      },
    );
    // Buttondown returns 400 for an existing address. Deliberately do not use
    // collision overwrite: an unsubscribed or suppressed player stays that way.
    if (response.ok || response.status === 400) return;
    console.warn(
      `Buttondown subscriber enrollment failed with HTTP ${response.status}.`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.name : "UnknownError";
    console.warn(`Buttondown subscriber enrollment failed with ${reason}.`);
  }
}

export async function deleteButtondownSubscriber(
  config: ButtondownConfig,
  email: string,
  fetcher: ButtondownFetch = fetch,
): Promise<void> {
  const active = configured(config);
  if (!active) return;
  try {
    const response = await fetcher(
      `https://api.buttondown.com/v1/subscribers/${encodeURIComponent(email)}`,
      {
        method: "DELETE",
        headers: headers(active),
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (response.ok || response.status === 404) return;
    console.warn(
      `Buttondown subscriber deletion failed with HTTP ${response.status}.`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.name : "UnknownError";
    console.warn(`Buttondown subscriber deletion failed with ${reason}.`);
  }
}

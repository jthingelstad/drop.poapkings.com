/**
 * Elixir MCP client — the hub seam.
 *
 * Elixir MCP records Clash Royale history and serves it over MCP
 * JSON-RPC. Drop is a downstream reader of that seam: it pulls what it
 * needs with its own service token and never reaches into another app.
 * This is not the Clash Royale API, so it is not bound by the rule that
 * only the bridge may call Supercell.
 *
 * The transport is JSON-RPC over one POST. Keep this module a thin
 * client: no Drop presentation shape leaks up to the hub, and no hub
 * response shape leaks past the callers that adapt it.
 */

export interface ElixirMcpConfig {
  baseUrl: string;
  token?: string;
}

export type ElixirMcpFetch = (
  input: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export class ElixirMcpError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ElixirMcpError";
    this.status = status;
    this.code = code;
  }
}

/** Absent config is not an error: Drop must run without the hub wired. */
export function configured(
  config: ElixirMcpConfig,
): Required<ElixirMcpConfig> | undefined {
  if (!config.token || !config.baseUrl) return undefined;
  return { baseUrl: config.baseUrl, token: config.token };
}

let nextId = 1;

/**
 * Call one hub tool. Resolves with the tool's parsed result.
 *
 * A tool failure comes back as a JSON-RPC *result* carrying isError,
 * not as a transport error, so both shapes are normalized to a throw
 * here and every caller decides on its own whether to care.
 */
export async function callTool<T = unknown>(
  config: ElixirMcpConfig,
  name: string,
  args: Record<string, unknown> = {},
  fetcher: ElixirMcpFetch = fetch as unknown as ElixirMcpFetch,
): Promise<T> {
  const ready = configured(config);
  if (!ready) {
    throw new ElixirMcpError("Elixir MCP is not configured", 0, "unconfigured");
  }
  const response = await fetcher(`${ready.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ready.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) {
    // 429 is the hub's shared rate limit: every token, 300 calls an
    // hour, and a REST-shaped retry storm is exactly what it guards.
    throw new ElixirMcpError(
      `Elixir MCP ${name} failed: HTTP ${response.status}`,
      response.status,
      response.status === 429 ? "rate_limited" : undefined,
    );
  }
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: { text?: string }[] };
  };
  if (body.error) {
    throw new ElixirMcpError(
      `Elixir MCP ${name} failed: ${body.error.message ?? "unknown error"}`,
      response.status,
    );
  }
  const text = body.result?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new ElixirMcpError(
      `Elixir MCP ${name} returned no content`,
      response.status,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ElixirMcpError(
      `Elixir MCP ${name} returned unparsable content`,
      response.status,
    );
  }
  if (body.result?.isError) {
    const failure = parsed as { error?: string; message?: string };
    throw new ElixirMcpError(
      `Elixir MCP ${name} refused: ${failure.message ?? failure.error ?? text}`,
      response.status,
      failure.error,
    );
  }
  return parsed as T;
}

export interface CollectionEditResult {
  slug: string;
  added: number;
  removed: number;
  members: number;
  recordings_started: number;
}

/**
 * Put a player tag in the Elixir Drop collection.
 *
 * Membership is what makes the hub record the player, which is the
 * point: it is how a Drop player's real battles become comparable with
 * how they do in the learning games. Idempotent, so every login can
 * call it without checking first.
 */
export async function addPlayerToCollection(
  config: ElixirMcpConfig,
  slug: string,
  tags: string[],
  fetcher?: ElixirMcpFetch,
): Promise<CollectionEditResult | undefined> {
  const wanted = [...new Set(tags.filter(Boolean))];
  if (wanted.length === 0) return undefined;
  return callTool<CollectionEditResult>(
    config,
    "collections_edit",
    { slug, action: "add", tags: wanted },
    fetcher,
  );
}

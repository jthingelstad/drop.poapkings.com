import { measure } from "./timings.js";
/** Server-to-server REST client for Elixir's integration API. Environment
 * names remain compatible with the existing deployment parameters. */
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
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ElixirMcpError";
  }
}
export function configured(
  config: ElixirMcpConfig,
): Required<ElixirMcpConfig> | undefined {
  return config.token && config.baseUrl
    ? { baseUrl: config.baseUrl, token: config.token }
    : undefined;
}
export async function apiRequest<T>(
  config: ElixirMcpConfig,
  method: string,
  path: string,
  body?: unknown,
  fetcher: ElixirMcpFetch = fetch as unknown as ElixirMcpFetch,
  idempotencyKey?: string,
): Promise<T> {
  const ready = configured(config);
  if (!ready)
    throw new ElixirMcpError("Elixir API is not configured", 0, "unconfigured");
  return measure("elixir.api", async () => {
    const response = await fetcher(`${ready.baseUrl}/api/v1${path}`, {
      method,
      signal: AbortSignal.timeout(3000),
      headers: {
        Authorization: `Bearer ${ready.token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = (await response.json()) as { data?: T; code?: string };
    if (!response.ok)
      throw new ElixirMcpError(
        `Elixir API returned HTTP ${response.status}`,
        response.status,
        payload.code,
      );
    if (payload.data === undefined)
      throw new ElixirMcpError(
        "Elixir API returned no data",
        response.status,
        "invalid_response",
      );
    return payload.data;
  });
}
export interface CollectionEditResult {
  collection_id: string;
  added: number;
  already_present: number;
  total: number;
  recordings_started: number;
  enrollment_established: boolean;
}
export async function addPlayerToCollection(
  config: ElixirMcpConfig,
  slug: string,
  tags: string[],
  fetcher?: ElixirMcpFetch,
): Promise<CollectionEditResult | undefined> {
  const wanted = [...new Set(tags.filter(Boolean))];
  if (!wanted.length) return undefined;
  return wanted.length === 1
    ? apiRequest(
        config,
        "PUT",
        `/collections/${encodeURIComponent(slug)}/members/${encodeURIComponent(wanted[0]!)}`,
        {},
        fetcher,
      )
    : apiRequest(
        config,
        "POST",
        `/collections/${encodeURIComponent(slug)}/members`,
        { tags: wanted },
        fetcher,
      );
}

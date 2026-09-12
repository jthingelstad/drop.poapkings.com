// Sign in WITH Elixir: Drop as a public OAuth client at Elixir's door.
//
// This is a different seam from services/api/src/elixir-mcp.ts, which is
// Drop the INTEGRATION reading the record with its own key. Here the person
// signs in to Elixir and Drop holds their token for the length of one
// callback: long enough to learn who they are (`/oauth/userinfo`, scope
// account:email), which players are theirs (`elixir_my_players`) and, when
// their Drop tag is not on their Elixir account yet, to add it
// (`elixir_track_player`). Nothing here is stored; the token pair is
// dropped when the callback ends (Jamie, 2026-09-12: re-check at sign-in,
// never in the background).
//
// The contract is Elixir's public one: elixir.poapkings.com/docs/protocol.
// `resource` is required at both steps (RFC 8707); PKCE is the proof, there
// is no client secret.

import { createHash, randomBytes } from "node:crypto";

export const ELIXIR_SIGN_IN_SCOPE = "cr:read recordings:write account:email";
const TIMEOUT_MS = 20_000;
export const PRINCIPAL_META_KEY = "elixir.poapkings.com/principal";

export interface ElixirTokens {
  accessToken: string;
  refreshToken?: string;
  scope: string;
}

export interface ElixirUserinfo {
  sub: string;
  email: string;
  emailVerified: boolean;
}

export interface ElixirSelfPlayer {
  playerTag: string;
  name?: string;
  relationship: "primary" | "alt";
  isPrimary: boolean;
  verified: boolean;
  clanTag?: string;
  clanRole?: string;
}

export type ElixirFailure = {
  ok: false;
  code:
    | "transport"
    | "invalid_grant"
    | "not_a_person"
    | "insufficient_scope"
    | "email_unavailable"
    | "elixir_unavailable";
  detail?: string;
};

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

type Fetch = typeof fetch;

export class ElixirOAuthClient {
  private readonly issuer: string;
  private readonly clientId: string;
  private readonly fetchImpl: Fetch;

  constructor(options: { issuer: string; clientId: string; fetch?: Fetch }) {
    this.issuer = options.issuer.replace(/\/$/, "");
    this.clientId = options.clientId;
    this.fetchImpl = options.fetch ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.clientId);
  }

  get resource(): string {
    return `${this.issuer}/mcp`;
  }

  // The endpoints are the documented ones; discovery is not consulted at
  // request time so a sign-in never waits on a second round trip.
  authorizationUrl(input: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    const url = new URL(`${this.issuer}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("scope", ELIXIR_SIGN_IN_SCOPE);
    url.searchParams.set("resource", this.resource);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchange(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ ok: true; tokens: ElixirTokens } | ElixirFailure> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.issuer}/oauth/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.clientId,
          code: input.code,
          code_verifier: input.codeVerifier,
          redirect_uri: input.redirectUri,
          resource: this.resource,
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, code: "transport", detail: nameOf(error) };
    }
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok) {
      return {
        ok: false,
        code: response.status === 400 ? "invalid_grant" : "elixir_unavailable",
        detail: typeof body?.error === "string" ? body.error : undefined,
      };
    }
    if (typeof body?.access_token !== "string")
      return { ok: false, code: "elixir_unavailable", detail: "no_token" };
    return {
      ok: true,
      tokens: {
        accessToken: body.access_token,
        refreshToken:
          typeof body.refresh_token === "string"
            ? body.refresh_token
            : undefined,
        scope: typeof body.scope === "string" ? body.scope : "",
      },
    };
  }

  async userinfo(
    accessToken: string,
  ): Promise<{ ok: true; user: ElixirUserinfo } | ElixirFailure> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.issuer}/oauth/userinfo`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, code: "transport", detail: nameOf(error) };
    }
    if (response.status === 403)
      return { ok: false, code: "insufficient_scope" };
    if (response.status === 404)
      return { ok: false, code: "email_unavailable" };
    if (!response.ok)
      return {
        ok: false,
        code: "elixir_unavailable",
        detail: String(response.status),
      };
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (typeof body?.email !== "string" || typeof body.sub !== "string")
      return { ok: false, code: "elixir_unavailable", detail: "bad_userinfo" };
    return {
      ok: true,
      user: {
        sub: body.sub,
        email: body.email,
        emailVerified: body.email_verified === true,
      },
    };
  }

  private async rpc(
    accessToken: string,
    method: string,
    params: unknown,
  ): Promise<{ ok: true; result: unknown } | ElixirFailure> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.resource, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, code: "transport", detail: nameOf(error) };
    }
    if (!response.ok)
      return {
        ok: false,
        code: "elixir_unavailable",
        detail: String(response.status),
      };
    const envelope = (await response.json().catch(() => null)) as {
      result?: unknown;
      error?: { code?: number; message?: string };
    } | null;
    if (!envelope || envelope.error)
      return {
        ok: false,
        code: "elixir_unavailable",
        detail: envelope?.error?.message,
      };
    return { ok: true, result: envelope.result };
  }

  // The gate's first fact: this is a PERSON's grant, not an agent's.
  async initialize(accessToken: string): Promise<{ ok: true } | ElixirFailure> {
    const answer = await this.rpc(accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "elixir-drop", version: "1" },
    });
    if (!answer.ok) return answer;
    const meta = (answer.result as { _meta?: Record<string, unknown> })?._meta;
    const principal = meta?.[PRINCIPAL_META_KEY] as
      { kind?: string } | undefined;
    if (principal?.kind !== "person")
      return { ok: false, code: "not_a_person" };
    return { ok: true };
  }

  private async callTool(
    accessToken: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<
    | { ok: true; body: Record<string, unknown> }
    | (ElixirFailure & { toolCode?: string })
  > {
    const answer = await this.rpc(accessToken, "tools/call", {
      name,
      arguments: args,
    });
    if (!answer.ok) return answer;
    const result = answer.result as {
      isError?: boolean;
      content?: { text?: string }[];
    };
    const text = result?.content?.[0]?.text;
    if (typeof text !== "string")
      return { ok: false, code: "elixir_unavailable", detail: "no_content" };
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, code: "elixir_unavailable", detail: "non_json" };
    }
    if (result.isError) {
      const err = body.error as { code?: string; message?: string } | undefined;
      return {
        ok: false,
        code: "elixir_unavailable",
        toolCode: err?.code,
        detail: err?.message,
      };
    }
    return { ok: true, body };
  }

  // The players that are the person: primary and alts, with whether Elixir
  // has proven each. Friends and watched players are not "you" and are
  // never offered.
  async selfPlayers(
    accessToken: string,
  ): Promise<{ ok: true; players: ElixirSelfPlayer[] } | ElixirFailure> {
    const answer = await this.callTool(accessToken, "elixir_my_players", {});
    if (!answer.ok) return answer;
    const rows = Array.isArray(answer.body.players)
      ? (answer.body.players as Record<string, unknown>[])
      : [];
    const players: ElixirSelfPlayer[] = [];
    for (const row of rows) {
      const relationship = row.relationship;
      if (relationship !== "primary" && relationship !== "alt") continue;
      if (typeof row.player_tag !== "string") continue;
      players.push({
        playerTag: row.player_tag,
        name: typeof row.name === "string" ? row.name : undefined,
        relationship,
        isPrimary: row.is_primary === true,
        verified: row.claim_status === "verified",
        clanTag: typeof row.clan_tag === "string" ? row.clan_tag : undefined,
        clanRole: typeof row.clan_role === "string" ? row.clan_role : undefined,
      });
    }
    return { ok: true, players };
  }

  // Add the Drop-saved tag to the person's Elixir account as an alt (Jamie,
  // 2026-09-12: "if they have a tag that is not tracked it should be
  // added"). The first player on an empty account becomes the primary
  // regardless. Refusals (a full tier, an invalid tag) are reported, never
  // fatal: the person still signs in and picks from what is tracked.
  async trackAlt(
    accessToken: string,
    playerTag: string,
  ): Promise<{ ok: true } | (ElixirFailure & { toolCode?: string })> {
    const answer = await this.callTool(accessToken, "elixir_track_player", {
      player_tag: playerTag,
      action: "add",
      relationship: "alt",
    });
    return answer.ok ? { ok: true } : answer;
  }
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

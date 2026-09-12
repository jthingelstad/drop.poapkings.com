import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import {
  ElixirOAuthClient,
  ELIXIR_SIGN_IN_SCOPE,
} from "../src/elixir-oauth.js";
import {
  buildLink,
  elixirCallback,
  selectElixirPlayer,
  startElixirLogin,
} from "../src/routes/elixir-auth.js";
import type { ElixirLink, PlayerProfile } from "../src/types.js";
import type { RouteContext } from "../src/routes/context.js";
import { issueSession } from "../src/routes/context.js";
import { accountTagsFor } from "../src/account-tags.js";
import { publicProfile } from "../src/public-profile.js";
import { emailSubject } from "../src/validation.js";

const config = {
  tableName: "t",
  sessionSecret: "secret",
  telemetryPepper: "pepper",
  appUrl: "https://drop.test",
  jmapToken: "x",
  emailFrom: "elixir@poapkings.com",
  emailFromName: "Elixir",
  nameModelId: "m",
  elixirMcpBaseUrl: "https://elixir.test",
  elixirMcpCollectionSlug: "elixir-drop",
  warClockClanTag: "#J2RGCRVG",
  elixirOAuthClientId: "client123",
} as RouteContext["config"];

function event(
  method: string,
  path: string,
  extra: {
    query?: Record<string, string>;
    body?: unknown;
    bearer?: string;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      ...(extra.bearer ? { authorization: `Bearer ${extra.bearer}` } : {}),
      ...(extra.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    queryStringParameters: extra.query,
    requestContext: {
      accountId: "a",
      apiId: "a",
      domainName: "d",
      domainPrefix: "d",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "1.2.3.4",
        userAgent: "t",
      },
      requestId: "r",
      routeKey: "$default",
      stage: "$default",
      time: "",
      timeEpoch: 0,
    },
    body: extra.body !== undefined ? JSON.stringify(extra.body) : undefined,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

// A scripted Elixir: what the door answers at each step.
function fakeElixir(script: {
  kind?: string;
  email?: string;
  players?: Record<string, unknown>[];
  trackOk?: boolean;
  userinfoStatus?: number;
}) {
  const calls: string[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    const sent = typeof init?.body === "string" ? init.body : "";
    const answer = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.endsWith("/oauth/token")) {
      calls.push("token");
      const form = new URLSearchParams(sent);
      expect(form.get("resource")).toBe("https://elixir.test/mcp");
      expect(form.get("code_verifier")).toBeTruthy();
      return answer(200, {
        access_token: "eat_1",
        refresh_token: "ert_1",
        scope: ELIXIR_SIGN_IN_SCOPE,
        expires_in: 3600,
      });
    }
    if (url.endsWith("/oauth/userinfo")) {
      calls.push("userinfo");
      if (script.userinfoStatus)
        return answer(script.userinfoStatus, { error: "x" });
      return answer(200, {
        sub: "elixir-acct-1",
        email: script.email ?? "jamie@example.com",
        email_verified: true,
        kind: "person",
      });
    }
    if (url.endsWith("/mcp")) {
      const rpc = JSON.parse(sent) as {
        method: string;
        params: { name?: string; arguments?: Record<string, unknown> };
      };
      if (rpc.method === "initialize") {
        calls.push("initialize");
        return answer(200, {
          jsonrpc: "2.0",
          id: 1,
          result: {
            _meta: {
              "elixir.poapkings.com/principal": {
                kind: script.kind ?? "person",
              },
            },
          },
        });
      }
      calls.push(rpc.params.name ?? "?");
      if (rpc.params.name === "elixir_my_players")
        return answer(200, {
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({ players: script.players ?? [] }),
              },
            ],
          },
        });
      if (rpc.params.name === "elixir_track_player") {
        if (script.trackOk === false)
          return answer(200, {
            jsonrpc: "2.0",
            id: 1,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: { code: "quota_exceeded", message: "full" },
                  }),
                },
              ],
            },
          });
        script.players = [
          ...(script.players ?? []),
          {
            player_tag: rpc.params.arguments?.player_tag,
            name: "Added",
            relationship: "alt",
            is_primary: false,
            claim_status: "unverified",
          },
        ];
        return answer(200, {
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "{}" }] },
        });
      }
      return answer(200, {
        jsonrpc: "2.0",
        id: 1,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: { code: "not_found" } }),
            },
          ],
        },
      });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return {
    calls,
    client: new ElixirOAuthClient({
      issuer: config.elixirMcpBaseUrl,
      clientId: "client123",
      fetch: fetchImpl,
    }),
  };
}

// An in-memory repository with only what these routes touch.
function fakeRepository(profiles: Record<string, PlayerProfile> = {}) {
  const must = (sub: string): PlayerProfile => {
    const found = profiles[sub];
    if (!found) throw new Error(`no profile ${sub}`);
    return found;
  };
  const logins = new Map<string, Record<string, unknown>>();
  const magic: Record<string, unknown>[] = [];
  const pending = new Map<string, ElixirLink>();
  const refreshes: string[] = [];
  const repo = {
    profiles,
    magic,
    pending,
    refreshes,
    async useRateLimit() {},
    async saveElixirLogin(state: string, login: Record<string, unknown>) {
      logins.set(state, login);
    },
    async takeElixirLogin(state: string) {
      const l = logins.get(state);
      logins.delete(state);
      return l;
    },
    async getProfile(sub: string) {
      return profiles[sub];
    },
    async setElixirLink(sub: string, link: ElixirLink) {
      profiles[sub] = {
        ...must(sub),
        elixir: link,
        elixirVerified: Boolean(link.verified && link.playerTag),
      };
      return must(sub);
    },
    async clearElixirLink(sub: string) {
      const rest = { ...must(sub) };
      delete rest.elixir;
      delete rest.elixirVerified;
      profiles[sub] = rest;
      return must(sub);
    },
    async updateProfile(sub: string, updates: { playerTag?: string }) {
      profiles[sub] = {
        ...must(sub),
        ...(updates.playerTag ? { playerTag: updates.playerTag } : {}),
      };
      return must(sub);
    },
    async savePendingElixirLink(sub: string, link: ElixirLink) {
      pending.set(sub, link);
    },
    async saveProvenMagicLink(
      tokenHash: string,
      email: string,
      expiresAt: number,
      pollId?: string,
    ) {
      magic.push({ tokenHash, email, expiresAt, pollId });
    },
    async getCrProfile() {
      return undefined;
    },
    async rankedAccess() {
      return "allowed" as const;
    },
  };
  return { ...repo, must };
}

function profile(
  sub: string,
  extra: Partial<PlayerProfile> = {},
): PlayerProfile {
  return {
    sub,
    playerId: `pid-${sub.slice(0, 6)}`,
    email: "jamie@example.com",
    publicName: "Builder",
    favoriteCardId: 26000000,
    totalGames: 3,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}

const KING = {
  player_tag: "#20JJJ2CCRU",
  name: "King Thing",
  relationship: "primary",
  is_primary: true,
  claim_status: "verified",
  clan_tag: "#J2RGCRVG",
  clan_role: "leader",
};
const ALT = {
  player_tag: "#VJQV8G8RL",
  name: "thingles",
  relationship: "alt",
  is_primary: false,
  claim_status: "unverified",
};
const FRIEND = {
  player_tag: "#U8RYG9Y2U",
  name: "King Levy",
  relationship: "friend",
  is_primary: false,
  claim_status: "verified",
};

async function start(
  repo: ReturnType<typeof fakeRepository>,
  fake: ReturnType<typeof fakeElixir>,
  bearer?: string,
  returnTo?: string,
) {
  const res = await startElixirLogin(
    {
      event: event("POST", "/auth/elixir/start", {
        bearer,
        body: { returnTo },
      }),
      config,
      repository: repo as never,
    },
    fake.client,
  );
  const body = JSON.parse(String(res.body)) as {
    url: string;
    pollId: string;
    mode: string;
  };
  const state = new URL(body.url).searchParams.get("state") ?? "";
  return { ...body, state };
}

describe("sign in with Elixir", () => {
  it("start: asks Elixir for cr:read + recordings:write + account:email with PKCE, and hands back a poll id", async () => {
    const repo = fakeRepository();
    const fake = fakeElixir({});
    const { url, pollId, mode } = await start(repo, fake);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://elixir.test/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe(
      "cr:read recordings:write account:email",
    );
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://drop.test/api/auth/elixir/callback",
    );
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(pollId.length).toBeGreaterThan(20);
    expect(mode).toBe("sign-in");
  });

  it("callback for a new person: the proven address becomes the account, one player is chosen silently, and the browser lands on the redemption route", async () => {
    const repo = fakeRepository();
    const fake = fakeElixir({ players: [KING, FRIEND] });
    const { state, pollId } = await start(repo, fake, undefined, "/surge");
    const res = await elixirCallback(
      {
        event: event("GET", "/auth/elixir/callback", {
          query: { code: "eac_1", state, iss: "https://elixir.test" },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
    expect(res.statusCode).toBe(303);
    const location = new URL(String(res.headers?.location).replace("/#/", "/"));
    expect(location.pathname).toBe("/auth");
    expect(location.searchParams.get("returnTo")).toBe("/surge");
    expect(location.searchParams.get("via")).toBe("elixir");
    expect(repo.magic[0]).toMatchObject({ email: "jamie@example.com", pollId });
    const sub = emailSubject("jamie@example.com");
    const link = repo.pending.get(sub);
    expect(link?.playerTag).toBe("#20JJJ2CCRU");
    expect(link?.verified).toBe(true);
    expect(link?.candidates.map((c) => c.playerTag)).toEqual(["#20JJJ2CCRU"]);
    expect(fake.calls).toEqual([
      "token",
      "initialize",
      "userinfo",
      "elixir_my_players",
    ]);
  });

  it("callback for an existing account with the same email: linked in place, verified mark on", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({
      [sub]: profile(sub, { playerTag: "#20JJJ2CCRU" }),
    });
    const fake = fakeElixir({ players: [KING] });
    const { state } = await start(repo, fake);
    await elixirCallback(
      {
        event: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
    expect(repo.must(sub).elixir?.verified).toBe(true);
    expect(repo.must(sub).elixirVerified).toBe(true);
    expect(accountTagsFor(repo.must(sub))).toEqual(["verified"]);
    expect(publicProfile(repo.must(sub)).accountTags).toEqual(["verified"]);
    expect(repo.pending.size).toBe(0);
  });

  it("callback with more than one self player lands on the picker, and a Drop tag not on Elixir is added there first", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub, { playerTag: "#2PP" }) });
    const fake = fakeElixir({ players: [KING, ALT] });
    const { state } = await start(repo, fake);
    const res = await elixirCallback(
      {
        event: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
    expect(fake.calls).toEqual([
      "token",
      "initialize",
      "userinfo",
      "elixir_my_players",
      "elixir_track_player",
      "elixir_my_players",
    ]);
    const link = repo.must(sub).elixir!;
    // The Drop tag is now among the candidates, so it stays the choice.
    expect(link.candidates.map((c) => c.playerTag)).toEqual([
      "#20JJJ2CCRU",
      "#VJQV8G8RL",
      "#2PP",
    ]);
    expect(link.playerTag).toBe("#2PP");
    expect(link.verified).toBe(false);
    expect(repo.must(sub).elixirVerified).toBe(false);
    // More than one candidate: the person is shown the picker.
    expect(String(res.headers?.location)).toContain(
      encodeURIComponent("/profile?scope=account"),
    );
  });

  it("callback: a refused track is recorded, not fatal", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub, { playerTag: "#2PP" }) });
    const fake = fakeElixir({ players: [KING], trackOk: false });
    const { state } = await start(repo, fake);
    const res = await elixirCallback(
      {
        event: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
    expect(res.statusCode).toBe(303);
    const link = repo.must(sub).elixir!;
    expect(link.trackRefused).toBe("#2PP");
    // The only candidate is King Thing; Drop's tag is not theirs on Elixir, so
    // the lone candidate is chosen and becomes the Drop tag.
    expect(link.playerTag).toBe("#20JJJ2CCRU");
    expect(repo.must(sub).playerTag).toBe("#20JJJ2CCRU");
  });

  it("callback from a signed-in browser is a LINK to that account, whatever email Elixir names", async () => {
    const dropSub = emailSubject("other@example.com");
    const repo = fakeRepository({
      [dropSub]: profile(dropSub, { email: "other@example.com" }),
    });
    const fake = fakeElixir({ players: [KING], email: "jamie@example.com" });
    const bearer = issueSession(
      dropSub,
      config.sessionSecret,
      Math.floor(Date.now() / 1000),
    ).token;
    const { state, mode } = await start(repo, fake, bearer);
    expect(mode).toBe("link");
    await elixirCallback(
      {
        event: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
    expect(repo.must(dropSub).elixir?.accountId).toBe("elixir-acct-1");
    expect(repo.must(dropSub).playerTag).toBe("#20JJJ2CCRU");
    // The proven magic link is for the DROP account's email, so redemption
    // signs in to the linked account, not a new one.
    expect(repo.magic[0]).toMatchObject({ email: "other@example.com" });
    expect(Object.keys(repo.profiles)).toEqual([dropSub]);
  });

  it("callback refuses an agent's grant, a replayed state, and a missing address", async () => {
    const repo = fakeRepository();
    const agent = fakeElixir({ kind: "agent" });
    const one = await start(repo, agent);
    const r1 = await elixirCallback(
      {
        event: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state: one.state },
        }),
        config,
        repository: repo as never,
      },
      agent.client,
    );
    expect(String(r1.headers?.location)).toBe(
      "https://drop.test/#/login?elixir=not_a_person",
    );
    const r2 = await elixirCallback(
      {
        event: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state: one.state },
        }),
        config,
        repository: repo as never,
      },
      agent.client,
    );
    expect(String(r2.headers?.location)).toBe(
      "https://drop.test/#/login?elixir=login_expired",
    );
    const noEmail = fakeElixir({ userinfoStatus: 404 });
    const two = await start(repo, noEmail);
    const r3 = await elixirCallback(
      {
        event: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state: two.state },
        }),
        config,
        repository: repo as never,
      },
      noEmail.client,
    );
    expect(String(r3.headers?.location)).toBe(
      "https://drop.test/#/login?elixir=email_unavailable",
    );
    expect(repo.magic.length).toBe(0);
  });

  it("select: only a candidate can be chosen; the choice becomes the Drop tag and the mark follows verification", async () => {
    const sub = emailSubject("jamie@example.com");
    const link = buildLink({
      accountId: "elixir-acct-1",
      players: [
        {
          playerTag: "#20JJJ2CCRU",
          name: "King Thing",
          relationship: "primary",
          isPrimary: true,
          verified: true,
        },
        {
          playerTag: "#VJQV8G8RL",
          name: "thingles",
          relationship: "alt",
          isPrimary: false,
          verified: false,
        },
      ],
      now: "2026-09-12T20:00:00.000Z",
    });
    expect(link.playerTag).toBeUndefined();
    const repo = fakeRepository({ [sub]: profile(sub, { elixir: link }) });
    const bearer = issueSession(
      sub,
      config.sessionSecret,
      Math.floor(Date.now() / 1000),
    ).token;
    await expect(
      selectElixirPlayer({
        event: event("POST", "/me/elixir/select", {
          bearer,
          body: { playerTag: "#U8RYG9Y2U" },
        }),
        config,
        repository: repo as never,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const res = await selectElixirPlayer({
      event: event("POST", "/me/elixir/select", {
        bearer,
        body: { playerTag: "20jjj2ccru" },
      }),
      config,
      repository: repo as never,
    });
    const body = JSON.parse(String(res.body)) as {
      player: {
        playerTag: string;
        accountTags?: string[];
        elixir: { verified: boolean };
      };
    };
    expect(body.player.playerTag).toBe("#20JJJ2CCRU");
    expect(body.player.elixir.verified).toBe(true);
    expect(body.player.accountTags).toEqual(["verified"]);
    const alt = await selectElixirPlayer({
      event: event("POST", "/me/elixir/select", {
        bearer,
        body: { playerTag: "#VJQV8G8RL" },
      }),
      config,
      repository: repo as never,
    });
    const altBody = JSON.parse(String(alt.body)) as {
      player: { accountTags?: string[]; elixir: { verified: boolean } };
    };
    expect(altBody.player.elixir.verified).toBe(false);
    expect(altBody.player.accountTags).toBeUndefined();
  });

  it("buildLink keeps a previous choice and its verifiedAt while it is still theirs", () => {
    const previous = buildLink({
      accountId: "e",
      players: [
        {
          playerTag: "#20JJJ2CCRU",
          relationship: "primary",
          isPrimary: true,
          verified: true,
        },
      ],
      now: "2026-09-01T00:00:00.000Z",
    });
    const next = buildLink({
      accountId: "e",
      players: [
        {
          playerTag: "#20JJJ2CCRU",
          relationship: "primary",
          isPrimary: true,
          verified: true,
        },
        {
          playerTag: "#VJQV8G8RL",
          relationship: "alt",
          isPrimary: false,
          verified: true,
        },
      ],
      previous,
      now: "2026-09-12T00:00:00.000Z",
    });
    expect(next.playerTag).toBe("#20JJJ2CCRU");
    expect(next.verifiedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(next.linkedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(next.checkedAt).toBe("2026-09-12T00:00:00.000Z");
    const gone = buildLink({
      accountId: "e",
      players: [],
      previous,
      now: "2026-09-13T00:00:00.000Z",
    });
    expect(gone.playerTag).toBeUndefined();
    expect(gone.verified).toBe(false);
  });
});

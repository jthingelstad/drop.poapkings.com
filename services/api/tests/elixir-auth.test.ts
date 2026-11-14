import type { HttpRequest } from "../src/http.js";
import { describe, expect, it, vi } from "vitest";
import {
  ElixirOAuthClient,
  ELIXIR_SIGN_IN_SCOPE,
} from "../src/elixir-oauth.js";
import {
  buildLink,
  elixirCallback,
  elixirClientFor,
  startElixirLogin,
} from "../src/routes/elixir-auth.js";
import type { ElixirBindOutcome } from "../src/repository.js";
import type { ElixirIdentity } from "../src/elixir-identity.js";
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
  elixirMcpBaseUrl: "https://elixir.test",
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
): HttpRequest {
  return {
    path,
    headers: {
      ...(extra.bearer ? { authorization: `Bearer ${extra.bearer}` } : {}),
      ...(extra.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    query: extra.query,
    method,
    sourceIp: "1.2.3.4",
    requestId: "r",
    body: extra.body !== undefined ? JSON.stringify(extra.body) : undefined,
  } as HttpRequest;
}
// A scripted Elixir: what the door answers at each step.
function fakeElixir(script: {
  kind?: string;
  email?: string;
  players?: Record<string, unknown>[];
  // Anything else /me carries (the profile image, 2026-11-14).
  me?: Record<string, unknown>;
  userinfoStatus?: number;
}) {
  const calls: string[] = [];
  // Every request, as METHOD path: Drop writes nothing to Elixir, so the only
  // non-GET it may send is OAuth's own token request.
  const requests: string[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${new URL(url).pathname}`);
    if (method !== "GET" && !url.endsWith("/oauth/token"))
      throw new Error(`Drop sent Elixir a ${method} to ${url}`);
    const sent = typeof init?.body === "string" ? init.body : "";
    const answer = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.endsWith("/oauth/token")) {
      calls.push("token");
      const form = new URLSearchParams(sent);
      expect(form.get("resource")).toBe("https://elixir.test/api/v1");
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
    const problem = (status: number, code: string) =>
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: code,
          status,
          code,
          detail: code,
          request_id: "00000000-0000-4000-8000-000000000000",
        }),
        {
          status,
          headers: { "content-type": "application/problem+json" },
        },
      );
    if (url.endsWith("/api/v1/me") && (init?.method ?? "GET") === "GET") {
      calls.push("me");
      return answer(200, {
        request_id: "r",
        data: {
          principal: { kind: script.kind ?? "person" },
          players: script.players ?? [],
          ...script.me,
        },
      });
    }
    if (url.includes("/api/v1/")) return problem(404, "not_found");
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return {
    calls,
    requests,
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
  const pendingIdentity = new Map<string, ElixirIdentity | undefined>();
  const pendingExpiry = new Map<string, number>();
  const refreshes: string[] = [];
  // ELIXIR#<accountId> -> Drop sub
  const pointers = new Map<string, string>();
  const released: string[] = [];
  const shares = new Map<string, string>();
  const crProfiles = new Map<string, Record<string, unknown>>();
  const repo = {
    crProfiles,
    profiles,
    magic,
    pending,
    pendingIdentity,
    pendingExpiry,
    refreshes,
    pointers,
    released,
    shares,
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
    async updateProfile(
      sub: string,
      updates: {
        playerTag?: string;
      },
    ) {
      profiles[sub] = {
        ...must(sub),
        ...(updates.playerTag ? { playerTag: updates.playerTag } : {}),
      };
      return must(sub);
    },
    async savePendingElixirLink(
      sub: string,
      link: ElixirLink,
      expiresAt: number,
      identity?: ElixirIdentity,
    ) {
      pending.set(sub, link);
      pendingIdentity.set(sub, identity);
      pendingExpiry.set(sub, expiresAt);
    },
    // The same writes as the repository's one update.
    async applyElixirIdentity(
      sub: string,
      identity: ElixirIdentity,
      before?: PlayerProfile,
    ) {
      const next: PlayerProfile = {
        ...must(sub),
        identityFromElixirAt: "now",
      };
      if (before && !before.identityFromElixirAt && !next.legacyIdentity)
        next.legacyIdentity = {
          ...(before.publicName ? { publicName: before.publicName } : {}),
          ...(before.favoriteCardId !== undefined
            ? { favoriteCardId: before.favoriteCardId }
            : {}),
        };
      if (identity.primaryName) next.publicName = identity.primaryName;
      else delete next.publicName;
      if (identity.avatarCardId === null) delete next.favoriteCardId;
      else if (identity.avatarCardId !== undefined)
        next.favoriteCardId = identity.avatarCardId;
      profiles[sub] = next;
      return next;
    },
    async saveProvenMagicLink(
      tokenHash: string,
      link: {
        sub: string;
        email: string;
        expiresAt: number;
        pollId?: string;
        recruiterSub?: string;
      },
    ) {
      magic.push({ tokenHash, ...link });
    },
    async getElixirIdentity(accountId: string) {
      return pointers.get(accountId);
    },
    // The same outcomes as the repository's one transaction.
    async bindElixirAccount(
      sub: string,
      accountId: string,
      link?: ElixirLink,
    ): Promise<ElixirBindOutcome> {
      const pointed = pointers.get(accountId);
      if (pointed !== undefined && pointed !== sub)
        return "elixir_account_in_use";
      const found = profiles[sub];
      if (!found) return "missing_profile";
      if (found.elixirAccountId && found.elixirAccountId !== accountId)
        return "elixir_account_mismatch";
      pointers.set(accountId, sub);
      profiles[sub] = {
        ...found,
        elixirAccountId: accountId,
        ...(link
          ? {
              elixir: link,
              elixirVerified: Boolean(link.verified && link.playerTag),
            }
          : {}),
      };
      return "bound";
    },
    async releaseElixirIdentity(accountId: string, sub: string) {
      released.push(accountId);
      if (pointers.get(accountId) === sub) pointers.delete(accountId);
    },
    async getShare(token: string) {
      const owner = shares.get(token);
      return owner ? { owner } : undefined;
    },
    async getCrProfile(tag: string) {
      return crProfiles.get(tag);
    },
    async saveCrProfileFromElixir(snapshot: { tag: string }) {
      crProfiles.set(snapshot.tag, snapshot);
      return true;
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
  clan_name: "POAP KINGS",
  clan_role: "leader",
};
const ALT = {
  player_tag: "#2PYQ0C",
  name: "Sample Alt",
  relationship: "alt",
  is_primary: false,
  claim_status: "unverified",
};
const FRIEND = {
  player_tag: "#9LCQ2",
  name: "Sample Friend",
  relationship: "friend",
  is_primary: false,
  claim_status: "verified",
};
async function start(
  repo: ReturnType<typeof fakeRepository>,
  fake: ReturnType<typeof fakeElixir>,
  bearer?: string,
  returnTo?: string,
  extraBody: Record<string, unknown> = {},
) {
  const res = await startElixirLogin(
    {
      request: event("POST", "/auth/elixir/start", {
        bearer,
        body: { returnTo, ...extraBody },
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
  it("start: asks Elixir for cr:read + account:email with PKCE, and hands back a poll id", async () => {
    const repo = fakeRepository();
    const fake = fakeElixir({});
    const { url, pollId, mode } = await start(repo, fake);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://elixir.test/oauth/authorize");
    // Read and sign in only: no recordings:write (Jamie, 2026-11-12).
    expect(u.searchParams.get("scope")).toBe("cr:read account:email");
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
        request: event("GET", "/auth/elixir/callback", {
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
    expect(fake.calls).toEqual(["token", "me", "userinfo"]);
    // The account and its pointer are written at redemption, once the
    // profile exists; the proven link names the account it will create.
    expect(repo.magic[0]).toMatchObject({ sub });
    // The pending link lives exactly as long as the credential that applies
    // it, so a late redemption never creates the account without its pointer.
    expect(repo.pendingExpiry.get(sub)).toBe(repo.magic[0]?.expiresAt);
    expect(repo.pointers.size).toBe(0);
    expect(Object.keys(repo.profiles)).toEqual([]);
    // The chosen player's name and clan are stored by tag straight away.
    expect(repo.crProfiles.get("#20JJJ2CCRU")).toMatchObject({
      status: "ready",
      name: "King Thing",
      clan: { tag: "#J2RGCRVG", name: "POAP KINGS" },
    });
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
        request: event("GET", "/auth/elixir/callback", {
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
    // The email fallback writes the pointer, so the next sign-in finds the
    // account by its Elixir identity, whatever address it carries then.
    expect(repo.pointers.get("elixir-acct-1")).toBe(sub);
    expect(repo.must(sub).elixirAccountId).toBe("elixir-acct-1");
    expect(repo.magic[0]).toMatchObject({ sub, email: "jamie@example.com" });
    // Name and clan come from the same /me read, never a later fetch.
    expect(repo.crProfiles.get("#20JJJ2CCRU")).toEqual({
      tag: "#20JJJ2CCRU",
      status: "ready",
      name: "King Thing",
      clan: { tag: "#J2RGCRVG", name: "POAP KINGS", role: "leader" },
      fetchedAt: repo.must(sub).elixir?.checkedAt,
      updatedAt: repo.must(sub).elixir?.checkedAt,
    });
  });
  it("callback with an alt beside the primary: the primary is Drop's player, over a hand-typed tag, and there is no picker", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub, { playerTag: "#2PP" }) });
    const fake = fakeElixir({ players: [ALT, KING] });
    const { state } = await start(repo, fake, undefined, "/surge");
    const res = await elixirCallback(
      {
        request: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
    // Nothing is added to the Elixir account.
    expect(fake.calls).toEqual(["token", "me", "userinfo"]);
    const link = repo.must(sub).elixir!;
    expect(link.candidates.map((c) => c.playerTag)).toEqual([
      "#2PYQ0C",
      "#20JJJ2CCRU",
    ]);
    expect(link.playerTag).toBe("#20JJJ2CCRU");
    expect(repo.must(sub).playerTag).toBe("#20JJJ2CCRU");
    expect(repo.must(sub).elixirVerified).toBe(true);
    // The primary player's name, never the alt's.
    expect(repo.must(sub).publicName).toBe("King Thing");
    // No choice to make: the person goes where they were going.
    expect(String(res.headers?.location)).toContain(
      `returnTo=${encodeURIComponent("/surge")}`,
    );
  });
  it("callback: a hand-typed tag and no Elixir players goes where the person was going", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub, { playerTag: "#2PP" }) });
    const fake = fakeElixir({ players: [] });
    const { state } = await start(repo, fake, undefined, "/surge");
    const res = await elixirCallback(
      {
        request: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
    expect(repo.must(sub).playerTag).toBe("#2PP");
    expect(String(res.headers?.location)).toContain(
      `returnTo=${encodeURIComponent("/surge")}`,
    );
  });
  it("a whole sign-in sends Elixir GETs only, besides OAuth's token request", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub, { playerTag: "#2PP" }) });
    const fake = fakeElixir({ players: [KING, ALT] });
    const { state } = await start(repo, fake);
    await elixirCallback(
      {
        request: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
    expect(fake.requests).toEqual([
      "POST /oauth/token",
      "GET /api/v1/me",
      "GET /oauth/userinfo",
    ]);
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
        request: event("GET", "/auth/elixir/callback", {
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
    expect(repo.magic[0]).toMatchObject({
      sub: dropSub,
      email: "other@example.com",
    });
    expect(Object.keys(repo.profiles)).toEqual([dropSub]);
    expect(repo.pointers.get("elixir-acct-1")).toBe(dropSub);
  });
  it("callback refuses an agent's grant, a replayed state, and a missing address", async () => {
    const repo = fakeRepository();
    const agent = fakeElixir({ kind: "agent" });
    const one = await start(repo, agent);
    const r1 = await elixirCallback(
      {
        request: event("GET", "/auth/elixir/callback", {
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
        request: event("GET", "/auth/elixir/callback", {
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
        request: event("GET", "/auth/elixir/callback", {
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
  async function callback(
    repo: ReturnType<typeof fakeRepository>,
    fake: ReturnType<typeof fakeElixir>,
    bearer?: string,
    extraBody?: Record<string, unknown>,
  ) {
    const { state } = await start(repo, fake, bearer, undefined, extraBody);
    return elixirCallback(
      {
        request: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
  }
  function bearerFor(sub: string) {
    return issueSession(
      sub,
      config.sessionSecret,
      Math.floor(Date.now() / 1000),
    ).token;
  }
  it("the pointer wins over the address: an Elixir account opens the Drop account it is bound to", async () => {
    const bound = emailSubject("drop-address@example.com");
    const byEmail = emailSubject("jamie@example.com");
    const repo = fakeRepository({
      [bound]: profile(bound, {
        email: "drop-address@example.com",
        elixirAccountId: "elixir-acct-1",
      }),
      [byEmail]: profile(byEmail),
    });
    repo.pointers.set("elixir-acct-1", bound);
    const res = await callback(repo, fakeElixir({ players: [KING] }));
    expect(res.statusCode).toBe(303);
    expect(repo.magic[0]).toMatchObject({
      sub: bound,
      email: "drop-address@example.com",
    });
    expect(repo.must(bound).elixir?.accountId).toBe("elixir-acct-1");
    expect(repo.must(byEmail).elixir).toBeUndefined();
    expect(repo.pending.size).toBe(0);
  });
  it("an Elixir account with a different address resolves through a backfilled pointer, never a second account", async () => {
    // The backfill wrote the pointer and elixirAccountId only, no link.
    const dropSub = emailSubject("old-address@example.com");
    const repo = fakeRepository({
      [dropSub]: profile(dropSub, {
        email: "old-address@example.com",
        elixirAccountId: "elixir-acct-1",
      }),
    });
    repo.pointers.set("elixir-acct-1", dropSub);
    await callback(
      repo,
      fakeElixir({ players: [KING], email: "new-address@example.com" }),
    );
    expect(Object.keys(repo.profiles)).toEqual([dropSub]);
    expect(repo.pending.size).toBe(0);
    expect(repo.magic[0]).toMatchObject({
      sub: dropSub,
      email: "old-address@example.com",
    });
    // The verified mark is read again at this sign-in.
    expect(repo.must(dropSub).elixir?.verified).toBe(true);
    expect(repo.must(dropSub).elixirVerified).toBe(true);
  });
  it("a pointer to a missing profile is removed and never followed or revived", async () => {
    const gone = emailSubject("deleted@example.com");
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub) });
    repo.pointers.set("elixir-acct-1", gone);
    await callback(repo, fakeElixir({ players: [KING] }));
    expect(repo.released).toEqual(["elixir-acct-1"]);
    expect(repo.profiles[gone]).toBeUndefined();
    expect(repo.pointers.get("elixir-acct-1")).toBe(sub);
    expect(repo.magic[0]).toMatchObject({ sub });
  });
  it("a stale pointer and no account for the address: a new account, not the deleted one", async () => {
    const gone = emailSubject("deleted@example.com");
    const repo = fakeRepository();
    repo.pointers.set("elixir-acct-1", gone);
    await callback(repo, fakeElixir({ players: [KING] }));
    const sub = emailSubject("jamie@example.com");
    expect(repo.pointers.has("elixir-acct-1")).toBe(false);
    expect(repo.pending.has(sub)).toBe(true);
    expect(repo.magic[0]).toMatchObject({ sub });
  });
  it("an address whose account belongs to another Elixir account opens without moving that connection", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({
      [sub]: profile(sub, {
        playerTag: "#2PP",
        elixirAccountId: "elixir-acct-other",
      }),
    });
    repo.pointers.set("elixir-acct-other", sub);
    const fake = fakeElixir({ players: [KING] });
    const res = await callback(repo, fake);
    expect(res.statusCode).toBe(303);
    expect(repo.magic[0]).toMatchObject({ sub });
    expect(repo.must(sub).elixirAccountId).toBe("elixir-acct-other");
    expect(repo.must(sub).elixir).toBeUndefined();
    expect(repo.must(sub).playerTag).toBe("#2PP");
    expect(repo.pointers.has("elixir-acct-1")).toBe(false);
    // Nothing was tracked on an Elixir account this Drop account is not bound to.
    expect(fake.calls).toEqual(["token", "me", "userinfo"]);
  });
  it("link mode refuses an Elixir account already bound to another Drop account", async () => {
    const mine = emailSubject("other@example.com");
    const theirs = emailSubject("jamie@example.com");
    const repo = fakeRepository({
      [mine]: profile(mine, { email: "other@example.com" }),
      [theirs]: profile(theirs, { elixirAccountId: "elixir-acct-1" }),
    });
    repo.pointers.set("elixir-acct-1", theirs);
    const res = await callback(
      repo,
      fakeElixir({ players: [KING] }),
      bearerFor(mine),
    );
    expect(String(res.headers?.location)).toBe(
      "https://drop.test/#/login?elixir=elixir_account_in_use",
    );
    expect(repo.must(mine).elixirAccountId).toBeUndefined();
    expect(repo.pointers.get("elixir-acct-1")).toBe(theirs);
    expect(repo.magic).toHaveLength(0);
  });
  it("link mode refuses a second Elixir account for a Drop account already bound", async () => {
    const mine = emailSubject("other@example.com");
    const repo = fakeRepository({
      [mine]: profile(mine, {
        email: "other@example.com",
        elixirAccountId: "elixir-acct-other",
      }),
    });
    repo.pointers.set("elixir-acct-other", mine);
    const res = await callback(
      repo,
      fakeElixir({ players: [KING] }),
      bearerFor(mine),
    );
    expect(String(res.headers?.location)).toBe(
      "https://drop.test/#/login?elixir=elixir_account_mismatch",
    );
    expect(repo.pointers.has("elixir-acct-1")).toBe(false);
    expect(repo.magic).toHaveLength(0);
  });
  it("link mode for a session whose account is gone fails closed", async () => {
    const repo = fakeRepository();
    const res = await callback(
      repo,
      fakeElixir({ players: [KING] }),
      bearerFor(emailSubject("gone@example.com")),
    );
    expect(String(res.headers?.location)).toBe(
      "https://drop.test/#/login?elixir=login_expired",
    );
    expect(repo.magic).toHaveLength(0);
    expect(repo.pending.size).toBe(0);
  });
  it("Recruiter attribution rides from start to an account the sign-in creates, and only to one", async () => {
    const recruiter = emailSubject("recruiter@example.com");
    const repo = fakeRepository();
    repo.shares.set("ABC234", recruiter);
    await callback(repo, fakeElixir({ players: [KING] }), undefined, {
      recruiterToken: "abc234",
    });
    expect(repo.magic[0]).toMatchObject({ recruiterSub: recruiter });
    const sub = emailSubject("jamie@example.com");
    const existing = fakeRepository({ [sub]: profile(sub) });
    existing.shares.set("ABC234", recruiter);
    await callback(existing, fakeElixir({ players: [KING] }), undefined, {
      recruiterToken: "ABC234",
    });
    expect(existing.magic[0]).not.toHaveProperty("recruiterSub");
    // A recruiter never credits themselves.
    const self = fakeRepository();
    self.shares.set("ABC234", sub);
    await callback(self, fakeElixir({ players: [KING] }), undefined, {
      recruiterToken: "ABC234",
    });
    expect(self.magic[0]).not.toHaveProperty("recruiterSub");
  });
  it("a signed-in browser carries no Recruiter attribution", async () => {
    const mine = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [mine]: profile(mine) });
    repo.shares.set("ABC234", emailSubject("recruiter@example.com"));
    await callback(repo, fakeElixir({ players: [KING] }), bearerFor(mine), {
      recruiterToken: "ABC234",
    });
    expect(repo.magic[0]).not.toHaveProperty("recruiterSub");
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
          playerTag: "#2PYQ0C",
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
// What Drop shows for a signed-in person comes from their Elixir account
// (2026-11-14): the verified primary player's name and the profile image.
describe("the name and picture come from Elixir", () => {
  async function signIn(
    repo: ReturnType<typeof fakeRepository>,
    fake: ReturnType<typeof fakeElixir>,
  ) {
    const { state } = await start(repo, fake);
    return elixirCallback(
      {
        request: event("GET", "/auth/elixir/callback", {
          query: { code: "c", state },
        }),
        config,
        repository: repo as never,
      },
      fake.client,
    );
  }
  const AVATAR = {
    card_id: 28000000,
    art_url: "https://elixir.test/cards/fireball.png",
    crop: { x: 0.5, y: 0.4, scale: 1.6 },
  };
  it("replaces the made-up name and Player Card, and keeps them once for an undo", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub) });
    await signIn(repo, fakeElixir({ players: [KING], me: { avatar: AVATAR } }));
    expect(repo.must(sub).publicName).toBe("King Thing");
    expect(repo.must(sub).favoriteCardId).toBe(28000000);
    expect(repo.must(sub).legacyIdentity).toEqual({
      publicName: "Builder",
      favoriteCardId: 26000000,
    });
    expect(publicProfile(repo.must(sub)).publicName).toBe("King Thing");
    // A later sign-in never overwrites the kept identity.
    await signIn(
      repo,
      fakeElixir({
        players: [KING],
        me: { avatar: { ...AVATAR, card_id: 26000000 } },
      }),
    );
    expect(repo.must(sub).favoriteCardId).toBe(26000000);
    expect(repo.must(sub).legacyIdentity).toEqual({
      publicName: "Builder",
      favoriteCardId: 26000000,
    });
  });
  it("keeps the picture when /me does not carry one yet, and clears it when Elixir says there is none", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub) });
    await signIn(repo, fakeElixir({ players: [KING] }));
    expect(repo.must(sub).favoriteCardId).toBe(26000000);
    await signIn(repo, fakeElixir({ players: [KING], me: { avatar: null } }));
    expect(repo.must(sub).favoriteCardId).toBeUndefined();
    // A card Drop's catalog does not hold is no picture, not a broken one.
    await signIn(
      repo,
      fakeElixir({
        players: [KING],
        me: { avatar: { ...AVATAR, card_id: 1 } },
      }),
    );
    expect(repo.must(sub).favoriteCardId).toBeUndefined();
  });
  it("shows no name for an unverified primary or an alt-only account: the fallback, never the alt's", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({ [sub]: profile(sub) });
    await signIn(
      repo,
      fakeElixir({ players: [{ ...KING, claim_status: "unverified" }] }),
    );
    expect(repo.must(sub).publicName).toBeUndefined();
    expect(publicProfile(repo.must(sub)).publicName).toBe("Elixir Player");
    await signIn(repo, fakeElixir({ players: [ALT, FRIEND] }));
    expect(repo.must(sub).publicName).toBeUndefined();
  });
  it("carries the name and picture to the redemption for a new account", async () => {
    const repo = fakeRepository();
    await signIn(repo, fakeElixir({ players: [KING], me: { avatar: AVATAR } }));
    const sub = emailSubject("jamie@example.com");
    expect(repo.pendingIdentity.get(sub)).toEqual({
      primaryName: "King Thing",
      avatarCardId: 28000000,
    });
  });
  it("leaves a profile bound to another Elixir account exactly as it is", async () => {
    const sub = emailSubject("jamie@example.com");
    const repo = fakeRepository({
      [sub]: profile(sub, { elixirAccountId: "someone-else" }),
    });
    await signIn(repo, fakeElixir({ players: [KING], me: { avatar: AVATAR } }));
    expect(repo.must(sub).publicName).toBe("Builder");
    expect(repo.must(sub).favoriteCardId).toBe(26000000);
  });
});
describe("the token request's client secret", () => {
  const SECRET = "ecs_test-secret-never-logged";
  function tokenDoor(status = 200) {
    const forms: URLSearchParams[] = [];
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toBe("https://elixir.test/oauth/token");
      forms.push(
        new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
      );
      return new Response(
        JSON.stringify(
          status === 200
            ? { access_token: "eat_1", scope: ELIXIR_SIGN_IN_SCOPE }
            : { error: "invalid_grant", error_description: "no" },
        ),
        { status, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    return { forms, fetchImpl };
  }
  const exchange = (client: ElixirOAuthClient) =>
    client.exchange({
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: "https://drop.test/api/auth/elixir/callback",
    });
  it("the exchange carries client_secret beside client_id when one is configured", async () => {
    const door = tokenDoor();
    const client = elixirClientFor(
      { ...config, elixirOAuthClientSecret: SECRET },
      door.fetchImpl,
    );
    expect((await exchange(client)).ok).toBe(true);
    expect(door.forms).toHaveLength(1);
    expect(door.forms[0]?.get("grant_type")).toBe("authorization_code");
    expect(door.forms[0]?.get("client_id")).toBe("client123");
    expect(door.forms[0]?.get("client_secret")).toBe(SECRET);
  });
  it("the exchange omits client_secret when none is configured", async () => {
    for (const elixirOAuthClientSecret of [undefined, ""]) {
      const door = tokenDoor();
      const client = elixirClientFor(
        { ...config, elixirOAuthClientSecret } as RouteContext["config"],
        door.fetchImpl,
      );
      expect((await exchange(client)).ok).toBe(true);
      expect(door.forms[0]?.get("client_id")).toBe("client123");
      expect(door.forms[0]?.has("client_secret")).toBe(false);
    }
  });
  it("no log line and no failure carries the form", async () => {
    const printed: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        printed.push(args.map((arg) => JSON.stringify(arg)).join(" "));
      }),
    );
    try {
      const outcomes = [];
      for (const status of [200, 400, 503]) {
        const door = tokenDoor(status);
        outcomes.push(
          await exchange(
            new ElixirOAuthClient({
              issuer: "https://elixir.test",
              clientId: "client123",
              clientSecret: SECRET,
              fetch: door.fetchImpl,
            }),
          ),
        );
      }
      const everything = [...printed, JSON.stringify(outcomes)].join("\n");
      for (const needle of [SECRET, "verifier-1", "code-1"])
        expect(everything).not.toContain(needle);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

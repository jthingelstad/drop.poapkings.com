import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Drop talks to Elixir only to sign people in (Jamie, 2026-11-13: "The only
// thing that I have a strong opinion on is that Elixir Drop uses Elixir
// authentication"), and writes nothing to it (2026-11-12). The one non-GET
// is OAuth's own token request. The behaviour is pinned where the client is
// tested (elixir-auth tests); this pins the shape of the source, so a new
// Elixir call cannot slip in beside sign-in unnoticed.
const SRC = join(import.meta.dirname, "..", "src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}

const files = sources(SRC).map((path) => ({
  name: relative(SRC, path),
  text: readFileSync(path, "utf8"),
}));

// Every Elixir URL Drop may reach, all of them Sign in with Elixir's: under
// the issuer, the API base (the token's resource) and the three OAuth
// endpoints; under the API base, `/me` alone.
const ISSUER_PATHS = [
  "/api/v1",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/userinfo",
];
const API_V1_PATHS = ["/me"];

describe("Drop talks to Elixir only to sign people in", () => {
  it("only the sign-in client makes HTTP requests", () => {
    const callers = files
      .filter(({ text }) => /\b(fetch|fetcher|fetchImpl)\s*\(/.test(text))
      .map(({ name }) => name)
      .sort();
    expect(callers).toEqual(["elixir-oauth.ts"]);
  });

  it("the sign-in client reaches the allowed Elixir URLs and no others", () => {
    const text = files.find((f) => f.name === "elixir-oauth.ts")!.text;
    const oauth = [
      ...text.matchAll(/\$\{this\.issuer\}(\/[A-Za-z0-9_/-]*)/g),
    ].map((m) => m[1] ?? "");
    expect([...new Set(oauth)].sort((a, b) => a.localeCompare(b))).toEqual(
      ISSUER_PATHS,
    );
    const api = [...text.matchAll(/this\.get\([^,]+,\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(api).toEqual(API_V1_PATHS);
  });

  it("the sign-in client's one POST is the token request", () => {
    const text = files.find((f) => f.name === "elixir-oauth.ts")!.text;
    const methods = [...text.matchAll(/method:\s*"([A-Z]+)"/g)].map(
      (m) => m[1],
    );
    expect(methods.filter((m) => m !== "GET")).toEqual(["POST"]);
    const post = text.indexOf('method: "POST"');
    const call = text.lastIndexOf("this.fetchImpl(", post);
    expect(text.slice(call, post)).toContain("/oauth/token");
  });

  it.each([
    // Retired 2026-11-13: Drop computes the season clock itself.
    "/game/clock",
    // Retired 2026-11-13: name and clan come from the sign-in read.
    "/players/",
    // Retired 2026-11-12: Drop writes nothing to Elixir.
    "/profile-refreshes",
    "/me/players",
  ])("no source names the retired Elixir endpoint %s", (path) => {
    // Quoted, so a comment recording a retirement does not count. Drop
    // serves its own `/players/` and `/me/...` routes, so those need the
    // API prefix; Drop never had a clock route of its own.
    const prefix = path === "/game/clock" ? "(/api/v1)?" : "/api/v1";
    // Paths are letters and slashes, so they need no escaping here.
    const literal = new RegExp(`["'\`]${prefix}${path}`);
    expect(
      files.filter(({ text }) => literal.test(text)).map(({ name }) => name),
    ).toEqual([]);
  });

  it("holds no Elixir integration key", () => {
    expect(
      files
        .filter(({ text }) =>
          /ELIXIR_INTEGRATION_KEY|ELIXIR_MCP_KEY|elixirMcpKey/.test(text),
        )
        .map(({ name }) => name),
    ).toEqual([]);
  });
});

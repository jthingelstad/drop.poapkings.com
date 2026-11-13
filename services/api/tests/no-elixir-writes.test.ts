import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Drop writes nothing to Elixir (Jamie, 2026-11-12: "no writing to Elixir
// and ONLY authenticating and getting a verified clash Royale account"). The
// one non-GET it may send is OAuth's own token request. The behaviour is
// pinned where each client is tested (elixir-auth and elixir-mcp tests);
// this pins the shape of the source, so a new write cannot slip in beside
// them unnoticed.
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

describe("Drop sends Elixir reads only", () => {
  it("only the two Elixir clients make HTTP requests", () => {
    const callers = files
      .filter(({ text }) => /\b(fetch|fetcher|fetchImpl)\s*\(/.test(text))
      .map(({ name }) => name)
      .sort();
    expect(callers).toEqual(["elixir-mcp.ts", "elixir-oauth.ts"]);
  });

  it("the integration client sends GET and nothing else", () => {
    const text = files.find((f) => f.name === "elixir-mcp.ts")!.text;
    expect(
      [...text.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]),
    ).toEqual(["GET"]);
    expect(text).not.toMatch(/\bbody\s*:/);
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
});

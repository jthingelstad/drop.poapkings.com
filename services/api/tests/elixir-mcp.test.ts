import { describe, expect, it, vi } from "vitest";
import { callTool, addPlayerToCollection } from "../src/elixir-mcp.js";
import { rememberPlayerInCollection } from "../src/elixir-collection.js";
import type { Config } from "../src/config.js";

const config = {
  baseUrl: "https://elixir.example",
  token: "svt_test",
};

/** The hub answers JSON-RPC; tool results arrive as JSON in content[0].text. */
function hubReply(payload: unknown, isError = false) {
  return vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { isError, content: [{ text: JSON.stringify(payload) }] },
    }),
    text: async () => "",
  }));
}

describe("Elixir MCP client", () => {
  it("calls one tool over JSON-RPC with the service token", async () => {
    const fetcher = hubReply({ slug: "elixir-drop", added: 1, members: 14 });
    const result = await callTool(
      config,
      "collections_edit",
      { slug: "elixir-drop", action: "add", tags: ["#2YG98VVQ"] },
      fetcher,
    );
    expect(result).toMatchObject({ added: 1, members: 14 });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe("https://elixir.example/mcp");
    expect((call[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer svt_test",
    );
    const body: {
      method: string;
      params: { name: string; arguments: { tags: string[] } };
    } = JSON.parse(call[1].body as string);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("collections_edit");
    expect(body.params.arguments.tags).toEqual(["#2YG98VVQ"]);
  });

  it("turns a tool refusal into a throw, not a silent success", async () => {
    // The hub reports tool failures as a RESULT carrying isError, so a
    // naive client would read a refusal as a successful call.
    const fetcher = hubReply(
      { error: "not_entitled", message: "'x' belongs to someone else." },
      true,
    );
    await expect(
      callTool(config, "collections_edit", {}, fetcher),
    ).rejects.toThrow(/belongs to someone else/);
  });

  it("surfaces the shared rate limit distinctly", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => "",
    }));
    await expect(
      callTool(config, "collections_edit", {}, fetcher),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("refuses to call at all when the hub is unconfigured", async () => {
    const fetcher = hubReply({});
    await expect(
      callTool({ baseUrl: "https://elixir.example" }, "x", {}, fetcher),
    ).rejects.toMatchObject({ code: "unconfigured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("dedupes tags and skips the call when there is nothing to add", async () => {
    const fetcher = hubReply({ added: 1 });
    await addPlayerToCollection(
      config,
      "elixir-drop",
      ["#2YG98VVQ", "#2YG98VVQ"],
      fetcher,
    );
    const sent: { params: { arguments: { tags: string[] } } } = JSON.parse(
      fetcher.mock.calls[0]![1].body as string,
    );
    expect(sent.params.arguments.tags).toEqual(["#2YG98VVQ"]);

    const idle = hubReply({});
    expect(
      await addPlayerToCollection(config, "elixir-drop", [], idle),
    ).toBeUndefined();
    expect(idle).not.toHaveBeenCalled();
  });
});

describe("collection membership on the Drop side", () => {
  const dropConfig = {
    elixirMcpBaseUrl: "https://elixir.example",
    elixirMcpKey: "svt_test",
    elixirMcpCollectionSlug: "elixir-drop",
  } as Config;

  it("adds a saved tag", async () => {
    const fetcher = hubReply({ added: 1, members: 1 });
    await rememberPlayerInCollection(dropConfig, "#2YG98VVQ", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does nothing for an account with no tag", async () => {
    // Most Drop accounts have none: the tag is optional and stays out
    // of setup, so this is the common path, not an edge case.
    const fetcher = hubReply({});
    await rememberPlayerInCollection(dropConfig, undefined, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does nothing when the hub is not wired", async () => {
    const fetcher = hubReply({});
    await rememberPlayerInCollection(
      { ...dropConfig, elixirMcpKey: undefined } as Config,
      "#2YG98VVQ",
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never lets a hub outage fail the login that triggered it", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => {
      throw new Error("connect ECONNREFUSED");
    });
    await expect(
      rememberPlayerInCollection(dropConfig, "#2YG98VVQ", fetcher),
    ).resolves.toBeUndefined();
  });
});

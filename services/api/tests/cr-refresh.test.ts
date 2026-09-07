import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../src/repository.js";
import { publicCrProfile, requestCrProfileRefresh } from "../src/cr-refresh.js";

describe("CR profile refresh policy", () => {
  it("returns an immediately useful pending profile before the bridge responds", () => {
    expect(publicCrProfile("#2PYQ0", undefined)).toEqual({
      tag: "#2PYQ0",
      status: "pending",
    });
  });

  it("keeps player tags and provider details out of failure warnings", async () => {
    const playerTag = "#PRIVATE";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const markCrRefreshUnavailable = vi.fn().mockResolvedValue(undefined);
    const repository = {
      claimCrRefresh: vi.fn().mockResolvedValue(true),
      markCrRefreshUnavailable,
    } as unknown as Repository;
    let call = 0;
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => {
      call += 1;
      const result =
        call === 1
          ? {
              isError: true,
              content: [
                {
                  text: JSON.stringify({ error: "not_recorded" }),
                },
              ],
            }
          : undefined;
      return {
        ok: true,
        status: 200,
        json: async () =>
          result
            ? { jsonrpc: "2.0", id: call, result }
            : {
                jsonrpc: "2.0",
                id: call,
                error: { message: `provider detail for ${playerTag}` },
              },
        text: async () => "",
      };
    });

    try {
      await expect(
        requestCrProfileRefresh(
          repository,
          {
            elixirMcpBaseUrl: "https://elixir.example",
            elixirMcpKey: "svt_test",
          },
          playerTag,
          new Date("2026-09-07T00:00:00.000Z"),
          fetcher,
        ),
      ).rejects.toThrow("provider detail");
      expect(warn).toHaveBeenCalledWith("Elixir MCP player enrichment failed", {
        error: "ElixirMcpError",
      });
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain(playerTag);
      expect(logged).not.toContain("provider detail");
      expect(markCrRefreshUnavailable).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});

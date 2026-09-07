import { expect, it, vi } from "vitest";
import { measure, withTimings } from "../src/timings.js";

it("keeps concurrent request timings separate and records failed operations without payloads", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    await Promise.all([
      withTimings("GET /me", () =>
        measure("database.read", async () => "private@example.invalid"),
      ),
      withTimings("GET /stats", () =>
        measure("mcp.war_current", async () => {
          throw new Error("secret failure payload");
        }),
      ).catch(() => undefined),
    ]);
    const entries = log.mock.calls.map((call) => call[0]);
    expect(entries).toHaveLength(2);
    expect(
      entries.find((entry) => entry.route === "GET /me").operations,
    ).toEqual([
      { operation: "database.read", calls: 1, elapsedMs: expect.any(Number) },
    ]);
    expect(
      entries.find((entry) => entry.route === "GET /stats").operations,
    ).toEqual([
      { operation: "mcp.war_current", calls: 1, elapsedMs: expect.any(Number) },
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/private|secret/);
  } finally {
    log.mockRestore();
  }
});

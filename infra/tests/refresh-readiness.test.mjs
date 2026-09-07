import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waitForFreshSeasonClock } from "../scripts/refresh-readiness.mjs";

const now = Date.parse("2026-09-07T03:00:00Z");
const fresh = {
  currentSeason: {
    id: 135,
    source: "clash-royale",
    clockUpdatedAt: new Date(now).toISOString(),
  },
};

void describe("background season clock readiness", () => {
  void it("waits for the queued refresh after a stale first response", async () => {
    const responses = [
      { currentSeason: { source: "calendar-fallback" } },
      fresh,
    ];
    let sleeps = 0;
    assert.equal(
      await waitForFreshSeasonClock(async () => responses.shift(), {
        attempts: 2,
        now: () => now,
        sleep: async () => {
          sleeps += 1;
        },
      }),
      fresh,
    );
    assert.equal(sleeps, 1);
  });

  for (const clockUpdatedAt of [
    new Date(now - 16 * 60_000).toISOString(),
    new Date(now + 1000).toISOString(),
    "invalid",
  ]) {
    void it(`rejects a clock that remains unready: ${clockUpdatedAt}`, async () => {
      let reads = 0;
      await assert.rejects(
        waitForFreshSeasonClock(
          async () => {
            reads += 1;
            return {
              currentSeason: { ...fresh.currentSeason, clockUpdatedAt },
            };
          },
          { attempts: 2, now: () => now, sleep: async () => {} },
        ),
        /did not become fresh/,
      );
      assert.equal(reads, 2);
    });
  }

  void it("preserves HTTP and contract failures without readiness retries", async () => {
    await assert.rejects(
      waitForFreshSeasonClock(
        async () => {
          throw new Error("Stats check failed");
        },
        {
          sleep: async () => assert.fail("must not retry"),
        },
      ),
      /Stats check failed/,
    );
  });
});

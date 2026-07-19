import { describe, expect, it, vi } from "vitest";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { fetchWarClock, relayWarClock } from "../src/war-clock.js";

function fixtureFetch(options?: {
  sectionIndex?: number;
  periodIndex?: number;
  periodType?: string;
  logs?: Array<Record<string, unknown>>;
}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const body = url.includes("currentriverrace")
      ? {
          sectionIndex: options?.sectionIndex ?? 1,
          periodIndex: options?.periodIndex ?? 12,
          periodType: options?.periodType ?? "warDay",
        }
      : {
          items: options?.logs ?? [
            {
              seasonId: 134,
              sectionIndex: 0,
              createdDate: "20260713T093006.000Z",
            },
            {
              seasonId: 133,
              sectionIndex: 4,
              createdDate: "20260706T093703.000Z",
            },
          ],
        };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("Clan Wars clock relay", () => {
  it("normalizes the live CR week and anchors the reset on the observed race close", async () => {
    const fetcher = fixtureFetch();
    const result = await fetchWarClock(
      "#J2RGCRVG",
      "test-key",
      fetcher,
      new Date("2026-07-18T19:00:00.000Z"),
    );

    expect(result).toEqual({
      version: 1,
      type: "war-clock-result",
      clock: {
        crSeasonId: 134,
        sectionIndex: 1,
        periodIndex: 12,
        periodType: "warDay",
        // The reset hour drifts per season; the latest race close in the log
        // (09:30) anchors the period math, not a hardcoded 10:00 UTC.
        seasonStartsAt: "2026-07-06T09:30:00.000Z",
        observedAt: "2026-07-18T19:00:00.000Z",
        sourceClanTag: "#J2RGCRVG",
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("advances the CR season when the clock rolls before the new log exists", async () => {
    const result = await fetchWarClock(
      "#J2RGCRVG",
      "test-key",
      fixtureFetch({
        sectionIndex: 0,
        periodIndex: 0,
        periodType: "training",
        logs: [
          {
            seasonId: 134,
            sectionIndex: 3,
            createdDate: "20260803T093003.000Z",
          },
        ],
      }),
      new Date("2026-08-03T10:01:00.000Z"),
    );

    expect(result.clock).toMatchObject({
      crSeasonId: 135,
      sectionIndex: 0,
      periodIndex: 0,
      seasonStartsAt: "2026-08-03T09:30:00.000Z",
    });
  });

  it("rejects out-of-range Clan Wars indexes", async () => {
    await expect(
      fetchWarClock(
        "#J2RGCRVG",
        "test-key",
        fixtureFetch({ periodIndex: 500 }),
        new Date("2026-07-18T19:00:00.000Z"),
      ),
    ).rejects.toThrow("out-of-range");
  });

  it("puts the normalized clock onto the existing result queue", async () => {
    const commands: SendMessageCommand[] = [];
    const sqs = {
      send: vi.fn(async (command: SendMessageCommand) => {
        commands.push(command);
        return {};
      }),
    };
    vi.stubGlobal("fetch", fixtureFetch());
    const result = await relayWarClock(
      sqs as never,
      "https://sqs.example/results",
      "#J2RGCRVG",
      "test-key",
    );

    expect(commands[0]?.input.QueueUrl).toBe("https://sqs.example/results");
    expect(JSON.parse(String(commands[0]?.input.MessageBody))).toEqual(result);
    vi.unstubAllGlobals();
  });
});

import { describe, expect, it, vi } from "vitest";
import { apiRequest, addPlayerToCollection } from "../src/elixir-mcp.js";
import { rememberPlayerInCollection } from "../src/elixir-collection.js";
import {
  fetchPlayerFromHub,
  normalizeRecordedPlayer,
} from "../src/elixir-player.js";
import { toWarClock, fetchWarClockFromHub } from "../src/elixir-war-clock.js";
import { seasonForDate } from "../src/seasons.js";
const config = { baseUrl: "https://elixir.example", token: "svt_test" };
const dropConfig = {
  elixirMcpBaseUrl: config.baseUrl,
  elixirMcpKey: config.token,
  elixirMcpCollectionSlug: "elixir-drop",
};
function reply(value: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => (status < 400 ? { data: value } : value),
    text: async () => "",
  };
}
const recorded = {
  name: "Example",
  observed_at: new Date().toISOString(),
  clan: { clan_tag: "#2PYQ0", name: "Clan", badge_id: 123, role: "member" },
  attributes: { years_played: 2, account_age_days: 800 },
};
it("uses bearer REST with encoded resources and idempotent membership", async () => {
  const fetcher = vi.fn(async () => reply({ enrollment_established: true }));
  await addPlayerToCollection(
    config,
    "elixir-drop",
    ["#2PYQ0", "#2PYQ0"],
    fetcher,
  );
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledWith(
    "https://elixir.example/api/v1/collections/elixir-drop/members/%232PYQ0",
    expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({ Authorization: "Bearer svt_test" }),
    }),
  );
  await addPlayerToCollection(config, "elixir-drop", [], fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not send absent tags, and leaves enrollment failures for the worker to retry", async () => {
  const fetcher = vi.fn(async () =>
    reply({ code: "temporarily_unavailable" }, 503),
  );
  await rememberPlayerInCollection(dropConfig, undefined, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    rememberPlayerInCollection(dropConfig, "#2PYQ0", fetcher),
  ).rejects.toMatchObject({ status: 503 });
});
it("retains recorded source time and never refreshes on an authentication failure", async () => {
  const fetcher = vi.fn(async () => reply(recorded));
  expect(await fetchPlayerFromHub(dropConfig, "#2PYQ0", fetcher)).toMatchObject(
    {
      name: "Example",
      observedAt: recorded.observed_at,
      clan: { badgeId: 123 },
      accountAge: { days: 800 },
    },
  );
  const denied = vi.fn(async () => reply({ code: "unauthenticated" }, 401));
  await expect(
    fetchPlayerFromHub(dropConfig, "#2PYQ0", denied),
  ).rejects.toMatchObject({ status: 401 });
  expect(denied).toHaveBeenCalledTimes(1);
  expect(normalizeRecordedPlayer({})).toBeUndefined();
});
it("requests an asynchronous refresh for missing or stale data, and propagates pending", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ code: "not_recorded" }, 404))
    .mockResolvedValue(
      reply(
        { id: "00000000-0000-4000-8000-000000000001", status: "pending" },
        202,
      ),
    );
  await expect(
    fetchPlayerFromHub(dropConfig, "#2PYQ0", fetcher, async () => {}),
  ).rejects.toMatchObject({ code: "refresh_pending" });
  expect(fetcher.mock.calls[1]![0]).toBe(
    "https://elixir.example/api/v1/profile-refreshes",
  );
  expect(fetcher.mock.calls[1]![1].headers["Idempotency-Key"]).toContain(
    "profile:#2PYQ0:",
  );
  const stale = vi
    .fn()
    .mockResolvedValueOnce(
      reply({ ...recorded, observed_at: "2025-01-01T00:00:00Z" }),
    )
    .mockResolvedValueOnce(reply({ status: "complete", profile: recorded }));
  expect(await fetchPlayerFromHub(dropConfig, "#2PYQ0", stale)).toMatchObject({
    observedAt: recorded.observed_at,
  });
  expect(stale).toHaveBeenCalledTimes(2);
});
it("refuses absent config and malformed responses", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
  }));
  await expect(
    apiRequest(
      { baseUrl: config.baseUrl },
      "GET",
      "/game/clock",
      undefined,
      fetcher,
    ),
  ).rejects.toMatchObject({ code: "unconfigured" });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    apiRequest(config, "GET", "/game/clock", undefined, fetcher),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
const calendar = {
  source: "policy",
  as_of: "2026-09-08T12:00:00Z",
  season_id: 136,
  section_index: 0,
  period_index: 1,
  day_kind: "training",
  season_started_at: "2026-09-07T10:00:00Z",
  season_ends_at: "2026-10-05T10:00:00Z",
  day_started_at: "2026-09-08T10:00:00Z",
  day_ends_at: "2026-09-09T10:00:00Z",
};
it("uses explicit policy boundaries and expires the old season at reset", async () => {
  const clock = toWarClock(calendar);
  expect(clock).toMatchObject({
    clockSource: "policy",
    seasonStartsAt: calendar.season_started_at,
    seasonEndsAt: calendar.season_ends_at,
  });
  expect(clock.sourceClanTag).toBeUndefined();
  const fetcher = vi.fn(async () => reply(calendar));
  await fetchWarClockFromHub(dropConfig, new Date(), fetcher);
  expect(fetcher).toHaveBeenCalledWith(
    "https://elixir.example/api/v1/game/clock",
    expect.objectContaining({ method: "GET" }),
  );
  const stored = { ...clock, updatedAt: clock.observedAt };
  expect(seasonForDate(new Date("2026-10-05T09:59:59Z"), stored).id).toBe(136);
  expect(seasonForDate(new Date("2026-10-05T10:00:00Z"), stored).id).toBe(137);
  expect(() =>
    toWarClock({ ...calendar, day_ends_at: calendar.day_started_at }),
  ).toThrow();
  expect(() => toWarClock({ ...calendar, source: "observation" })).toThrow();
});
it("keeps only rendered recorded facts and rejects incomplete clan data", () => {
  expect(
    normalizeRecordedPlayer({
      ...recorded,
      clan: { clan_tag: "#2PYQ0", name: "Clan", badge_id: null },
    })?.clan,
  ).toBeUndefined();
  expect(
    normalizeRecordedPlayer({
      name: "Example",
      attributes: { years_played: null, account_age_days: null },
    })?.accountAge,
  ).toBeUndefined();
  expect(normalizeRecordedPlayer(recorded)).toEqual({
    name: "Example",
    clan: { tag: "#2PYQ0", name: "Clan", badgeId: 123, role: "member" },
    accountAge: { days: 800, years: 2 },
  });
});

describe("a season rollover still closes the previous season", () => {
  it("finalizes before storing, and only when the season id moves", async () => {
    // This ran off the bridge's war-clock result. When the bridge was
    // retired it had to come with the clock; missing it would have meant
    // podium badges and placement XP silently stopped being awarded at
    // the season boundary, with nothing failing.
    const { finalizePreviousSeasonIfNeeded } = await import("../src/podium.js");
    const calls: { seasonId: number }[] = [];
    const repository = {
      getCrWarClock: async () => ({
        crSeasonId: 134,
        observedAt: "2026-08-01T10:00:00.000Z",
      }),
      seasonFinalists: async () => {
        calls.push({ seasonId: 134 });
        return [];
      },
    } as never;

    // A newer clock carrying a NEW season closes the old one.
    await finalizePreviousSeasonIfNeeded(repository, {
      crSeasonId: 135,
      observedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(calls.length).toBeGreaterThan(0);

    // The same season, arriving repeatedly, must not re-finalize.
    calls.length = 0;
    await finalizePreviousSeasonIfNeeded(repository, {
      crSeasonId: 134,
      observedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(calls).toEqual([]);
  });
});

it("polls an accepted profile refresh in the background before falling back to queue retry", async () => {
  const id = "00000000-0000-4000-8000-000000000002";
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ code: "not_recorded" }, 404))
    .mockResolvedValueOnce(reply({ id, status: "pending" }, 202))
    .mockResolvedValueOnce(
      reply({ id, status: "complete", profile: recorded }),
    );
  const sleep = vi.fn(async () => {});
  expect(
    await fetchPlayerFromHub(dropConfig, "#2PYQ0", fetcher, sleep),
  ).toMatchObject({ observedAt: recorded.observed_at });
  expect(sleep).toHaveBeenCalledWith(5000);
  expect(fetcher.mock.calls[2]![0]).toBe(
    `https://elixir.example/api/v1/profile-refreshes/${id}`,
  );
  expect(fetcher.mock.calls[2]![1].method).toBe("GET");
});

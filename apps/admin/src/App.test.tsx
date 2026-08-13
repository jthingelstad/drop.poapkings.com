import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function fixtureFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (path === "/api/overview")
      return response({
        status: "ok",
        generatedAt: "2026-08-13T12:00:00.000Z",
        operator: "jamie",
        csrfToken: "csrf",
        totals: { players: 1, runs: 2, pending: 1, restricted: 0 },
        players: [
          {
            playerId: "player-1",
            playerReference: "#P1234567890",
            publicName: "Knight Main",
            favoriteCardId: 26000000,
            playerTag: "#2PYQ0",
            email: "player@example.com",
            clashName: "King Thing",
            clanName: "POAP KINGS",
            totalGames: 2,
            xp: 30,
            runCount: 2,
            modes: { surge: 2 },
            reviewedRuns: 0,
            pendingRuns: 1,
            excludedRuns: 0,
            earnedBadges: 1,
            rankedAccess: "allowed",
          },
        ],
        recentRuns: [],
        reviewQueue: [],
      });
    if (path === "/api/players/player-1")
      return response({
        status: "ok",
        playerId: "player-1",
        playerReference: "#P1234567890",
        player: { publicName: "Knight Main", favoriteCardId: 26000000 },
        account: {
          playerId: "player-1",
          email: "player@example.com",
          publicName: "Knight Main",
          favoriteCardId: 26000000,
          playerTag: "#2PYQ0",
          totalGames: 2,
          xp: 30,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:00.000Z",
          lastLoginAt: "2026-08-13T11:00:00.000Z",
        },
        clashRoyale: {
          tag: "#2PYQ0",
          status: "ready",
          name: "King Thing",
          clan: { name: "POAP KINGS", tag: "#9V2Y", role: "leader" },
          cardCount: 120,
          fetchedAt: "2026-08-13T11:01:00.000Z",
        },
        changes: [],
        badges: {
          earned: { "surge-runner": ["2026-08-01"] },
          values: { "surge-runner": 12 },
        },
        rankedAccess: { status: "allowed" },
        totalRuns: 2,
        progression: {
          surge: [
            {
              runId: "run-1",
              runReference: "#D1234567890",
              score: 12004,
              seasonId: "2026-08",
              completedAt: "2026-08-13T10:00:00.000Z",
              decision: { queueState: "pending", visibility: "visible" },
            },
            {
              runId: "run-2",
              runReference: "#D0987654321",
              score: 18030,
              seasonId: "2026-07",
              completedAt: "2026-07-20T10:00:00.000Z",
            },
          ],
        },
      });
    if (path === "/api/runs/run-1")
      return response({
        status: "ok",
        runReference: "#D1234567890",
        run: {
          runId: "run-1",
          playerId: "player-1",
          mode: "surge",
          score: 12004,
          completedAt: "2026-08-13T10:00:00.000Z",
          wallElapsedMs: 13000,
          transcript: {
            answers: [{ cardId: 26000000, guesses: [3], atMs: 300 }],
          },
          timing: { model: "client-events-v1", inputCount: 1 },
          correlation: { complete: { uaFamily: "Safari/iOS" } },
          scoringVersion: { web: "abc123", rules: "v4" },
        },
        decision: { queueState: "pending", reason: "Leading score" },
      });
    if (path === "/api/runs/decisions" && init?.method === "POST")
      return response({
        status: "ok",
        requested: 1,
        succeeded: [{ runId: "run-1", runReference: "#D1234567890" }],
        failed: [],
      });
    throw new Error(`Unexpected fetch ${path}`);
  });
}

async function renderApp() {
  const fetchMock = fixtureFetch();
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    render(<App />, host);
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  return { host, fetchMock };
}

it("keeps the searchable player directory open beside filterable run history", async () => {
  const { host } = await renderApp();
  await vi.waitFor(() => expect(host.textContent).toContain("Knight Main"));
  expect(host.textContent).toContain("player@example.com");
  expect(host.textContent).toContain("#P1234567890");
  expect(host.textContent).toContain("2 of 2 runs");
  expect(host.textContent).toContain("🔎 Pending");
  expect(
    host.querySelector(
      'input[placeholder="Name, email, #P, Clash tag, clan…"]',
    ),
  ).not.toBeNull();
  expect(
    host.querySelector('input[placeholder="Run tag, UUID, or season"]'),
  ).not.toBeNull();
  expect(host.textContent).toContain("Max time (s)");
  render(null, host);
});

it("shows private account context and drills through to retained submission JSON", async () => {
  const { host } = await renderApp();
  await vi.waitFor(() => expect(host.textContent).toContain("#D1234567890"));

  const runButton = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("#D1234567890"),
  );
  await act(async () => {
    runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Client submission JSON"),
  );
  expect(host.textContent).toContain(
    "verified at submission; secret token not retained",
  );
  expect(host.textContent).toContain("Safari/iOS");
  expect(host.textContent).toContain("Full evidence envelope");

  const back = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Back to runs"),
  );
  await act(async () => {
    back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const profile = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Profile",
  );
  await act(async () => {
    profile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(host.textContent).toContain("Last login");
  expect(host.textContent).toContain("King Thing");
  expect(host.textContent).toContain("POAP KINGS");
  expect(host.textContent).toContain("Edit profile");
  expect(host.textContent).toContain("authentication key");
  render(null, host);
});

it("selects runs and requires confirmation before a bulk status change", async () => {
  const { host, fetchMock } = await renderApp();
  await vi.waitFor(() => expect(host.textContent).toContain("#D1234567890"));

  const checkbox = host.querySelector<HTMLInputElement>(
    'input[aria-label="Select #D1234567890"]',
  );
  await act(async () => checkbox?.click());
  expect(host.textContent).toContain("1 selected");
  expect(host.textContent).toContain(
    "Each run receives its own immutable audit",
  );

  const reason = host.querySelector<HTMLTextAreaElement>(
    'textarea[placeholder="Evidence-based reason applied to every selected run"]',
  );
  await act(async () => {
    if (reason) reason.value = "Evidence supports normal human play.";
    reason?.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  const apply = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Apply to 1 run"),
  );
  await act(async () => apply?.click());
  expect(host.textContent).toContain("Confirm 1 decision");
  expect(
    fetchMock.mock.calls.some(([input]) => input === "/api/runs/decisions"),
  ).toBe(false);

  const confirm = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Confirm 1 decision"),
  );
  await act(async () => {
    confirm?.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("1 audited decision recorded"),
  );
  const bulkCall = fetchMock.mock.calls.find(
    ([input]) => input === "/api/runs/decisions",
  );
  const bulkBody = bulkCall?.[1]?.body;
  expect(typeof bulkBody).toBe("string");
  if (typeof bulkBody !== "string")
    throw new Error("Missing bulk request body");
  expect(JSON.parse(bulkBody)).toEqual({
    runIds: ["run-1"],
    action: "clear",
    reason: "Evidence supports normal human play.",
  });
  render(null, host);
});

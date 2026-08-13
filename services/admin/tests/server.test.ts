import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAdminServer, type ScriptRunner } from "../src/server.js";

let close: (() => Promise<void>) | undefined;

beforeEach(() => vi.clearAllMocks());
afterEach(async () => close?.());

async function fixture(
  runner: ScriptRunner,
  bypass = true,
  accountRunner: ScriptRunner = vi.fn(async () => ({
    status: "ok",
    accounts: [],
    account: {},
    changes: [],
  })),
) {
  const staticRoot = await mkdtemp(join(tmpdir(), "drop-admin-"));
  await writeFile(join(staticRoot, "index.html"), "<h1>Control Room</h1>");
  const server = createAdminServer({
    repoRoot: "/repo",
    staticRoot,
    allowedLogin: "jamie@example.com",
    devBypassIdentity: bypass,
    runner,
    accountRunner,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${address.port}`;
}

it("requires the trusted Tailscale identity header outside local development", async () => {
  const base = await fixture(vi.fn(), false);
  const rejected = await fetch(`${base}/api/overview`);
  expect(rejected.status).toBe(401);
  const accepted = await fetch(`${base}/`, {
    headers: { "Tailscale-User-Login": "jamie@example.com" },
  });
  expect(accepted.status).toBe(200);
  expect(await accepted.text()).toContain("Control Room");
});

it("composes the overview from sanitized referee scripts", async () => {
  const runner = vi.fn(async () => ({
    status: "ok",
    totals: { players: 3 },
    players: [],
  }));
  const base = await fixture(runner);
  const response = await fetch(`${base}/api/overview`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    status: "ok",
    operator: "local-development",
    totals: { players: 3 },
  });
  expect(runner).toHaveBeenCalledTimes(1);
  expect(typeof body.csrfToken).toBe("string");
});

it("joins least-privilege account context into the player directory", async () => {
  const runner = vi.fn(async () => ({
    status: "ok",
    totals: { players: 1 },
    players: [{ playerId: "player-1", playerReference: "#PONE" }],
  }));
  const accountRunner = vi.fn(async () => ({
    status: "ok",
    accounts: [
      {
        playerId: "player-1",
        email: "player@example.com",
        clashName: "King Thing",
        clanName: "POAP KINGS",
      },
    ],
  }));
  const base = await fixture(runner, true, accountRunner);
  const response = await fetch(`${base}/api/overview`);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    players: [
      {
        playerId: "player-1",
        playerReference: "#PONE",
        email: "player@example.com",
        clanName: "POAP KINGS",
      },
    ],
  });
  expect(accountRunner).toHaveBeenCalledWith("control-players.mjs");
});

it("maps a verified exclusion to the sanctioned referee command", async () => {
  let csrf = "";
  const runner = vi.fn(async (script: string) =>
    script === "referee-players.mjs"
      ? { status: "ok" }
      : { status: "ok", runReference: "#DONE", run: { runId: "run-1" } },
  );
  const base = await fixture(runner);
  csrf = String(
    (
      (await (await fetch(`${base}/api/overview`)).json()) as {
        csrfToken: string;
      }
    ).csrfToken,
  );
  const response = await fetch(`${base}/api/runs/run-1/decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      "X-Drop-Admin-CSRF": csrf,
    },
    body: JSON.stringify({
      action: "exclude",
      reason: "Multiple independent timing signals.",
      playerReason: "combined_evidence",
    }),
  });
  expect(response.status).toBe(200);
  expect(runner).toHaveBeenCalledWith("referee-decide.mjs", [
    "run-1",
    "--disposition",
    "review",
    "--visibility",
    "hidden",
    "--reason",
    "Multiple independent timing signals.",
    "--player-reason",
    "combined_evidence",
  ]);
});

it("rejects writes without same-origin CSRF proof", async () => {
  const runner = vi.fn(async () => ({ status: "ok" }));
  const base = await fixture(runner);
  const response = await fetch(`${base}/api/runs/run-1/decision`, {
    method: "POST",
    body: "{}",
  });
  expect(response.status).toBe(403);
  expect(runner).not.toHaveBeenCalled();
});

it("maps a profile correction to the separate audited account command", async () => {
  const runner = vi.fn(async (script: string) =>
    script === "referee-players.mjs"
      ? { status: "ok", players: [] }
      : { status: "ok", playerId: "player-1", player: {} },
  );
  const accountRunner = vi.fn<ScriptRunner>(
    async (script: string, _args?: string[]) =>
      script === "control-players.mjs"
        ? { status: "ok", accounts: [] }
        : {
            status: "ok",
            account: { email: "player@example.com" },
            changes: [],
          },
  );
  const base = await fixture(runner, true, accountRunner);
  const overview = (await (await fetch(`${base}/api/overview`)).json()) as {
    csrfToken: string;
  };
  const response = await fetch(`${base}/api/players/player-1/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      "X-Drop-Admin-CSRF": overview.csrfToken,
    },
    body: JSON.stringify({
      publicName: "Knight Main",
      favoriteCardId: 26000000,
      playerTag: "#2PYQ0",
      reason: "Correcting the linked player profile.",
    }),
  });
  expect(response.status).toBe(200);
  const updateCall = accountRunner.mock.calls.find(
    ([script]) => script === "control-player-update.mjs",
  );
  expect(updateCall).toBeDefined();
  const encoded = updateCall?.[1]?.[2];
  expect(
    JSON.parse(Buffer.from(String(encoded), "base64url").toString("utf8")),
  ).toEqual({
    publicName: "Knight Main",
    favoriteCardId: 26000000,
    playerTag: "#2PYQ0",
    reason: "Correcting the linked player profile.",
    operator: "local-development",
  });
});

it("gives launchd the executable path required by the AWS credential process", async () => {
  const installer = await readFile(
    new URL("../scripts/install-launchd.mjs", import.meta.url),
    "utf8",
  );
  expect(installer).toContain("<key>PATH</key>");
  expect(installer).toContain("${dirname(node)}:/opt/homebrew/bin");
  expect(installer).toContain("DROP_ADMIN_ACCOUNT_PROFILE");
});

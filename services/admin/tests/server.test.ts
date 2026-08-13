import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAdminServer, type ScriptRunner } from "../src/server.js";

let close: (() => Promise<void>) | undefined;

beforeEach(() => vi.clearAllMocks());
afterEach(async () => close?.());

async function fixture(runner: ScriptRunner, bypass = true) {
  const staticRoot = await mkdtemp(join(tmpdir(), "drop-admin-"));
  await writeFile(join(staticRoot, "index.html"), "<h1>Control Room</h1>");
  const server = createAdminServer({
    repoRoot: "/repo",
    staticRoot,
    allowedLogin: "jamie@example.com",
    devBypassIdentity: bypass,
    runner,
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

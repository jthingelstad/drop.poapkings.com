import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("loads the sanitized queue and exposes run and player tags", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "ok",
            generatedAt: "2026-08-12T12:00:00.000Z",
            operator: "jamie",
            csrfToken: "csrf",
            totals: { players: 1, runs: 2, pending: 1, restricted: 0 },
            players: [],
            recentRuns: [],
            reviewQueue: [
              {
                runId: "run-1",
                runReference: "#D1234567890",
                playerId: "player-1",
                playerReference: "#P1234567890",
                publicName: "Knight Main",
                mode: "surge",
                score: 12004,
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    render(<App />, host);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(host.textContent).toContain("Referee Queue");
  await vi.waitFor(() => expect(host.textContent).toContain("#D1234567890"));
  expect(host.textContent).toContain("#P1234567890");
  expect(host.textContent).toContain("12.004s");
  render(null, host);
});

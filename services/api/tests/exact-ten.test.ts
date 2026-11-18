import { expect, it, vi } from "vitest";
import { startExactTen, completeExactTen } from "../src/routes/exact-ten.js";
import { signToken } from "../src/signing.js";
import { cardElixir } from "../src/scoring.js";
import type { RouteContext } from "../src/routes/context.js";

it("records only a ten-elixir subset of the same player's signed hand", async () => {
  const secret = "test-only";
  const now = Math.floor(Date.now() / 1000);
  const token = (sub: string) =>
    signToken({ type: "session", sub, iat: now, exp: now + 90 }, secret);
  const record = vi.fn().mockResolvedValue(new Date().toISOString());
  const ctx = {
    config: { sessionSecret: secret },
    repository: {
      useRateLimit: vi.fn(),
      getProfile: async () => ({}),
      recordExactTen: record,
    },
    request: {
      headers: { authorization: `Bearer ${token("p1")}` },
      sourceIp: "test",
    },
  } as unknown as RouteContext;
  const { cardIds, handToken } = JSON.parse(
    (await startExactTen(ctx)).body!,
  ) as { cardIds: number[]; handToken: string };
  const subsets = Array.from({ length: 31 }, (_, i) =>
    cardIds.filter((_, n) => (i + 1) & (1 << n)),
  );
  const solution = subsets.find(
    (ids) => ids.reduce((sum, id) => sum + cardElixir(id)!, 0) === 10,
  )!;
  const solve = (selected: number[], signed = handToken) =>
    completeExactTen({
      ...ctx,
      request: {
        ...ctx.request,
        body: JSON.stringify({ selected, handToken: signed }),
      },
    });
  await expect(solve([solution[0]!, solution[0]!])).rejects.toThrow();
  await expect(solve([9999])).rejects.toThrow();
  await expect(solve([])).rejects.toThrow();
  await expect(solve(solution, handToken + "x")).rejects.toThrow();
  ctx.request.headers.authorization = `Bearer ${token("other")}`;
  await expect(solve(solution)).rejects.toThrow(/another player/);
  expect(record).not.toHaveBeenCalled();
  ctx.request.headers.authorization = `Bearer ${token("p1")}`;
  expect((await solve(solution)).statusCode).toBe(200);
  expect(
    record.mock.calls[0]![2].cards.map((c: { id: number }) => c.id),
  ).toEqual(solution);
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCounters, recordPodiumFinish } from "../src/badges.js";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => ({ send }) },
  };
});

import { Repository } from "../src/repository.js";

function transactionCanceled(): Error {
  const error = new Error("transaction canceled");
  error.name = "TransactionCanceledException";
  return error;
}

describe("podium award repository writes", () => {
  beforeEach(() => send.mockReset());

  it("atomically creates an idempotency marker and conditionally updates badges", async () => {
    send.mockResolvedValueOnce({});
    const at = "2026-08-03T10:12:48.768Z";
    const counters = recordPodiumFinish(emptyCounters(), at).counters;

    await expect(
      new Repository("test-table").savePodiumAward(
        "player-a",
        "2026-07",
        "surge",
        counters,
        at,
        "2026-08-05T22:00:00.000Z",
        { version: 1, updatedAt: "2026-08-02T00:00:00.000Z" },
      ),
    ).resolves.toBe(true);

    const transaction = send.mock.calls[0]?.[0].input.TransactItems;
    expect(transaction[0].Put).toMatchObject({
      Item: {
        pk: "PLAYER#player-a",
        sk: "PODIUM#2026-07#surge",
        seasonId: "2026-07",
        mode: "surge",
      },
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(transaction[1].Put).toMatchObject({
      Item: {
        pk: "PLAYER#player-a",
        sk: "BADGES",
        values: { podium: 1 },
      },
      ConditionExpression:
        "#version = :expectedVersion AND updatedAt = :expectedUpdatedAt",
    });
  });

  it("treats an existing season-mode marker as a successful duplicate", async () => {
    send
      .mockRejectedValueOnce(transactionCanceled())
      .mockResolvedValueOnce({ Item: { pk: "PLAYER#player-a" } });

    await expect(
      new Repository("test-table").savePodiumAward(
        "player-a",
        "2026-07",
        "surge",
        recordPodiumFinish(emptyCounters(), "2026-08-03T10:12:48.768Z")
          .counters,
        "2026-08-03T10:12:48.768Z",
        "2026-08-05T22:00:00.000Z",
      ),
    ).resolves.toBe(false);
  });

  it("rethrows badge contention when no idempotency marker was committed", async () => {
    send.mockRejectedValueOnce(transactionCanceled()).mockResolvedValueOnce({});

    await expect(
      new Repository("test-table").savePodiumAward(
        "player-a",
        "2026-07",
        "surge",
        recordPodiumFinish(emptyCounters(), "2026-08-03T10:12:48.768Z")
          .counters,
        "2026-08-03T10:12:48.768Z",
        "2026-08-05T22:00:00.000Z",
      ),
    ).rejects.toMatchObject({ name: "TransactionCanceledException" });
  });
});

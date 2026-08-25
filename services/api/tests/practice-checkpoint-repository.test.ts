import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => ({ send }) },
  };
});

import { Repository } from "../src/repository.js";

const answers = Array.from({ length: 20 }, (_, index) => ({
  cardId: 26000000,
  guess: 3,
  responseMs: 700 + index,
  assisted: false,
  correct: true,
}));

describe("Practice checkpoint repository", () => {
  beforeEach(() => send.mockReset());

  it("atomically advances an immutable chunk and active cursor", async () => {
    send.mockResolvedValueOnce({});
    const saved = await new Repository("test-table").savePracticeCheckpoint({
      sub: "player-sub",
      runId: "run-1",
      startIndex: 0,
      answers,
      reviewQueue: [],
      recovered: 0,
      updatedAt: "2026-08-25T19:00:00.000Z",
      expiresAt: 2_000_000_000,
      nowSeconds: 1_999_900_000,
    });

    expect(saved.answerCount).toBe(20);
    expect(send.mock.calls[0]?.[0].input.TransactItems).toMatchObject([
      {
        ConditionCheck: {
          Key: { pk: "RUN#run-1", sk: "RUN" },
          ConditionExpression:
            "#state = :started AND #owner = :owner AND expiresAt > :now",
        },
      },
      {
        Put: {
          Item: {
            pk: "PLAYER#player-sub",
            sk: "PRACTICE#run-1#CHUNK#000000",
            startIndex: 0,
            answers,
          },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      {
        Put: {
          Item: {
            pk: "PLAYER#player-sub",
            sk: "PRACTICE#ACTIVE",
            runId: "run-1",
            answerCount: 20,
          },
        },
      },
    ]);
  });

  it("accepts an identical retry after a lost transaction response", async () => {
    const cancelled = Object.assign(new Error("cancelled"), {
      name: "TransactionCanceledException",
    });
    send
      .mockRejectedValueOnce(cancelled)
      .mockResolvedValueOnce({
        Item: {
          pk: "PLAYER#player-sub",
          sk: "PRACTICE#ACTIVE",
          runId: "run-1",
          answerCount: 20,
          chunkCount: 1,
          reviewQueue: [],
          recovered: 0,
          updatedAt: "2026-08-25T19:00:00.000Z",
          expiresAt: 2_000_000_000,
        },
      })
      .mockImplementationOnce(async () => {
        const digest = send.mock.calls[0]?.[0].input.TransactItems.find(
          (item: { Put?: { Item?: { digest?: string } } }) =>
            item.Put?.Item?.digest,
        )?.Put.Item.digest;
        return { Item: { digest } };
      });

    await expect(
      new Repository("test-table").savePracticeCheckpoint({
        sub: "player-sub",
        runId: "run-1",
        startIndex: 0,
        answers,
        reviewQueue: [],
        recovered: 0,
        updatedAt: "2026-08-25T19:00:00.000Z",
        expiresAt: 2_000_000_000,
        nowSeconds: 1_999_900_000,
      }),
    ).resolves.toMatchObject({ answerCount: 20 });
  });
});

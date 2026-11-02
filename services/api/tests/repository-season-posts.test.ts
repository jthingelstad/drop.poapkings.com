import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({ send, middlewareStack: { add: vi.fn() } }),
    },
  };
});

import { Repository } from "../src/repository.js";
import type { SeasonPostsRecord } from "../src/season-posts.js";

const record: SeasonPostsRecord = {
  closedSeasonId: 138,
  openingSeasonId: 139,
  closedAt: "2026-12-07T10:05:00.000Z",
  leaders: [{ mode: "surge", publicName: "Log", score: 11_720 }],
  posted: {},
};

function conditionFailed(): Error {
  const error = new Error("condition failed");
  error.name = "ConditionalCheckFailedException";
  return error;
}

describe("season posts outbox", () => {
  beforeEach(() => send.mockReset());

  it("creates one record a closed season and never overwrites it", async () => {
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(conditionFailed());
    const repository = new Repository("test-table");
    await expect(repository.createSeasonPosts(record)).resolves.toBe(true);
    await expect(repository.createSeasonPosts(record)).resolves.toBe(false);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      Item: { pk: "SEASON_POSTS", sk: "SEASON#138", ...record },
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("surfaces any other write failure so finalization retries", async () => {
    send.mockRejectedValueOnce(new Error("throttled"));
    await expect(
      new Repository("test-table").createSeasonPosts(record),
    ).rejects.toThrow("throttled");
  });

  it("lists only seasons that still owe a post, oldest first", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            ...record,
            closedSeasonId: 139,
            openingSeasonId: 140,
            openingSeasonEndsAt: "2027-02-01T10:00:00.000Z",
            pk: "SEASON_POSTS",
            sk: "SEASON#139",
          },
          {
            ...record,
            pk: "SEASON_POSTS",
            sk: "SEASON#137",
            closedSeasonId: 137,
            posted: {
              "final-results": "2026-11-02T10:05:00.000Z",
              "opening-bell": "2026-11-02T10:05:01.000Z",
            },
          },
        ],
        LastEvaluatedKey: { pk: "SEASON_POSTS", sk: "SEASON#139" },
      })
      .mockResolvedValueOnce({
        Items: [{ ...record, pk: "SEASON_POSTS", sk: "SEASON#138" }],
      });
    const pending = await new Repository("test-table").pendingSeasonPosts();
    expect(pending.map((item) => item.closedSeasonId)).toEqual([138, 139]);
    expect(pending[1]).toEqual({
      closedSeasonId: 139,
      openingSeasonId: 140,
      closedAt: record.closedAt,
      openingSeasonEndsAt: "2027-02-01T10:00:00.000Z",
      leaders: record.leaders,
      posted: {},
    });
    expect(send.mock.calls[1]?.[0].input.ExclusiveStartKey).toEqual({
      pk: "SEASON_POSTS",
      sk: "SEASON#139",
    });
  });

  it("marks a post published once, keeping the first timestamp", async () => {
    send.mockResolvedValueOnce({});
    await new Repository("test-table").markSeasonPostPublished(
      138,
      "opening-bell",
      "2026-12-07T10:05:01.000Z",
    );
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      Key: { pk: "SEASON_POSTS", sk: "SEASON#138" },
      UpdateExpression: "SET posted.#kind = if_not_exists(posted.#kind, :at)",
      ExpressionAttributeNames: { "#kind": "opening-bell" },
    });
  });
});

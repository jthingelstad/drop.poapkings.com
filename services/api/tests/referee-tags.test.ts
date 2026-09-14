import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  type ScanCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import {
  loadTagClusters,
  TABLE_NAME,
} from "../../../AGENT-TEAM/scripts/_referee-lib.mjs";

function reader() {
  const doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: "us-east-1" }),
  );
  const send =
    vi.fn<(command: unknown) => Promise<Partial<ScanCommandOutput>>>();
  vi.spyOn(doc, "send").mockImplementation((command) => send(command));
  return { doc, send };
}

describe("current-profile referee tag coverage", () => {
  it("includes legacy profiles and follows empty filtered pages", async () => {
    const { doc, send } = reader();
    const cursor = { pk: "PLAYER#synthetic", sk: "RUN#synthetic" };
    send
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: cursor })
      .mockResolvedValueOnce({
        Items: [
          { playerId: "legacy", playerTag: " #p0ylq " },
          { playerId: "untagged" },
        ],
        LastEvaluatedKey: { pk: "PLAYER#synthetic", sk: "PROFILE" },
      })
      .mockResolvedValueOnce({
        Items: [
          { playerId: "indexed", playerTag: "#P0YLQ" },
          { playerId: "other", playerTag: "#G8R9" },
        ],
      });

    await expect(loadTagClusters(doc)).resolves.toEqual([
      { playerTag: "#P0YLQ", accounts: ["indexed", "legacy"] },
      { playerTag: "#G8R9", accounts: ["other"] },
    ]);
    expect(send).toHaveBeenCalledTimes(3);
    for (const [command] of send.mock.calls) {
      expect(command).toBeInstanceOf(ScanCommand);
      expect((command as ScanCommand).input).toMatchObject({
        TableName: TABLE_NAME,
        FilterExpression: "begins_with(pk, :player) AND sk = :profile",
        ExpressionAttributeValues: {
          ":player": "PLAYER#",
          ":profile": "PROFILE",
        },
        ProjectionExpression: "playerId, playerTag",
        ConsistentRead: true,
        Limit: 500,
      });
      expect((command as ScanCommand).input.IndexName).toBeUndefined();
    }
  });

  it("fails closed when a later page cannot be read", async () => {
    const { doc, send } = reader();
    send
      .mockResolvedValueOnce({
        Items: [{ playerId: "first", playerTag: "#P0YLQ" }],
        LastEvaluatedKey: { pk: "PLAYER#synthetic", sk: "PROFILE" },
      })
      .mockRejectedValueOnce(new Error("synthetic read failure"));
    await expect(loadTagClusters(doc)).rejects.toThrow(
      "synthetic read failure",
    );
  });

  it("fails closed rather than inventing an account for an incomplete tag", async () => {
    const { doc, send } = reader();
    send.mockResolvedValueOnce({ Items: [{ playerTag: "#P0YLQ" }] });
    await expect(loadTagClusters(doc)).rejects.toThrow(
      "Tagged profile lacks required pseudonymous fields",
    );
  });
});

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// One document client per Lambda container, shared by every store module
// (repository, leaderboards, profile hydration) so they reuse a single
// connection pool instead of each constructing their own.
export const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export function profileKey(sub: string) {
  return { pk: `PLAYER#${sub}`, sk: "PROFILE" as const };
}

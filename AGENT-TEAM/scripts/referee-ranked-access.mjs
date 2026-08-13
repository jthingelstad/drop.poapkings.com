#!/usr/bin/env node
// referee-ranked-access.mjs <playerId> --restrict|--restore
//   --approved-by jamie --reason <private concise rationale>
//
// A separate, explicitly human-approved enforcement overlay. Run adjudication
// never calls this path implicitly. It writes only REFEREE# partitions, leaves
// the account and evidence intact, and can be reversed without data repair.

import {
  client,
  failClosed,
  GetCommand,
  parseFlags,
  print,
  sanitizeRecord,
  subForPlayerId,
  TABLE_NAME,
  TransactWriteCommand,
} from "./_referee-lib.mjs";

const { flags, positional } = parseFlags(process.argv.slice(2));
const playerId = positional[0];
const restrict = flags.restrict === true;
const restore = flags.restore === true;
const approvedBy =
  typeof flags["approved-by"] === "string" ? flags["approved-by"].trim() : "";
const reason = typeof flags.reason === "string" ? flags.reason.trim() : "";

if (!playerId)
  failClosed(
    "missing_player_id",
    "usage: referee-ranked-access.mjs <playerId> (--restrict | --restore) --approved-by jamie --reason <text>",
  );
if (restrict === restore)
  failClosed("invalid_action", "Choose exactly one of --restrict or --restore");
if (approvedBy !== "jamie")
  failClosed(
    "operator_approval_required",
    "Ranked-access enforcement requires --approved-by jamie",
  );
if (reason.length < 12 || reason.length > 1_000)
  failClosed("invalid_reason", "--reason must contain 12..1000 characters");

const doc = client();
let subject;
let previous;
const key = { pk: `REFEREE#PLAYER#${playerId}`, sk: "CURRENT" };
try {
  [subject, previous] = await Promise.all([
    subForPlayerId(doc, playerId),
    doc.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: key,
        ConsistentRead: true,
      }),
    ),
  ]);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}
if (!subject)
  failClosed("player_not_found", `No active player has id ${playerId}`);

const decidedAt = new Date().toISOString();
const fields = {
  playerId,
  status: restrict ? "restricted" : "allowed",
  reason,
  decidedAt,
  decidedBy: "jamie",
  schemaVersion: "1",
};
const current = { ...key, ...fields };
const history = {
  pk: key.pk,
  sk: `DECISION#${decidedAt}`,
  ...fields,
};

try {
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: history,
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        { Put: { TableName: TABLE_NAME, Item: current } },
      ],
    }),
  );
} catch (error) {
  failClosed(
    "write_failed",
    error instanceof Error ? error.message : "unknown",
  );
}

print({
  status: "ok",
  decision: sanitizeRecord(current),
  ...(previous.Item ? { previous: sanitizeRecord(previous.Item) } : {}),
});

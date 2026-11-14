#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  accountDetail,
  client,
  fail,
  findProfile,
  parseFlags,
  print,
  TABLE_NAME,
} from "./_control-lib.mjs";

const CLASH_ROYALE_TAG_PATTERN = /^#[0289PYLQGRJCUV]{3,15}$/;

function normalizedTag(value) {
  if (value === "") return undefined;
  if (typeof value !== "string") throw new Error("Player tag must be a string");
  const tag = `#${value.trim().toUpperCase().replaceAll("O", "0").replace(/^#/, "")}`;
  if (!CLASH_ROYALE_TAG_PATTERN.test(tag))
    throw new Error("Enter a valid Clash Royale player tag");
  return tag;
}

const { flags, positional } = parseFlags(process.argv.slice(2));
const playerId = positional[0];
if (!playerId)
  fail(
    "missing_player_id",
    "usage: control-player-update.mjs <playerId> --patch <base64url>",
  );
if (typeof flags.patch !== "string")
  fail("missing_patch", "--patch is required");

let input;
try {
  input = JSON.parse(Buffer.from(flags.patch, "base64url").toString("utf8"));
} catch {
  fail("invalid_patch", "--patch must contain base64url JSON");
}
if (!input || typeof input !== "object" || Array.isArray(input))
  fail("invalid_patch", "Profile patch must be an object");

try {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const operator =
    typeof input.operator === "string" ? input.operator.trim() : "";
  if (reason.length < 8 || reason.length > 1_000)
    throw new Error("Reason must contain 8..1000 characters");
  if (operator.length < 3 || operator.length > 200)
    throw new Error("Operator identity is invalid");

  const doc = client();
  const profile = await findProfile(doc, playerId);
  if (!profile) throw new Error(`No profile maps to playerId ${playerId}`);

  // The name and picture come from the player's Elixir account at each
  // sign-in (2026-11-14): a correction here would be overwritten by the next
  // one, so the Control Room no longer makes it.
  if (
    Object.hasOwn(input, "publicName") ||
    Object.hasOwn(input, "favoriteCardId")
  )
    throw new Error(
      "The name and picture come from the player's Elixir account; correct them there",
    );

  const next = {};
  if (Object.hasOwn(input, "playerTag"))
    next.playerTag = normalizedTag(input.playerTag);

  const changedFields = Object.keys(next).filter(
    (field) => next[field] !== profile[field],
  );
  if (!changedFields.length)
    throw new Error("No profile changes were provided");

  const names = { "#updatedAt": "updatedAt" };
  const values = {
    ":updatedAt": new Date().toISOString(),
    ":playerId": playerId,
  };
  const sets = ["#updatedAt = :updatedAt"];
  const removes = [];
  for (const field of changedFields) {
    if (field === "playerTag" && next.playerTag === undefined) {
      names["#playerTag"] = "playerTag";
      names["#gsi2pk"] = "GSI2PK";
      names["#gsi2sk"] = "GSI2SK";
      removes.push("#playerTag", "#gsi2pk", "#gsi2sk");
      continue;
    }
    names[`#${field}`] = field;
    values[`:${field}`] = next[field];
    sets.push(`#${field} = :${field}`);
    if (field === "playerTag") {
      names["#gsi2pk"] = "GSI2PK";
      names["#gsi2sk"] = "GSI2SK";
      values[":gsi2pk"] = "TAGGED";
      values[":gsi2sk"] = `${next.playerTag}#${playerId}`;
      sets.push("#gsi2pk = :gsi2pk", "#gsi2sk = :gsi2sk");
    }
  }

  const changedAt = values[":updatedAt"];
  const before = Object.fromEntries(
    changedFields.map((field) => [field, profile[field] ?? null]),
  );
  const after = Object.fromEntries(
    changedFields.map((field) => [field, next[field] ?? null]),
  );
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { pk: profile.pk, sk: "PROFILE" },
            UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
            ConditionExpression: "playerId = :playerId",
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              pk: `CONTROL#PLAYER#${playerId}`,
              sk: `CHANGE#${changedAt}#${randomUUID()}`,
              playerId,
              changedFields,
              before,
              after,
              reason,
              operator,
              changedAt,
              schemaVersion: "1",
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
      ],
    }),
  );
  const detail = await accountDetail(doc, playerId);
  print({ status: "ok", playerId, ...detail });
} catch (error) {
  fail("update_failed", error instanceof Error ? error.message : "unknown");
}

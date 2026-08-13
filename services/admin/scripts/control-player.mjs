#!/usr/bin/env node

import {
  accountDetail,
  client,
  fail,
  parseFlags,
  print,
} from "./_control-lib.mjs";

const { positional } = parseFlags(process.argv.slice(2));
const playerId = positional[0];
if (!playerId)
  fail("missing_player_id", "usage: control-player.mjs <playerId>");

try {
  const detail = await accountDetail(client(), playerId);
  if (!detail)
    fail("player_not_found", `No profile maps to playerId ${playerId}`);
  print({ status: "ok", playerId, ...detail });
} catch (error) {
  fail("read_failed", error instanceof Error ? error.message : "unknown");
}

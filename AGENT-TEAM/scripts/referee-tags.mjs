#!/usr/bin/env node
// referee-tags.mjs
//
// Normalized player-tag clusters from current profiles, including legacy tags
// missing sparse GSI2 membership. Projects only playerId and playerTag, never
// sub or email. Tag reuse is a signal, not proof of shared ownership.

import {
  client,
  failClosed,
  loadTagClusters,
  print,
} from "./_referee-lib.mjs";

const doc = await client();

let clusters;
try {
  clusters = await loadTagClusters(doc);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

print({ status: "ok", tagCount: clusters.length, clusters });

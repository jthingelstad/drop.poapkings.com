#!/usr/bin/env node

import { accountDirectory, client, fail, print } from "./_control-lib.mjs";

try {
  print({ status: "ok", accounts: await accountDirectory(client()) });
} catch (error) {
  fail("read_failed", error instanceof Error ? error.message : "unknown");
}

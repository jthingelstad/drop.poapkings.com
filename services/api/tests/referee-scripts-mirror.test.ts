import { beforeEach, describe, expect, it, vi } from "vitest";

// One send() fake stands in for DynamoDB for BOTH implementations under test,
// so the API repository and the referee scripts read the exact same table.
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

import {
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  playerReference as contractPlayerReference,
  runReference as contractRunReference,
} from "@elixir-drop/contracts";
import { buildEvidenceItem } from "../src/referee-evidence.js";
import { isExcludedFromBoards } from "../src/referee-status.js";
import { Repository } from "../src/repository.js";
import type { RefereeDecision } from "../src/types.js";
// The root scripts/ referee tools deliberately import nothing from services/api
// (workspace-boundary rule, Golden rule 7: the referee path must fail closed and
// must never see `sub`/email), so they carry their own copy of the few
// conventions they share with the API: the player-facing run and player tags,
// the board-exclusion classifier, and the forbidden-key denylist. A copy is
// only safe if something fails when it drifts, so each one is guarded here.
//
// The leaderboard mirror (ranked modes, board epochs, sort keys, visible-row
// reconciliation) retired on 2026-11-03 with referee-cohort, referee-feed and
// referee-decisions, the only scripts that read a board.
import {
  FORBIDDEN_KEYS,
  TABLE_NAME,
  findEvidenceByRunId,
  isExcludedFromBoards as scriptsIsExcludedFromBoards,
  playerReference as scriptsPlayerReference,
  runReference as scriptsRunReference,
  sanitize,
  sanitizeRecord,
} from "../../../scripts/_referee-lib.mjs";

const SEASON_ID = 134;

it("keeps player-facing run references stable across the app and referee tools", () => {
  const runId = "7b89d7fa-3ad6-4fa8-9048-2f7a96d85488";
  const reference = contractRunReference(runId);
  expect(reference).toBe("#DN928DNM1CQ");
  expect(reference).toMatch(/^#D[0-9A-HJKMNP-TV-Z]{10}$/);
  expect(scriptsRunReference(runId)).toBe(reference);
  expect(contractRunReference(runId)).toBe(reference);
});

it("keeps player-facing player tags stable across the app and referee tools", () => {
  const playerId = "9c50b73b-39c2-45b3-8756-4c326d28f127";
  const reference = contractPlayerReference(playerId);
  expect(reference).toMatch(/^#P[0-9A-HJKMNP-TV-Z]{10}$/);
  expect(scriptsPlayerReference(playerId)).toBe(reference);
  expect(contractPlayerReference(playerId)).toBe(reference);
});

it("resolves a player-facing run reference back to retained evidence", async () => {
  const runId = "7b89d7fa-3ad6-4fa8-9048-2f7a96d85488";
  const evidence = { runId, sk: `EVIDENCE#2026-08-12#${runId}` };
  const referenceSend = vi.fn(async (command: unknown) => {
    expect(command).toBeInstanceOf(ScanCommand);
    return { Items: [evidence] };
  });

  await expect(
    findEvidenceByRunId({ send: referenceSend }, contractRunReference(runId)),
  ).resolves.toEqual(evidence);
  const scan = referenceSend.mock.calls[0]?.[0] as ScanCommand;
  expect(scan.input).toMatchObject({
    FilterExpression: "begins_with(sk, :evidence)",
  });
});

it("classifies board exclusion exactly as the API does", () => {
  // An unrecognized author on a hidden decision fails closed: the run stays off.
  const decisions: Array<Record<string, unknown> | undefined> = [
    undefined,
    { visibility: "visible", decidedBy: "fair-play-referee" },
    { visibility: "not_ranked", decidedBy: "fair-play-referee" },
    { visibility: "hidden", decidedBy: "fair-play-referee" },
    { visibility: "hidden", decidedBy: "unrecognized-author" },
    { visibility: "hidden", decidedBy: "integrity-gate" },
    {
      visibility: "hidden",
      decidedBy: "fair-play-referee",
      queueState: "pending",
    },
    { visibility: "hidden" },
  ];
  for (const decision of decisions) {
    expect(
      scriptsIsExcludedFromBoards(decision),
      JSON.stringify(decision),
    ).toBe(
      isExcludedFromBoards(decision as unknown as RefereeDecision | undefined),
    );
  }
  // Pin the expectation so a matching pair of bugs cannot pass.
  expect(
    decisions.map((decision) =>
      isExcludedFromBoards(decision as unknown as RefereeDecision | undefined),
    ),
  ).toEqual([false, false, false, true, true, false, false, true]);
});

type Item = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Golden rule 7: the referee sees the pseudonymous playerId, never `sub` or
// email. The denylist is derived from what the API ACTUALLY writes, so a new
// sub-carrying attribute fails the build instead of leaking.
// ---------------------------------------------------------------------------
const SUB = "PRIVATE-SUBJECT-KEY-9f31";
const EMAIL = "private.person@example.test";

function itemFromUpdate(input: UpdateCommand["input"]): Item {
  const names = input.ExpressionAttributeNames ?? {};
  const values = (input.ExpressionAttributeValues ?? {}) as Item;
  const item: Item = { ...((input.Key ?? {}) as Item) };
  const setClause = /SET\s+([\s\S]*)$/.exec(input.UpdateExpression ?? "")?.[1];
  for (const assignment of (setClause ?? "").split(",")) {
    const [rawName, rawValue] = assignment
      .split("=")
      .map((part) => part.trim());
    if (!rawName || !rawValue?.startsWith(":")) continue;
    item[rawName.startsWith("#") ? (names[rawName] ?? rawName) : rawName] =
      values[rawValue];
  }
  return item;
}

// Every attribute name whose value carries `needle`, at any depth.
function carrierKeys(
  value: unknown,
  needle: string,
  found = new Set<string>(),
) {
  if (Array.isArray(value)) {
    for (const entry of value) carrierKeys(entry, needle, found);
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (typeof inner === "string" && inner.includes(needle)) found.add(key);
      carrierKeys(inner, needle, found);
    }
  }
  return found;
}

async function itemsTheApiWrites(): Promise<Array<[string, Item]>> {
  const repository = new Repository(TABLE_NAME);
  const written: Array<[string, Item]> = [];
  const takePuts = () => {
    for (const call of send.mock.calls) {
      const command = call[0];
      if (command instanceof PutCommand && command.input.Item)
        written.push(["put", command.input.Item as Item]);
      if (command instanceof TransactWriteCommand) {
        for (const entry of command.input.TransactItems ?? []) {
          if (entry.Put?.Item) written.push(["transact-put", entry.Put.Item]);
          if (entry.Update?.UpdateExpression)
            written.push(["transact-update", itemFromUpdate(entry.Update)]);
        }
      }
      if (command instanceof UpdateCommand && command.input.UpdateExpression)
        written.push(["update", itemFromUpdate(command.input)]);
    }
    send.mockReset();
  };

  send.mockResolvedValue({});
  await repository.ensureProfile(SUB, EMAIL);
  const run = await repository.createRun(
    SUB,
    "survival",
    { mode: "survival", cardIds: [26_000_000] },
    1_800_000_000,
    true,
    false,
    { ipHash: "opaque-hash", uaFamily: "Chrome/macOS" },
  );
  takePuts();

  const storedProfile = {
    Item: {
      sub: SUB,
      playerId: "player-public-id",
      email: EMAIL,
      totalGames: 3,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  };
  // Accepted run: history row + public feed row.
  send.mockResolvedValueOnce({}).mockResolvedValueOnce(storedProfile);
  await repository.completeRun(run, 61, SEASON_ID, 9, { timeMs: 44_500 });
  takePuts();

  send.mockResolvedValue({});
  await repository.updateAllTimeBest(
    run,
    61,
    { timeMs: 44_500 },
    "2026-07-14T09:30:00.000Z",
  );
  takePuts();

  written.push([
    "evidence",
    buildEvidenceItem({
      sub: SUB,
      runId: run.runId,
      mode: "survival",
      seasonId: SEASON_ID,
      runType: "ranked",
      integrityOutcome: "accepted",
      score: 61,
      tiebreaks: { timeMs: 44_500 },
      challenge: { mode: "survival", cardIds: [26_000_000] },
      transcript: { answers: [] },
      startedAt: "2026-07-14T09:29:00.000Z",
      completedAt: "2026-07-14T09:30:00.000Z",
      wallElapsedMs: 60_000,
      completeCorrelation: { ipHash: "opaque-hash", uaFamily: "Chrome/macOS" },
      playerTag: "#ABC123",
    }) as unknown as Item,
  ]);

  return written;
}

describe("referee sanitization covers every identifier the API writes", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("strips the sub and email from every item shape the API stores", async () => {
    const written = await itemsTheApiWrites();
    // Guard the guard: the fixture must actually exercise the write paths.
    expect(written.length).toBeGreaterThanOrEqual(8);

    for (const [label, item] of written) {
      const cleaned = JSON.stringify(sanitizeRecord(item));
      expect(cleaned, `${label} leaked the sub`).not.toContain(SUB);
      expect(cleaned, `${label} leaked the email`).not.toContain(EMAIL);
      const stamped = JSON.stringify(sanitize(item, "player-public-id"));
      expect(stamped, `${label} leaked the sub`).not.toContain(SUB);
      expect(stamped, `${label} leaked the email`).not.toContain(EMAIL);
    }
  });

  it("lists every attribute name that can carry a sub or email in the denylist", async () => {
    const written = await itemsTheApiWrites();
    const carriers = new Set<string>();
    for (const [, item] of written) {
      for (const key of carrierKeys(item, SUB)) carriers.add(key);
      for (const key of carrierKeys(item, EMAIL)) carriers.add(key);
    }
    // The API really does write the sub under all of these names; `owner` and
    // `GSI1SK` are the easily-missed ones (a sort key ending in "#{sub}").
    expect([...carriers].sort()).toEqual([
      "GSI1SK",
      "email",
      "owner",
      "pk",
      "playerSub",
      "sub",
    ]);
    for (const key of carriers) expect(FORBIDDEN_KEYS).toContain(key);
  });

  it("deep-cleans nested objects and arrays, not just top-level keys", () => {
    const nested = sanitizeRecord({
      runId: "run-1",
      evidence: { playerSub: SUB, correlation: { ipHash: "opaque" } },
      history: [{ owner: SUB, score: 3 }, { GSI1SK: `000#ts#${SUB}` }],
    });
    expect(JSON.stringify(nested)).not.toContain(SUB);
    expect(JSON.stringify(nested)).toContain("opaque");
  });
});

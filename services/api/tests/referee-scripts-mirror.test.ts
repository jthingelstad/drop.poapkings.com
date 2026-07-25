import { beforeEach, describe, expect, it, vi } from "vitest";

// One send() fake stands in for DynamoDB for BOTH implementations under test,
// so the API repository and the referee scripts read the exact same table.
const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({ send }),
    },
  };
});

import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GAME_MODES, type GameMode } from "@elixir-drop/contracts";
import {
  MODE_RULES,
  isLeaderboardEligibleScore,
  leaderboardPartition,
  leaderboardSortKey,
} from "../src/games.js";
// The canonical leaderboard read path. It lives in its own module now (it used
// to be private methods on Repository); import it directly so this guard tracks
// the implementation rather than whichever wrapper currently calls it.
import { allTimeLeaderboard, seasonLeaderboard } from "../src/leaderboards.js";
import { buildEvidenceItem } from "../src/referee-evidence.js";
import { Repository } from "../src/repository.js";
// The AGENT-TEAM referee scripts deliberately import nothing from services/api
// (workspace-boundary rule, Golden rule 7: the referee path must fail closed and
// must never see `sub`/email), so they carry their own copy of the leaderboard
// conventions. A copy is only safe if something fails when it drifts, and the
// drift is always silent: a stale partition returns an EMPTY cohort ("nothing to
// review"), a stale sort key ranks a board BACKWARDS, and a missing eligibility
// filter promotes a 0-score run as somebody's best. Rain shipped ranked but
// missing from RANKED_MODES, so referee reviews skipped the mode entirely until
// 2026-07-24; the sort key never inverted the score for higher-is-better modes
// and the eligibility filter was absent until 2026-07-24 as well.
//
// Every convention the scripts mirror is guarded here, behaviorally wherever
// possible — the two implementations are run over the same fixture table and
// their answers compared, because string-matching the source misses real drift.
import {
  FORBIDDEN_KEYS,
  RANKED_MODES,
  TABLE_NAME,
  bestVisibleRun,
  isLeaderboardEligibleScore as scriptsIsLeaderboardEligibleScore,
  leaderboardPartition as scriptsLeaderboardPartition,
  leaderboardSortKey as scriptsLeaderboardSortKey,
  resolveAllTimeEarningRun,
  rowSortKey,
  sanitize,
  sanitizeRecord,
  visibleLeaderboardRows,
} from "../../../AGENT-TEAM/scripts/_referee-lib.mjs";

// Practice is unranked by design and never writes a leaderboard row.
const UNRANKED_MODES = new Set(["practice"]);

const SEASON_ID = "2026-07";

type Item = Record<string, unknown>;

// ---------------------------------------------------------------------------
// A minimal in-memory stand-in for the single Drop table: main-table queries
// (pk + begins_with(sk)), the GSI1 leaderboard partition, BatchGet, and Get.
// Both implementations page through it identically.
// ---------------------------------------------------------------------------
function serveTable(items: Item[]) {
  return async (command: unknown): Promise<Item> => {
    if (command instanceof QueryCommand) {
      // Every value this fake is queried with is a key or a key prefix, so they
      // are strings rather than the wider `unknown` of an arbitrary attribute.
      const values = (command.input.ExpressionAttributeValues ?? {}) as Record<
        string,
        string | undefined
      >;
      if (command.input.IndexName === "GSI1") {
        return {
          Items: items
            .filter((item) => item.GSI1PK === values[":pk"])
            .sort((a, b) => String(a.GSI1SK).localeCompare(String(b.GSI1SK))),
        };
      }
      const prefix = values[":prefix"] ?? "";
      return {
        Items: items
          .filter(
            (item) =>
              item.pk === values[":pk"] && String(item.sk).startsWith(prefix),
          )
          .sort((a, b) => String(a.sk).localeCompare(String(b.sk))),
      };
    }
    if (command instanceof BatchGetCommand) {
      const responses: Record<string, Item[]> = {};
      for (const [table, request] of Object.entries(
        command.input.RequestItems ?? {},
      )) {
        responses[table] = (request.Keys ?? [])
          .map((key) =>
            items.find((item) => item.pk === key.pk && item.sk === key.sk),
          )
          .filter((item): item is Item => Boolean(item));
      }
      return { Responses: responses };
    }
    if (command instanceof GetCommand) {
      const key = (command.input.Key ?? {}) as Item;
      return {
        Item: items.find((item) => item.pk === key.pk && item.sk === key.sk),
      };
    }
    throw new Error("Unexpected DynamoDB command in the mirror fixture");
  };
}

function profileItem(sub: string): Item {
  return {
    pk: `PLAYER#${sub}`,
    sk: "PROFILE",
    sub,
    playerId: `player-${sub}`,
    email: `${sub}@example.test`,
    publicName: `Name ${sub}`,
    totalGames: 12,
    xp: 340,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

// A completed-run history item, built through the API's own writer so the
// fixture can never disagree with production about what a row looks like.
// `indexed: false` is the real "no GSI1SK" case: a zero score, or a historical
// `ranked: false` run in a ranked mode, never gets the sparse index attributes.
interface RunTiebreakFixture {
  timeMs?: number;
  // Higher/Lower's first tiebreak. Present only for that mode's rows.
  livesLost?: number;
  // Rain's ordered pair. Present only for that mode's rows.
  wrongGuesses?: number;
  avgLatencyMs?: number;
}

// The ordered values the mode's sort key carries, in ranking order.
function orderedTiebreaks(
  fixture: RunTiebreakFixture,
): number | number[] | undefined {
  if (fixture.wrongGuesses !== undefined)
    return [fixture.wrongGuesses, fixture.avgLatencyMs ?? 0];
  if (fixture.livesLost !== undefined)
    return [fixture.livesLost, fixture.timeMs ?? 0];
  return fixture.timeMs;
}

function historyRun(
  options: RunTiebreakFixture & {
    sub: string;
    runId: string;
    mode: GameMode;
    score: number;
    completedAt: string;
    indexed: boolean;
  },
): Item {
  const { sub, runId, mode, score, completedAt } = options;
  const { timeMs, livesLost, wrongGuesses, avgLatencyMs } = options;
  return {
    pk: `PLAYER#${sub}`,
    sk: `RUN#${completedAt}#${runId}`,
    runId,
    mode,
    score,
    seasonId: SEASON_ID,
    completedAt,
    playerSub: sub,
    ...(livesLost !== undefined ? { livesLost } : {}),
    ...(timeMs !== undefined ? { timeMs } : {}),
    ...(wrongGuesses !== undefined ? { wrongGuesses } : {}),
    ...(avgLatencyMs !== undefined ? { avgLatencyMs } : {}),
    ...(options.indexed
      ? {
          GSI1PK: leaderboardPartition(SEASON_ID, mode),
          GSI1SK: leaderboardSortKey(
            mode,
            score,
            completedAt,
            sub,
            orderedTiebreaks(options),
          ),
        }
      : {}),
  };
}

function allTimeBest(options: {
  sub: string;
  mode: GameMode;
  score: number;
  completedAt: string;
  timeMs?: number;
  runId?: string;
}): Item {
  const { sub, mode, score, completedAt, timeMs, runId } = options;
  return {
    pk: `PLAYER#${sub}`,
    sk: `ALLTIME#${mode}`,
    GSI1PK: leaderboardPartition("ALLTIME", mode),
    GSI1SK: leaderboardSortKey(mode, score, completedAt, sub, timeMs),
    mode,
    score,
    completedAt,
    playerSub: sub,
    ...(runId ? { runId } : {}),
    ...(timeMs !== undefined ? { timeMs } : {}),
  };
}

function hiddenDecision(runId: string): Item {
  return {
    pk: `REFEREE#${runId}`,
    sk: "CURRENT",
    runId,
    subjectType: "ranked_run",
    disposition: "review",
    visibility: "hidden",
    reason: "fixture: judged hidden",
    decidedAt: "2026-07-20T00:00:00.000Z",
    decidedBy: "fair-play-referee",
    schemaVersion: "1",
  };
}

// The API returns public rows; the referee returns raw table rows. Compare the
// part that carries the ranking decision: order, score, and which player.
function apiOrder(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({
    score: row.score,
    achievedAt: row.achievedAt,
    playerId: (row.player as { id: string }).id,
  }));
}

function refereeOrder(rows: Array<Record<string, unknown>>, limit: number) {
  // takeWithBoundaryTies may return MORE than `limit` (deliberate: a referee
  // must see every run tied at the cut line). The first `limit` must match.
  return rows.slice(0, limit).map((row) => ({
    score: row.score,
    achievedAt: row.completedAt,
    playerId: `player-${String(row.playerSub)}`,
  }));
}

// Run the API board and the referee cohort over the same table and return both
// answers in a comparable shape.
async function boardAgreement(options: {
  table: Item[];
  mode: GameMode;
  scope: "season" | "all-time";
  seasonId: string;
  limit: number;
}) {
  const { table, mode, scope, seasonId, limit } = options;
  send.mockImplementation(serveTable(table));
  const apiRows =
    scope === "season"
      ? await seasonLeaderboard(TABLE_NAME, mode, seasonId, limit)
      : await allTimeLeaderboard(TABLE_NAME, mode, limit);
  const { rows } = await visibleLeaderboardRows(
    { send },
    seasonId,
    mode,
    scope,
    limit,
  );
  return { api: apiOrder(apiRows), referee: refereeOrder(rows, limit) };
}

// One shared all-time shape, instantiated per scoring direction. Alpha's best is
// hidden, so the board must fall back to their next run that ever earned a
// place — never the zero-score run, which sorts FIRST in a lower-is-better mode
// and is exactly what the eligibility filter exists to exclude.
function allTimeFixture(options: {
  mode: GameMode;
  hidden: number;
  fallback: number;
  alsoRan: number;
  rival: number;
  legacy: number;
  timeMs: boolean;
}): Item[] {
  const { mode, hidden, fallback, alsoRan, rival, legacy, timeMs } = options;
  const at = (day: string) => `2026-07-${day}T00:00:00.000Z`;
  const ms = (value: number) => (timeMs ? value : undefined);
  return [
    profileItem("alpha"),
    profileItem("beta"),
    profileItem("gamma"),
    profileItem("delta"),
    allTimeBest({
      sub: "alpha",
      mode,
      score: hidden,
      completedAt: at("06"),
      timeMs: ms(90_000),
      runId: "alpha-best",
    }),
    allTimeBest({
      sub: "beta",
      mode,
      score: rival,
      completedAt: at("07"),
      timeMs: ms(70_000),
      runId: "beta-best",
    }),
    // Legacy zero-score all-time projection: never ranks.
    allTimeBest({
      sub: "gamma",
      mode,
      score: 0,
      completedAt: at("05"),
      runId: "gamma-zero",
    }),
    // Pre-backfill row with no runId: must resolve to its earning run.
    allTimeBest({
      sub: "delta",
      mode,
      score: legacy,
      completedAt: at("04"),
      timeMs: ms(50_000),
    }),
    historyRun({
      sub: "alpha",
      runId: "alpha-best",
      mode,
      score: hidden,
      completedAt: at("06"),
      timeMs: ms(90_000),
      indexed: true,
    }),
    historyRun({
      sub: "alpha",
      runId: "alpha-zero",
      mode,
      score: 0,
      completedAt: at("03"),
      indexed: false,
    }),
    // Positive score, no GSI1SK: a historical `ranked: false` run. The sort-key
    // fallback has to rank it correctly.
    historyRun({
      sub: "alpha",
      runId: "alpha-unranked",
      mode,
      score: fallback,
      completedAt: at("02"),
      indexed: false,
    }),
    historyRun({
      sub: "alpha",
      runId: "alpha-low",
      mode,
      score: alsoRan,
      completedAt: at("01"),
      timeMs: ms(20_000),
      indexed: true,
    }),
    historyRun({
      sub: "beta",
      runId: "beta-best",
      mode,
      score: rival,
      completedAt: at("07"),
      timeMs: ms(70_000),
      indexed: true,
    }),
    historyRun({
      sub: "delta",
      runId: "delta-earn",
      mode,
      score: legacy,
      completedAt: at("04"),
      timeMs: ms(50_000),
      indexed: true,
    }),
    hiddenDecision("alpha-best"),
  ];
}

describe("referee scripts mirror the API leaderboard conventions", () => {
  beforeEach(() => {
    send.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. RANKED_MODES
  // -------------------------------------------------------------------------
  it("covers every ranked game mode", () => {
    const expected = GAME_MODES.filter((mode) => !UNRANKED_MODES.has(mode));
    expect([...RANKED_MODES].sort()).toEqual([...expected].sort());
  });

  // -------------------------------------------------------------------------
  // 2. leaderboardPartition + BOARD_EPOCH
  // -------------------------------------------------------------------------
  it("resolves the same partition as the API for every mode and scope", () => {
    for (const mode of RANKED_MODES) {
      for (const seasonId of ["ALLTIME", "2026-07"]) {
        expect(scriptsLeaderboardPartition(seasonId, mode)).toBe(
          leaderboardPartition(seasonId, mode as GameMode),
        );
      }
    }
  });

  it("keeps the modes that were reset onto their current board epoch", () => {
    // Guards the epochs themselves: dropping one silently resurrects a retired
    // board (Survival's pre-rework scores, Rain's pre-difficulty-redesign ones).
    expect(scriptsLeaderboardPartition("2026-07", "survival")).toBe(
      "LEADERBOARD#2026-07#survival#r2",
    );
    expect(scriptsLeaderboardPartition("2026-07", "rain")).toBe(
      "LEADERBOARD#2026-07#rain#r3",
    );
    expect(scriptsLeaderboardPartition("2026-07", "higher-lower")).toBe(
      "LEADERBOARD#2026-07#higher-lower#r2",
    );
    expect(scriptsLeaderboardPartition("2026-07", "trade")).toBe(
      "LEADERBOARD#2026-07#trade#r2",
    );
  });

  // -------------------------------------------------------------------------
  // 3. isLeaderboardEligibleScore
  // -------------------------------------------------------------------------
  it("agrees with the API on which scores earned a board place", () => {
    const samples = [
      0,
      -0,
      1,
      -1,
      0.5,
      3_600_000,
      999_999_999_999,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MIN_VALUE,
    ];
    for (const score of samples) {
      expect(scriptsIsLeaderboardEligibleScore(score)).toBe(
        isLeaderboardEligibleScore(score),
      );
    }
    // Sanity: the rule the referee depends on is "a zero never ranks".
    expect(scriptsIsLeaderboardEligibleScore(0)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. leaderboardSortKey (score inversion, pad width, tiebreak, #sub suffix)
  // -------------------------------------------------------------------------
  it("builds byte-identical sort keys for every mode, score, and tiebreak", () => {
    const scores = [1, 7, 100, 3_600_000, 100_000, 999_999_999_999];
    const tiebreaks = [
      undefined,
      0,
      1_234,
      1_234.6, // rounds
      -5, // clamps to 0
      5_000_000_000, // clamps to 999_999_999
      999_999_999,
    ];
    for (const mode of GAME_MODES) {
      for (const score of scores) {
        for (const tiebreakMs of tiebreaks) {
          for (const sub of ["sub-a", "another-sub"]) {
            const completedAt = "2026-07-14T09:30:00.000Z";
            expect(
              scriptsLeaderboardSortKey(
                mode,
                score,
                completedAt,
                sub,
                tiebreakMs,
              ),
            ).toBe(
              leaderboardSortKey(mode, score, completedAt, sub, tiebreakMs),
            );
          }
        }
      }
    }
  });

  it("builds byte-identical sort keys for ordered multi-value tiebreaks", () => {
    // Higher/Lower ranks equal scores by lives lost THEN time, so the key
    // carries two ordered segments. A mirror that emitted them in the other
    // order, or dropped one, would rebuild a different key for the same run.
    const ordered = [
      [],
      [0, 0],
      [1, 42_000],
      [2, 1_234.6], // rounds
      [3, -5], // clamps to 0
      [0, 5_000_000_000], // clamps to 999_999_999
      [999_999_999, 999_999_999],
    ];
    for (const mode of GAME_MODES) {
      for (const score of [1, 26, 100_000]) {
        for (const values of ordered) {
          const completedAt = "2026-07-25T09:30:00.000Z";
          expect(
            scriptsLeaderboardSortKey(
              mode,
              score,
              completedAt,
              "sub-a",
              values,
            ),
          ).toBe(leaderboardSortKey(mode, score, completedAt, "sub-a", values));
        }
      }
    }
    // And an empty list is the no-tiebreak key, exactly like `undefined`.
    expect(
      scriptsLeaderboardSortKey("surge", 5, "2026-07-25T00:00:00Z", "s", []),
    ).toBe(leaderboardSortKey("surge", 5, "2026-07-25T00:00:00Z", "s"));
  });

  it("mirrors each mode's scoring direction, so no board ranks backwards", () => {
    const completedAt = "2026-07-14T09:30:00.000Z";
    for (const mode of GAME_MODES) {
      const lowerIsBetter = MODE_RULES[mode].direction === "lower";
      const better = lowerIsBetter ? 10 : 900;
      const worse = lowerIsBetter ? 900 : 10;
      // Boards are read ascending, so the better score MUST sort first.
      expect(
        scriptsLeaderboardSortKey(mode, better, completedAt, "sub-a") <
          scriptsLeaderboardSortKey(mode, worse, completedAt, "sub-a"),
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 5. rowSortKey — the GSI1SK fallback (Repository#leaderboardItemSortKey)
  // -------------------------------------------------------------------------
  it("reuses a stored GSI1SK verbatim and otherwise rebuilds the canonical key", () => {
    const rows: Array<{ mode: GameMode; row: Item }> = [
      {
        mode: "survival",
        row: historyRun({
          sub: "sub-a",
          runId: "run-1",
          mode: "survival",
          score: 60,
          completedAt: "2026-07-10T00:00:00.000Z",
          timeMs: 42_000,
          indexed: true,
        }),
      },
      {
        // The real "no GSI1SK" case: a historical ranked:false run.
        mode: "survival",
        row: historyRun({
          sub: "sub-b",
          runId: "run-2",
          mode: "survival",
          score: 35,
          completedAt: "2026-07-09T00:00:00.000Z",
          indexed: false,
        }),
      },
      {
        mode: "rain",
        row: historyRun({
          sub: "sub-c",
          runId: "run-3",
          mode: "rain",
          score: 0,
          completedAt: "2026-07-08T00:00:00.000Z",
          indexed: false,
        }),
      },
      {
        mode: "surge",
        row: historyRun({
          sub: "sub-d",
          runId: "run-4",
          mode: "surge",
          score: 21_500,
          completedAt: "2026-07-07T00:00:00.000Z",
          indexed: false,
        }),
      },
      {
        // Two ordered tiebreaks: the fallback must rebuild BOTH segments, in
        // the mode's ranking order.
        mode: "higher-lower",
        row: historyRun({
          sub: "sub-e",
          runId: "run-5",
          mode: "higher-lower",
          score: 26,
          completedAt: "2026-07-25T00:00:00.000Z",
          livesLost: 2,
          timeMs: 31_400,
          indexed: false,
        }),
      },
      {
        // Rain's own ordered pair, under different attribute names.
        mode: "rain",
        row: historyRun({
          sub: "sub-f",
          runId: "run-6",
          mode: "rain",
          score: 88,
          completedAt: "2026-07-25T00:00:00.000Z",
          wrongGuesses: 5,
          avgLatencyMs: 940,
          indexed: false,
        }),
      },
    ];
    for (const { mode, row } of rows) {
      const canonical =
        typeof row.GSI1SK === "string"
          ? row.GSI1SK
          : leaderboardSortKey(
              mode,
              Number(row.score),
              String(row.completedAt),
              String(row.playerSub),
              mode === "higher-lower"
                ? [Number(row.livesLost), Number(row.timeMs)]
                : // A Rain row written before the tiebreaks existed carries
                  // neither attribute and must keep producing a bare key.
                  mode === "rain" && row.wrongGuesses !== undefined
                  ? [Number(row.wrongGuesses), Number(row.avgLatencyMs)]
                  : row.timeMs === undefined
                    ? undefined
                    : Number(row.timeMs),
            );
      expect(rowSortKey(row, mode)).toBe(canonical);
    }
  });

  it("orders Higher/Lower rows by lives lost, then time, on the fallback path", () => {
    // Same score, no stored GSI1SK: the referee's rebuilt key has to reproduce
    // the two-tiebreak ranking or a cohort is reviewed in the wrong order.
    const row = (runId: string, livesLost: number, timeMs: number) =>
      historyRun({
        sub: `sub-${runId}`,
        runId,
        mode: "higher-lower",
        score: 26,
        completedAt: "2026-07-25T00:00:00.000Z",
        livesLost,
        timeMs,
        indexed: false,
      });
    const clean = row("clean", 0, 90_000);
    const oneLife = row("one-life", 1, 30_000);
    const oneLifeSlow = row("one-life-slow", 1, 45_000);
    const sorted = [oneLifeSlow, oneLife, clean].sort((a, b) =>
      rowSortKey(a, "higher-lower").localeCompare(
        rowSortKey(b, "higher-lower"),
      ),
    );
    expect(sorted.map((item) => item.runId)).toEqual([
      "clean",
      "one-life",
      "one-life-slow",
    ]);
  });

  it("orders Rain rows by wrong guesses, then latency, on the fallback path", () => {
    // Same cleared count, no stored GSI1SK. Rain's attributes are named nothing
    // like Survival's or Higher/Lower's, so a mirror that carried the old field
    // names would rebuild a key with no tiebreak segments at all and rank a
    // whole cohort by completion time.
    const row = (runId: string, wrongGuesses: number, avgLatencyMs: number) =>
      historyRun({
        sub: `sub-${runId}`,
        runId,
        mode: "rain",
        score: 120,
        completedAt: "2026-07-25T00:00:00.000Z",
        wrongGuesses,
        avgLatencyMs,
        indexed: false,
      });
    const clean = row("clean", 0, 1_400);
    const oneWrong = row("one-wrong", 1, 600);
    const oneWrongSlow = row("one-wrong-slow", 1, 900);
    const sorted = [oneWrongSlow, oneWrong, clean].sort((a, b) =>
      rowSortKey(a, "rain").localeCompare(rowSortKey(b, "rain")),
    );
    expect(sorted.map((item) => item.runId)).toEqual([
      "clean",
      "one-wrong",
      "one-wrong-slow",
    ]);
  });

  it("orders un-indexed rows best-first in every mode's own direction", () => {
    for (const mode of RANKED_MODES as GameMode[]) {
      const better = historyRun({
        sub: "sub-better",
        runId: "run-better",
        mode,
        score: MODE_RULES[mode].direction === "lower" ? 10 : 900,
        completedAt: "2026-07-10T00:00:00.000Z",
        indexed: false,
      });
      const worse = historyRun({
        sub: "sub-worse",
        runId: "run-worse",
        mode,
        score: MODE_RULES[mode].direction === "lower" ? 900 : 10,
        completedAt: "2026-07-10T00:00:00.000Z",
        indexed: false,
      });
      const sorted = [worse, better].sort((a, b) =>
        rowSortKey(a, mode).localeCompare(rowSortKey(b, mode)),
      );
      expect(sorted[0]?.runId).toBe("run-better");
    }
  });

  // -------------------------------------------------------------------------
  // 6. bestVisibleRun — hidden-run fallback + eligibility filter
  // -------------------------------------------------------------------------
  it.each([
    // Higher-is-better: the zero sorts last, so only the ranking matters here.
    { mode: "survival" as GameMode, timeMs: true, fallback: 40, alsoRan: 30 },
    // Lower-is-better: a zero-millisecond run sorts FIRST. Without the
    // eligibility filter it is promoted as somebody's best run.
    {
      mode: "surge" as GameMode,
      timeMs: false,
      fallback: 12_000,
      alsoRan: 30_000,
    },
  ])(
    "picks the best eligible fallback run when the top $mode run is hidden",
    async ({ mode, timeMs, fallback, alsoRan }) => {
      const table = allTimeFixture({
        mode,
        hidden: mode === "surge" ? 8_000 : 120,
        fallback,
        alsoRan,
        rival: mode === "surge" ? 9_000 : 90,
        legacy: mode === "surge" ? 20_000 : 45,
        timeMs,
      });
      send.mockImplementation(serveTable(table));

      const best = await bestVisibleRun({ send }, "alpha", mode, "alpha-best");
      expect(best?.runId).toBe("alpha-unranked");
      expect(best?.score).toBe(fallback);
    },
  );

  // -------------------------------------------------------------------------
  // 7. resolveAllTimeEarningRun
  // -------------------------------------------------------------------------
  it("resolves an all-time row with no runId back to its earning run", async () => {
    const row = allTimeBest({
      sub: "delta",
      mode: "survival",
      score: 45,
      completedAt: "2026-07-04T00:00:00.000Z",
      timeMs: 50_000,
    });
    const table: Item[] = [
      profileItem("delta"),
      row,
      historyRun({
        sub: "delta",
        runId: "delta-earn",
        mode: "survival",
        score: 45,
        completedAt: "2026-07-04T00:00:00.000Z",
        timeMs: 50_000,
        indexed: true,
      }),
    ];
    send.mockImplementation(serveTable(table));

    const resolved = await resolveAllTimeEarningRun({ send }, row, "survival");
    expect(resolved.runId).toBe("delta-earn");

    // Fails closed when nothing can be resolved rather than ranking a phantom.
    send.mockImplementation(serveTable([profileItem("delta"), row]));
    await expect(
      resolveAllTimeEarningRun({ send }, row, "survival"),
    ).rejects.toThrow(/no resolvable earning run/);
  });

  // -------------------------------------------------------------------------
  // 8. End-to-end board equivalence: the referee cohort must be the API board.
  // -------------------------------------------------------------------------
  it("returns the same season cohort as the API leaderboard", async () => {
    const table: Item[] = [
      profileItem("alpha"),
      profileItem("beta"),
      profileItem("gamma"),
      profileItem("delta"),
      historyRun({
        sub: "gamma",
        runId: "gamma-top",
        mode: "rain",
        score: 70,
        completedAt: "2026-07-09T00:00:00.000Z",
        indexed: true,
      }),
      historyRun({
        sub: "delta",
        runId: "delta-run",
        mode: "rain",
        score: 60,
        completedAt: "2026-07-08T00:00:00.000Z",
        indexed: true,
      }),
      historyRun({
        sub: "alpha",
        runId: "alpha-run",
        mode: "rain",
        score: 50,
        completedAt: "2026-07-10T00:00:00.000Z",
        indexed: true,
      }),
      historyRun({
        sub: "alpha",
        runId: "alpha-second",
        mode: "rain",
        score: 30,
        completedAt: "2026-07-11T00:00:00.000Z",
        indexed: true,
      }),
      // A legacy zero-score row that really is indexed — the reason
      // services/api/scripts/cleanup-zero-leaderboards.mjs exists.
      historyRun({
        sub: "beta",
        runId: "beta-zero",
        mode: "rain",
        score: 0,
        completedAt: "2026-07-12T00:00:00.000Z",
        indexed: true,
      }),
      hiddenDecision("gamma-top"),
    ];

    const { api, referee } = await boardAgreement({
      table,
      mode: "rain",
      scope: "season",
      seasonId: SEASON_ID,
      limit: 5,
    });

    expect(referee).toEqual(api);
    // Pin the expectation so a matching pair of bugs cannot pass: delta then
    // alpha, with gamma hidden, alpha deduped, and the zero filtered out.
    expect(api).toEqual([
      {
        score: 60,
        achievedAt: "2026-07-08T00:00:00.000Z",
        playerId: "player-delta",
      },
      {
        score: 50,
        achievedAt: "2026-07-10T00:00:00.000Z",
        playerId: "player-alpha",
      },
    ]);
  });

  it.each([
    {
      mode: "survival" as GameMode,
      timeMs: true,
      hidden: 120,
      fallback: 40,
      alsoRan: 30,
      rival: 90,
      legacy: 45,
      // Higher-is-better: 90, then 45, then alpha reconciled down to 40. A sort
      // key that forgets to invert the score puts alpha first.
      expected: [
        [90, "07", "beta"],
        [45, "04", "delta"],
        [40, "02", "alpha"],
      ],
    },
    {
      mode: "surge" as GameMode,
      timeMs: false,
      hidden: 8_000,
      fallback: 12_000,
      alsoRan: 30_000,
      rival: 9_000,
      legacy: 20_000,
      // Lower-is-better golf time: 9s, then alpha reconciled to 12s, then 20s.
      // Alpha also has a 0ms run, which an unfiltered fallback ranks first.
      expected: [
        [9_000, "07", "beta"],
        [12_000, "02", "alpha"],
        [20_000, "04", "delta"],
      ],
    },
  ])(
    "returns the same all-time $mode cohort as the API, hidden runs reconciled",
    async ({ expected, ...shape }) => {
      const { api, referee } = await boardAgreement({
        table: allTimeFixture(shape),
        mode: shape.mode,
        scope: "all-time",
        seasonId: "ALLTIME",
        limit: 5,
      });

      expect(referee).toEqual(api);
      expect(api).toEqual(
        expected.map(([score, day, player]) => ({
          score,
          achievedAt: `2026-07-${day}T00:00:00.000Z`,
          playerId: `player-${player}`,
        })),
      );
    },
  );
});

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
  // Quarantined run: history row + automatic referee decision rows.
  send.mockResolvedValueOnce({}).mockResolvedValueOnce(storedProfile);
  await repository.completeRun(
    run,
    61,
    SEASON_ID,
    9,
    { timeMs: 44_500 },
    "impossible_pace",
  );
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

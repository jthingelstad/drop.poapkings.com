import { describe, expect, it, vi } from "vitest";
import {
  parsePracticeRecoveryArgs,
  planPracticeRecovery,
} from "../src/maintenance/recover-practice-run.js";
import type { RunItem } from "../src/repository.js";
import type { Repository } from "../src/repository.js";
import { updateBadges } from "../src/routes/runs-complete.js";
import type { PlayerProfile } from "../src/types.js";

const run: RunItem = {
  pk: "RUN#11111111-1111-4111-8111-111111111111",
  sk: "RUN",
  runId: "11111111-1111-4111-8111-111111111111",
  owner: "player-sub",
  mode: "practice",
  challenge: { mode: "practice", cardIds: [26000000, 26000001] },
  state: "started",
  startedAt: "2026-08-25T16:00:00.000Z",
  expiresAt: 1_800_000_000,
  ranked: false,
};

const profile: PlayerProfile = {
  sub: "player-sub",
  playerId: "22222222-2222-4222-8222-222222222222",
  email: "player@example.com",
  publicName: "Log",
  favoriteCardId: 26000000,
  totalGames: 10,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-08-25T16:00:00.000Z",
};

const argv = [
  run.runId,
  "--player-id",
  profile.playerId,
  "--completed-at",
  "2026-08-25T17:00:00.000Z",
  "--local-seen",
  "3000",
  "--local-correct",
  "2400",
  "--server-seen",
  "400",
  "--server-correct",
  "300",
];

describe("Practice run recovery", () => {
  it("parses a single dry-run recovery with explicit owner and evidence", () => {
    expect(parsePracticeRecoveryArgs(argv)).toMatchObject({
      apply: false,
      tableName: "elixir-drop",
      runId: run.runId,
      playerId: profile.playerId,
      completedAt: "2026-08-25T17:00:00.000Z",
      localSeen: 3000,
      localCorrect: 2400,
      serverSeen: 400,
      serverCorrect: 300,
    });
  });

  it("derives only the aggregate result and validates human wall time", () => {
    const parsed = parsePracticeRecoveryArgs(argv);
    const plan = planPracticeRecovery(run, profile, parsed, 136);

    expect(plan.evidence.answerCount).toBe(2600);
    expect(plan.evidence.correctCount).toBe(2100);
    expect(plan.evidence.method).toBeUndefined();
    expect(plan.score).toBe(81);
    expect(plan.wallElapsedMs).toBe(60 * 60 * 1000);
    expect(plan.run.answerCount).toBe(2600);
  });

  it("records an attested lower bound without presenting accuracy as measured", () => {
    const parsed = parsePracticeRecoveryArgs([
      run.runId,
      "--player-id",
      profile.playerId,
      "--completed-at",
      "2026-08-25T17:00:00.000Z",
      "--source-table",
      "elixir-drop-recovery-20260825-1227",
      "--attested-answers",
      "2000",
      "--estimated-accuracy",
      "92",
    ]);
    const plan = planPracticeRecovery(run, profile, parsed, 136);

    expect(parsed.sourceTableName).toBe("elixir-drop-recovery-20260825-1227");
    expect(plan).toMatchObject({
      score: 92,
      evidenceSk: expect.stringContaining("PLAYER_ATTESTATION"),
    });
    expect(plan.evidence).toEqual({
      playerId: profile.playerId,
      method: "attested_lower_bound",
      estimatedAccuracy: 92,
      answerCount: 2000,
      correctCount: 1840,
    });
  });

  it("refuses mixed or incomplete recovery evidence", () => {
    expect(() =>
      parsePracticeRecoveryArgs([
        ...argv,
        "--attested-answers",
        "2000",
        "--estimated-accuracy",
        "92",
      ]),
    ).toThrow(/either browser-delta evidence or attested/);
    expect(() =>
      parsePracticeRecoveryArgs([
        run.runId,
        "--player-id",
        profile.playerId,
        "--completed-at",
        "2026-08-25T17:00:00.000Z",
        "--attested-answers",
        "2000",
      ]),
    ).toThrow(/requires --attested-answers and --estimated-accuracy/);
  });

  it("refuses the wrong owner or inconsistent browser delta", () => {
    const parsed = parsePracticeRecoveryArgs(argv);
    expect(() =>
      planPracticeRecovery(
        run,
        profile,
        { ...parsed, playerId: "33333333-3333-4333-8333-333333333333" },
        136,
      ),
    ).toThrow(/does not own/);
    expect(() =>
      planPracticeRecovery(run, profile, { ...parsed, serverSeen: 3001 }, 136),
    ).toThrow(/outside Practice limits/);
    expect(() =>
      planPracticeRecovery(
        run,
        profile,
        {
          ...parsed,
          localSeen: undefined,
          localCorrect: undefined,
          serverSeen: undefined,
          serverCorrect: undefined,
          attestedAnswers: 2000,
          estimatedAccuracy: 101,
        },
        136,
      ),
    ).toThrow(/estimated accuracy/);
  });

  it("refuses an aggregate faster than the Practice UI can produce", () => {
    const parsed = parsePracticeRecoveryArgs(argv);
    expect(() =>
      planPracticeRecovery(
        run,
        profile,
        { ...parsed, completedAt: "2026-08-25T16:05:00.000Z" },
        136,
      ),
    ).toThrow(/fails integrity/);
  });

  it("restores Practice volume without inventing card-specific badge facts", async () => {
    const save = vi.fn(async () => true);
    const result = await updateBadges(
      { getBadges: vi.fn(async () => undefined) } as unknown as Repository,
      { ...run, answerCount: 2600 },
      // Aggregate recovery deliberately ignores even a supplied card answer.
      { answers: [{ cardId: 26000000, guess: 3 }] },
      {
        score: 81,
        completedAt: "2026-08-25T17:00:00.000Z",
        totalGames: 11,
        xp: 1300,
        tzOffsetMinutes: undefined,
        personalBest: { improved: false },
        aggregatePractice: { answered: 2600, correct: 2100 },
      },
      save,
    );

    expect(result.applied).toBe(true);
    expect(result.counters?.values.reps).toBe(2600);
    expect(result.counters?.values.catalog).toBe(0);
    expect(result.counters?.values["big-spender"]).toBeUndefined();
  });
});

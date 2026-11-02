import { ScanCommand, type ScanCommandOutput } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findEvidenceByRunId,
  runReference as scriptRunReference,
} from "../../../scripts/_referee-lib.mjs";
import {
  ANALYSIS_VERSION,
  HUMAN_FLOOR_MS,
  RULES,
  analysisRunFromEvidence,
  analyzeRuns,
  historyRunFromItem,
  withHistoryEpoch,
  type AnalysisRun,
  type FlagLine,
  type HistoryRun,
} from "../src/run-analysis.js";
import { ANALYSIS_ATTRIBUTES, runAnalysis } from "../src/run-analysis-job.js";

const RUN_AT = "2026-11-03T11:15:00.000Z";
const SURGE_DAY = "2026-10-20T12:00:00.000Z";

// A small deterministic generator, so a "human" population has real spread.
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

// Display-to-input stamps for one run, one event per round.
function inputEvents(
  reads: number[],
  options: { untrusted?: number } = {},
): Record<string, unknown>[] {
  let clock = 1_000;
  return reads.map((read, round) => {
    const enabledAtMs = clock;
    clock += read + 280;
    return {
      round,
      value: 3,
      enabledAtMs,
      inputAtMs: enabledAtMs + read,
      inputKind: "pointer",
      trusted: round >= (options.untrusted ?? 0),
    };
  });
}

function humanReads(
  random: () => number,
  count = 15,
  [low, high] = [80, 250],
): number[] {
  const center = 450 + random() * 350;
  const spread = low + random() * (high - low);
  return Array.from({ length: count }, () =>
    Math.round(center + (random() - 0.5) * 2 * spread),
  );
}

let sequence = 0;
function uuid(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

interface EvidenceOptions {
  account?: string;
  mode?: string;
  score?: number;
  reads?: number[];
  untrusted?: number;
  reviewSignals?: string[];
  completedAt?: string;
  device?: [string, string];
  runType?: string;
}

function evidence(options: EvidenceOptions = {}): Record<string, unknown> {
  const runId = uuid();
  const completedAt = options.completedAt ?? SURGE_DAY;
  const [ipHash, uaHash] = options.device ?? [`ip-${runId}`, `ua-${runId}`];
  return {
    pk: `PLAYER#${options.account ?? `account-${runId}`}`,
    sk: `EVIDENCE#${completedAt}#${runId}`,
    runId,
    mode: options.mode ?? "surge",
    seasonId: 137,
    runType: options.runType ?? "ranked",
    ...(options.reviewSignals ? { reviewSignals: options.reviewSignals } : {}),
    score: options.score ?? 30_000,
    completedAt,
    ...(options.reads
      ? {
          timing: { model: "observed-v2", inputCount: options.reads.length },
          transcript: {
            inputEvents: inputEvents(options.reads, {
              untrusted: options.untrusted,
            }),
          },
        }
      : { transcript: {} }),
    correlation: {
      complete: { ipHash, uaHash, ipSubnetHash: `net-${ipHash}` },
      start: { ipHash, uaHash },
    },
  };
}

// 30 ordinary Surge runs: scores 20-40 s, reads 450-800 ms.
function population(
  count = 30,
  seed = 7,
  spreadRange?: [number, number],
): Record<string, unknown>[] {
  const random = generator(seed);
  return Array.from({ length: count }, () =>
    evidence({
      score: Math.round(20_000 + random() * 20_000),
      reads: humanReads(random, 15, spreadRange),
    }),
  );
}

function runsOf(items: Record<string, unknown>[]): AnalysisRun[] {
  return items.map((item) => analysisRunFromEvidence(item)!);
}

function analyze(items: Record<string, unknown>[], history: HistoryRun[] = []) {
  return analyzeRuns(runsOf(items), history, { analysisRunAt: RUN_AT });
}

function flagFor(
  flags: FlagLine[],
  item: Record<string, unknown>,
): FlagLine | undefined {
  return flags.find(
    (flag) => flag.runTag === scriptRunReference(String(item.runId)),
  );
}

function rulesFor(flags: FlagLine[], item: Record<string, unknown>) {
  return flagFor(flags, item)?.rules.map((rule) => rule.rule) ?? [];
}

describe("run analysis rules", () => {
  it("flags nothing in an ordinary human population", () => {
    const output = analyze(population());
    expect(output.flags).toEqual([]);
    expect(output.summary.runsFlagged).toBe(0);
  });

  it("subhuman_reads: a quarter of first reads under the human floor", () => {
    const random = generator(11);
    const reads = humanReads(random, 12);
    for (let index = 0; index < 3; index += 1) reads[index * 3] = 90;
    const suspect = evidence({ score: 31_000, reads });
    const output = analyze([...population(), suspect]);
    const rule = flagFor(output.flags, suspect)?.rules.find(
      (entry) => entry.rule === RULES.subhumanReads,
    );
    expect(rule).toEqual({
      rule: "subhuman_reads",
      readsUnderFloor: 3,
      reads: 12,
      share: 0.25,
      floorMs: HUMAN_FLOOR_MS,
    });
    // Two fast reads in twelve is under the share and stays quiet.
    const near = humanReads(generator(12), 12);
    near[0] = 90;
    near[5] = 90;
    const quiet = evidence({ score: 31_000, reads: near });
    expect(rulesFor(analyze([...population(), quiet]).flags, quiet)).toEqual(
      [],
    );
  });

  it("mechanical_cadence: read spread under the absolute floor or far below the mode", () => {
    const clockwork = evidence({
      score: 29_000,
      reads: Array.from({ length: 15 }, (_, index) => 600 + (index % 3)),
    });
    const tight = evidence({
      score: 29_500,
      reads: Array.from({ length: 15 }, (_, index) => 580 + (index % 5) * 10),
    });
    // Players whose read spread varies little, so the population is tight.
    const output = analyze([
      ...population(30, 7, [100, 140]),
      clockwork,
      tight,
    ]);
    const clockworkRule = flagFor(output.flags, clockwork)!.rules[0]!;
    expect(clockworkRule.rule).toBe("mechanical_cadence");
    expect(clockworkRule.readSpreadMs).toBeLessThan(10);
    const tightRule = flagFor(output.flags, tight)!.rules[0]!;
    expect(tightRule.readSpreadMs).toBe(10);
    expect(tightRule.z).toBeLessThanOrEqual(-4);
    expect(tightRule.populationReadSpreadMs).toBeGreaterThan(40);
  });

  it("elite_speed_and_score: both far past the mode at once, never just one", () => {
    const random = generator(21);
    const fastReads = () =>
      Array.from({ length: 15 }, () => Math.round(230 + random() * 80));
    const elite = evidence({ score: 5_000, reads: fastReads() });
    const fastOnly = evidence({ score: 30_000, reads: fastReads() });
    const scoreOnly = evidence({ score: 5_000, reads: humanReads(random) });
    const output = analyze([...population(), elite, fastOnly, scoreOnly]);
    const rule = flagFor(output.flags, elite)!.rules.find(
      (entry) => entry.rule === RULES.eliteSpeedAndScore,
    )!;
    expect(rule.scoreZ).toBeGreaterThanOrEqual(3);
    expect(rule.readZ).toBeLessThanOrEqual(-3);
    expect(rulesFor(output.flags, fastOnly)).not.toContain(
      "elite_speed_and_score",
    );
    expect(rulesFor(output.flags, scoreOnly)).not.toContain(
      "elite_speed_and_score",
    );
  });

  it("abrupt_jump: a run far past the player's own earlier best", () => {
    const account = "jumper";
    const history: HistoryRun[] = [36_000, 38_000, 37_000].map(
      (score, day) => ({
        account: `PLAYER#${account}`,
        runId: uuid(),
        mode: "surge",
        boardEpoch: "r1",
        score,
        completedAt: `2026-10-0${day + 1}T12:00:00.000Z`,
      }),
    );
    const jump = evidence({
      account,
      score: 12_000,
      reads: humanReads(generator(31)),
    });
    const output = analyze([...population(), jump], history);
    const rule = flagFor(output.flags, jump)!.rules[0]!;
    expect(rule).toMatchObject({
      rule: "abrupt_jump",
      priorRuns: 3,
      priorBest: 36_000,
    });
    expect(rule.jumpZ).toBeGreaterThanOrEqual(3);

    // Too little history to compare against says nothing.
    const newcomer = evidence({
      account: "newcomer",
      score: 12_000,
      reads: humanReads(generator(32)),
    });
    expect(
      rulesFor(
        analyze([...population(), newcomer], history.slice(0, 2)).flags,
        newcomer,
      ),
    ).toEqual([]);
  });

  it("automatic_signal: scorer and timing signals, never a leader-position hold", () => {
    const signalled = evidence({
      reviewSignals: [
        "surge_repeated_sub_100ms_inputs",
        "new_season_leader_pending_review",
      ],
    });
    const leaderOnly = evidence({
      reviewSignals: ["new_all_time_leader_pending_review"],
    });
    const output = analyze([...population(), signalled, leaderOnly]);
    expect(flagFor(output.flags, signalled)!.rules).toEqual([
      {
        rule: "automatic_signal",
        signals: ["surge_repeated_sub_100ms_inputs"],
      },
    ]);
    expect(flagFor(output.flags, leaderOnly)).toBeUndefined();
  });

  it("untrusted_input: any answer the browser did not mark trusted", () => {
    const suspect = evidence({
      reads: humanReads(generator(41)),
      untrusted: 1,
    });
    const output = analyze([...population(), suspect]);
    expect(flagFor(output.flags, suspect)!.rules).toEqual([
      { rule: "untrusted_input", untrustedInputs: 1, inputs: 15 },
    ]);
  });

  it("shared_device: one flag per account on its best run from the shared pair", () => {
    const device: [string, string] = ["ip-shared", "ua-shared"];
    const aBest = evidence({ account: "a", score: 25_000, device });
    const aWorse = evidence({ account: "a", score: 35_000, device });
    const bOnly = evidence({ account: "b", score: 32_000, device });
    // Same address, different browser: a household, not one device.
    const household = evidence({
      account: "c",
      device: ["ip-shared", "ua-other"],
    });
    const output = analyze([aBest, aWorse, bOnly, household]);
    expect(flagFor(output.flags, aBest)!.rules).toEqual([
      { rule: "shared_device", accountsSharing: 2 },
    ]);
    expect(flagFor(output.flags, bOnly)!.rules).toEqual([
      { rule: "shared_device", accountsSharing: 2 },
    ]);
    expect(flagFor(output.flags, aWorse)).toBeUndefined();
    expect(flagFor(output.flags, household)).toBeUndefined();
  });

  it("keeps board epochs apart and never flags a retired board", () => {
    const retired = evidence({
      mode: "trade",
      score: 9_000,
      completedAt: "2026-07-20T00:00:00.000Z",
      reviewSignals: ["input_timing_invalid"],
    });
    const current = evidence({
      mode: "trade",
      score: 9_000,
      completedAt: "2026-10-20T00:00:00.000Z",
      reviewSignals: ["input_timing_invalid"],
    });
    const output = analyze([retired, current]);
    expect(output.flags.map((flag) => flag.boardEpoch)).toEqual(["r2"]);
    expect(
      output.distributions.map((line) => [
        line.mode,
        line.boardEpoch,
        line.currentBoard,
      ]),
    ).toEqual([
      ["trade", "r2", true],
      ["trade", "retired", false],
    ]);
    // A history stamp wins over the completion-time cutover.
    const stamped = withHistoryEpoch(runsOf([current])[0]!, "r1");
    expect(stamped).toMatchObject({ boardEpoch: "r1", currentBoard: false });
  });

  it("reads only scored ranked evidence and history rows", () => {
    expect(
      analysisRunFromEvidence(evidence({ runType: "unscored" })),
    ).toBeUndefined();
    expect(analysisRunFromEvidence(evidence({ score: 0 }))).toBeUndefined();
    expect(
      historyRunFromItem({
        pk: "PLAYER#x",
        runId: "r",
        mode: "practice",
        score: 40,
        completedAt: SURGE_DAY,
      }),
    ).toBeUndefined();
    expect(
      historyRunFromItem({
        pk: "PLAYER#x",
        runId: "r",
        mode: "rain",
        score: 40,
        completedAt: SURGE_DAY,
        boardEpoch: "r4",
      }),
    ).toEqual({
      account: "PLAYER#x",
      runId: "r",
      mode: "rain",
      score: 40,
      completedAt: SURGE_DAY,
      boardEpoch: "r4",
    });
  });
});

describe("run analysis log lines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits the summary, distribution, and flag shapes the dashboard reads", () => {
    const signalled = evidence({ reviewSignals: ["input_timing_invalid"] });
    const output = analyze([...population(), signalled]);
    expect(output.summary).toEqual({
      event: "run-analysis.summary",
      analysisVersion: ANALYSIS_VERSION,
      analysisRunAt: RUN_AT,
      runsRead: 31,
      currentBoardRuns: 31,
      observedTimingRuns: 30,
      unscoredRead: 0,
      runsFlagged: 1,
      flagsByRule: {
        subhuman_reads: 0,
        mechanical_cadence: 0,
        elite_speed_and_score: 0,
        abrupt_jump: 0,
        automatic_signal: 1,
        untrusted_input: 0,
        shared_device: 0,
      },
      flagsByMode: { surge: 1 },
      distributionGroups: 1,
    });
    expect(Object.keys(output.distributions[0]!).sort()).toEqual(
      [
        "event",
        "analysisVersion",
        "analysisRunAt",
        "mode",
        "boardEpoch",
        "currentBoard",
        "runs",
        "observedRuns",
        "scoreP1",
        "scoreP50",
        "scoreP99",
        "medianReadMsP1",
        "medianReadMsP50",
        "medianReadMsP99",
        "readSpreadMsP1",
        "readSpreadMsP50",
        "readSpreadMsP99",
      ].sort(),
    );
    expect(output.distributions[0]).toMatchObject({
      event: "run-analysis.distribution",
      mode: "surge",
      boardEpoch: "r1",
      currentBoard: true,
      runs: 31,
      observedRuns: 30,
    });
    expect(output.flags).toEqual([
      {
        event: "run-analysis.flag",
        analysisVersion: ANALYSIS_VERSION,
        analysisRunAt: RUN_AT,
        runTag: scriptRunReference(String(signalled.runId)),
        mode: "surge",
        boardEpoch: "r1",
        seasonId: 137,
        score: 30_000,
        rules: [
          { rule: "automatic_signal", signals: ["input_timing_invalid"] },
        ],
      },
    ]);
  });

  it("logs no sub, playerId, email, name, CR tag, hash, or run UUID", async () => {
    const sub = "S".repeat(43);
    const secretBearing = (
      item: Record<string, unknown>,
    ): Record<string, unknown> => ({
      ...item,
      // Attributes the projection never asks for; a fake that ignored the
      // projection must still not leak them through the rules.
      playerSub: sub,
      playerTag: "#2PYQ0CRTAG",
      playerId: "player-id-pseudonym",
      email: "private@example.invalid",
      publicName: "Secret Name",
    });
    const device: [string, string] = ["ipHashSecret123", "uaHashSecret456"];
    const items = [
      ...population(),
      evidence({
        account: sub,
        score: 5_000,
        reads: Array.from({ length: 15 }, () => 60),
        untrusted: 3,
        reviewSignals: ["surge_repeated_sub_100ms_inputs"],
        device,
      }),
      evidence({ account: "other-account", device }),
    ].map(secretBearing);
    const lines: unknown[] = [];
    vi.spyOn(console, "info").mockImplementation((line) => lines.push(line));
    const output = await runAnalysis(
      async () => ({ Items: items }),
      "table",
      new Date(RUN_AT),
    );
    expect(output.flags.length).toBeGreaterThan(0);
    const text = JSON.stringify(lines);
    for (const forbidden of [
      sub,
      "PLAYER#",
      "other-account",
      "#2PYQ0CRTAG",
      "player-id-pseudonym",
      "private@example.invalid",
      "Secret Name",
      "ipHashSecret123",
      "uaHashSecret456",
      ...items.map((item) => String(item.runId)),
    ])
      expect(text).not.toContain(forbidden);
    // The summary is the last line, so its arrival means the run is complete.
    expect((lines.at(-1) as { event: string }).event).toBe(
      "run-analysis.summary",
    );
  });
});

describe("run analysis job", () => {
  afterEach(() => vi.restoreAllMocks());

  it("scans read-only with the allowlisted projection and joins history epochs", async () => {
    const run = evidence({
      mode: "rain",
      score: 50,
      completedAt: "2026-10-20T00:00:00.000Z",
      reviewSignals: ["input_timing_invalid"],
    });
    const history = {
      pk: run.pk,
      sk: `RUN#${String(run.completedAt)}#${String(run.runId)}`,
      runId: run.runId,
      mode: "rain",
      score: 50,
      completedAt: run.completedAt,
      boardEpoch: "r3",
    };
    const unscored = evidence({ mode: "rain", runType: "unscored" });
    const commands: ScanCommand[] = [];
    const pages: Partial<ScanCommandOutput>[] = [
      { Items: [run], LastEvaluatedKey: { pk: "PLAYER#x", sk: "y" } },
      { Items: [], LastEvaluatedKey: { pk: "PLAYER#y", sk: "z" } },
      { Items: [history, unscored] },
    ];
    vi.spyOn(console, "info").mockImplementation(() => {});
    const output = await runAnalysis(
      async (command) => {
        commands.push(command);
        return pages.shift()!;
      },
      "elixir-drop",
      new Date(RUN_AT),
    );
    expect(commands).toHaveLength(3);
    const input = commands[0]!.input;
    expect(input.Select).toBe("SPECIFIC_ATTRIBUTES");
    expect(input.TableName).toBe("elixir-drop");
    expect(commands[1]!.input.ExclusiveStartKey).toEqual({
      pk: "PLAYER#x",
      sk: "y",
    });
    // Every name the request touches is on the IAM allowlist.
    const allowed = new Set<string>([...ANALYSIS_ATTRIBUTES, "inputEvents"]);
    for (const name of Object.values(input.ExpressionAttributeNames ?? {}))
      expect(allowed.has(name)).toBe(true);
    // The r3 history stamp moves the run to a retired Rain board: no flag.
    expect(output.flags).toEqual([]);
    expect(output.distributions[0]).toMatchObject({
      mode: "rain",
      boardEpoch: "r3",
      currentBoard: false,
    });
    expect(output.summary).toMatchObject({ runsRead: 1, unscoredRead: 1 });
  });

  it("logs a D tag that referee-run.mjs resolves to the run", async () => {
    const run = evidence({ reviewSignals: ["input_timing_invalid"] });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const output = await runAnalysis(async () => ({ Items: [run] }), "t");
    const runTag = output.flags[0]!.runTag;
    expect(runTag).toMatch(/^#D[0-9A-HJKMNP-TV-Z]{10}$/);

    // The referee tool's own scan, over a fake table holding two runs.
    const doc = { send: async () => ({ Items: [run, evidence()] }) };
    const found = await findEvidenceByRunId(doc, runTag);
    expect(found?.runId).toBe(run.runId);
  });
});

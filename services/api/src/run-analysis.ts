import { runReference } from "@elixir-drop/contracts";
import {
  MODE_RULES,
  boardEpochFor,
  isCurrentBoardRun,
  isGameMode,
  isLeaderboardEligibleScore,
} from "./games.js";
import type { GameMode } from "./types.js";

// The daily run analysis (docs/FAIR-PLAY.md, "Run analysis"). Pure: no I/O, so
// every rule is unit-tested on fixture evidence. It reads sanitized Fair Play
// evidence and run history, builds per-mode distributions by board epoch, and
// describes the runs far outside them. It decides nothing: it writes no
// REFEREE# decision and changes no run, score, board or player. A flag is a
// prompt for a hand investigation, never a verdict.
//
// Output carries only a run's public D tag, mode, board epoch, season, score
// and rule measures. The account grouping key (the item's partition key) and
// the peppered correlation hashes stay inside this module.

// Bump when a rule, threshold, or measure changes meaning, so the dashboard
// can tell one calibration from the next.
export const ANALYSIS_VERSION = "1";

export const RULES = {
  // A quarter or more of a run's first reads were faster than a person can
  // see a card and answer it.
  subhumanReads: "subhuman_reads",
  // A run's read times vary far less than any other run in its mode.
  mechanicalCadence: "mechanical_cadence",
  // Score and read speed are both far past the rest of the mode at once.
  eliteSpeedAndScore: "elite_speed_and_score",
  // A run beats the player's own previous best by far more than the mode's
  // usual spread.
  abruptJump: "abrupt_jump",
  // The scorer or timing check already raised a review signal.
  automaticSignal: "automatic_signal",
  // At least one answer arrived as an event the browser did not mark trusted.
  untrustedInput: "untrusted_input",
  // The same connection and exact browser played ranked runs on more than one
  // account.
  sharedDevice: "shared_device",
} as const;

export type RuleName = (typeof RULES)[keyof typeof RULES];

// A read under this many milliseconds is faster than human choice reaction.
export const HUMAN_FLOOR_MS = 150;
// Share of a run's first reads under the floor that fires subhuman_reads.
export const SUBHUMAN_READ_SHARE = 0.25;
// A timing rule needs at least this many first reads to say anything.
export const MIN_READS = 8;
// Distribution rules need this many comparable runs in the mode and epoch.
export const MIN_POPULATION = 20;
// A read spread this small is mechanical whatever the population says.
export const MECHANICAL_SPREAD_MS = 10;
// Robust z (median/MAD) thresholds. Negative means faster or more regular.
export const CADENCE_Z = -4;
export const ELITE_SCORE_Z = 3;
export const ELITE_READ_Z = -3;
export const JUMP_Z = 2.5;
// abrupt_jump compares against the player's own earlier runs on the board.
export const MIN_PRIOR_RUNS = 3;

// Leader-position holds say where a run would place, not how it was played.
const POSITION_SIGNALS = new Set([
  "new_season_leader_pending_review",
  "new_all_time_leader_pending_review",
  "leader_review_check_unavailable",
]);

export interface AnalysisRun {
  // Opaque grouping key for one account. Never emitted.
  account: string;
  runId: string;
  mode: GameMode;
  boardEpoch: string;
  currentBoard: boolean;
  seasonId: number;
  score: number;
  completedAt: string;
  reviewSignals: string[];
  // First input of each round, display-to-input milliseconds (observed-v2).
  reads?: number[];
  inputCount?: number;
  untrustedInputs?: number;
  // ipHash|uaHash pairs from start and complete. Never emitted.
  devices: string[];
}

export interface HistoryRun {
  account: string;
  runId: string;
  mode: GameMode;
  boardEpoch: string;
  score: number;
  completedAt: string;
}

type Item = Record<string, unknown>;

function boardEpochOf(
  mode: GameMode,
  stamped: unknown,
  completedAt: string,
): { boardEpoch: string; currentBoard: boolean } {
  const current = boardEpochFor(mode) ?? "r1";
  const epoch = typeof stamped === "string" ? stamped : undefined;
  if (isCurrentBoardRun({ mode, completedAt, boardEpoch: epoch }))
    return { boardEpoch: current, currentBoard: true };
  return { boardEpoch: epoch ?? "retired", currentBoard: false };
}

// One RUN# history row as the analysis needs it, or undefined for practice,
// zero scores, and rows it cannot read.
export function historyRunFromItem(item: Item): HistoryRun | undefined {
  const { pk, runId, mode, score, completedAt } = item;
  if (
    typeof pk !== "string" ||
    typeof runId !== "string" ||
    !isGameMode(mode) ||
    mode === "practice" ||
    typeof score !== "number" ||
    !isLeaderboardEligibleScore(score) ||
    typeof completedAt !== "string"
  )
    return undefined;
  return {
    account: pk,
    runId,
    mode,
    score,
    completedAt,
    boardEpoch: boardEpochOf(mode, item.boardEpoch, completedAt).boardEpoch,
  };
}

function firstReads(inputEvents: unknown): number[] | undefined {
  if (!Array.isArray(inputEvents)) return undefined;
  const byRound = new Map<number, number>();
  for (const event of inputEvents as Item[]) {
    const round = Number(event?.round);
    const enabledAtMs = Number(event?.enabledAtMs);
    const inputAtMs = Number(event?.inputAtMs);
    if (
      !Number.isSafeInteger(round) ||
      !Number.isFinite(enabledAtMs) ||
      !Number.isFinite(inputAtMs) ||
      byRound.has(round)
    )
      continue;
    byRound.set(round, Math.max(0, inputAtMs - enabledAtMs));
  }
  return [...byRound.values()];
}

function devicesOf(correlation: unknown): string[] {
  const devices = new Set<string>();
  const sides =
    correlation && typeof correlation === "object"
      ? Object.values(correlation as Item)
      : [];
  for (const side of sides) {
    const { ipHash, uaHash } = (side ?? {}) as Item;
    if (typeof ipHash === "string" && typeof uaHash === "string")
      devices.add(`${ipHash}|${uaHash}`);
  }
  return [...devices];
}

// One EVIDENCE# item as the analysis needs it. Only a scored ranked run is
// analyzed; unscored attempts and anything unreadable return undefined.
export function analysisRunFromEvidence(item: Item): AnalysisRun | undefined {
  const { pk, runId, mode, seasonId, score, completedAt } = item;
  if (
    item.runType !== "ranked" ||
    typeof pk !== "string" ||
    typeof runId !== "string" ||
    !isGameMode(mode) ||
    mode === "practice" ||
    typeof seasonId !== "number" ||
    typeof score !== "number" ||
    !isLeaderboardEligibleScore(score) ||
    typeof completedAt !== "string"
  )
    return undefined;
  const timing = (item.timing ?? {}) as Item;
  const observed = timing.model === "observed-v2";
  const inputEvents = ((item.transcript ?? {}) as Item).inputEvents;
  const reads = observed ? firstReads(inputEvents) : undefined;
  const untrusted = Array.isArray(inputEvents)
    ? (inputEvents as Item[]).filter((event) => event?.trusted === false).length
    : Number(timing.untrustedInputCount ?? 0);
  return {
    account: pk,
    runId,
    mode,
    seasonId,
    score,
    completedAt,
    ...boardEpochOf(mode, undefined, completedAt),
    reviewSignals: Array.isArray(item.reviewSignals)
      ? item.reviewSignals.filter(
          (signal): signal is string => typeof signal === "string",
        )
      : [],
    ...(reads ? { reads } : {}),
    ...(observed
      ? {
          inputCount: Array.isArray(inputEvents)
            ? inputEvents.length
            : Number(timing.inputCount ?? 0),
          untrustedInputs: untrusted,
        }
      : {}),
    devices: devicesOf(item.correlation),
  };
}

// Evidence carries no board epoch; the run's history row stamps the one that
// dealt it. Unstamped legacy rows keep the completion-time cutover.
export function withHistoryEpoch(
  run: AnalysisRun,
  stamped: unknown,
): AnalysisRun {
  return { ...run, ...boardEpochOf(run.mode, stamped, run.completedAt) };
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

// Nearest-rank percentile of an already sorted list.
function percentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  return values[
    Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))
  ];
}

function median(values: number[]): number {
  const ordered = sorted(values);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

// Median absolute deviation, unscaled.
function mad(values: number[]): number {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

interface Robust {
  center: number;
  // MAD scaled by 1.4826 so it estimates a standard deviation.
  scale: number;
  size: number;
}

function robust(values: number[]): Robust | undefined {
  if (values.length < MIN_POPULATION) return undefined;
  const scale = mad(values) * 1.4826;
  return scale > 0
    ? { center: median(values), scale, size: values.length }
    : undefined;
}

function z(value: number, population: Robust | undefined): number | undefined {
  return population
    ? (value - population.center) / population.scale
    : undefined;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const logMs = (ms: number) => Math.log(ms + 1);

// Higher is always better, whatever the mode's score direction. A timed
// score is compared on a log scale: the fast tail of a time is bounded by zero
// and the slow tail is long, so raw milliseconds would hide a fast outlier.
function goodness(mode: GameMode, score: number): number {
  const rule = MODE_RULES[mode];
  const value = rule.scoreUnit === "milliseconds" ? Math.log(score) : score;
  return rule.direction === "lower" ? -value : value;
}

export type RuleMeasure = { rule: RuleName } & Record<
  string,
  number | string | string[]
>;

export interface FlagLine {
  event: "run-analysis.flag";
  analysisVersion: string;
  analysisRunAt: string;
  runTag: string;
  mode: GameMode;
  boardEpoch: string;
  seasonId: number;
  score: number;
  rules: RuleMeasure[];
}

export interface DistributionLine {
  event: "run-analysis.distribution";
  analysisVersion: string;
  analysisRunAt: string;
  mode: GameMode;
  boardEpoch: string;
  currentBoard: boolean;
  runs: number;
  observedRuns: number;
  scoreP1?: number;
  scoreP50?: number;
  scoreP99?: number;
  medianReadMsP1?: number;
  medianReadMsP50?: number;
  medianReadMsP99?: number;
  readSpreadMsP1?: number;
  readSpreadMsP50?: number;
  readSpreadMsP99?: number;
}

export interface SummaryLine {
  event: "run-analysis.summary";
  analysisVersion: string;
  analysisRunAt: string;
  runsRead: number;
  currentBoardRuns: number;
  observedTimingRuns: number;
  unscoredRead: number;
  runsFlagged: number;
  flagsByRule: Record<RuleName, number>;
  flagsByMode: Partial<Record<GameMode, number>>;
  distributionGroups: number;
}

export interface AnalysisOutput {
  summary: SummaryLine;
  distributions: DistributionLine[];
  flags: FlagLine[];
}

interface Derived {
  run: AnalysisRun;
  medianRead?: number;
  readSpread?: number;
}

function derive(run: AnalysisRun): Derived {
  if (!run.reads || run.reads.length < MIN_READS) return { run };
  return {
    run,
    medianRead: median(run.reads),
    readSpread: mad(run.reads),
  };
}

const groupKey = (mode: string, epoch: string) => `${mode}\u0000${epoch}`;

export function analyzeRuns(
  runs: AnalysisRun[],
  history: HistoryRun[],
  options: { analysisRunAt: string; unscoredRead?: number },
): AnalysisOutput {
  const base = {
    analysisVersion: ANALYSIS_VERSION,
    analysisRunAt: options.analysisRunAt,
  };
  const groups = new Map<string, Derived[]>();
  for (const run of runs) {
    const key = groupKey(run.mode, run.boardEpoch);
    const group = groups.get(key) ?? [];
    group.push(derive(run));
    groups.set(key, group);
  }

  // Every account's comparable history, for abrupt_jump. Evidence runs are
  // folded in too, so a run whose history row is missing still counts.
  const own = new Map<
    string,
    Map<string, { score: number; completedAt: string }>
  >();
  for (const row of [...history, ...runs]) {
    const key = `${row.account}\u0000${groupKey(row.mode, row.boardEpoch)}`;
    const rows = own.get(key) ?? new Map();
    rows.set(row.runId, { score: row.score, completedAt: row.completedAt });
    own.set(key, rows);
  }

  // shared_device: pairs seen on more than one account with ranked runs.
  const accountsByDevice = new Map<string, Set<string>>();
  for (const run of runs)
    for (const device of run.devices) {
      const accounts = accountsByDevice.get(device) ?? new Set<string>();
      accounts.add(run.account);
      accountsByDevice.set(device, accounts);
    }
  const sharedDeviceRuns = new Map<string, number>();
  const bestSharedRun = new Map<string, AnalysisRun>();
  for (const run of runs) {
    if (!run.currentBoard) continue;
    const sharing = Math.max(
      0,
      ...run.devices.map((device) => accountsByDevice.get(device)!.size),
    );
    if (sharing < 2) continue;
    sharedDeviceRuns.set(run.runId, sharing);
    // One flag per account, mode and board: its best run on a shared device.
    const key = `${run.account}\u0000${groupKey(run.mode, run.boardEpoch)}`;
    const best = bestSharedRun.get(key);
    if (
      !best ||
      goodness(run.mode, run.score) > goodness(best.mode, best.score)
    )
      bestSharedRun.set(key, run);
  }
  const sharedFlagged = new Set(
    [...bestSharedRun.values()].map((run) => run.runId),
  );

  const distributions: DistributionLine[] = [];
  const flags: FlagLine[] = [];
  for (const group of groups.values()) {
    const { mode, boardEpoch, currentBoard } = group[0]!.run;
    const scores = sorted(group.map((entry) => entry.run.score));
    const observed = group.filter((entry) => entry.medianRead !== undefined);
    const medians = sorted(observed.map((entry) => entry.medianRead!));
    const spreads = sorted(observed.map((entry) => entry.readSpread!));
    const scorePopulation = robust(
      group.map((entry) => goodness(mode, entry.run.score)),
    );
    const readPopulation = robust(medians.map(logMs));
    const spreadPopulation = robust(spreads.map(logMs));
    const round = (value: number | undefined) =>
      value === undefined ? undefined : Math.round(value);
    distributions.push({
      event: "run-analysis.distribution",
      ...base,
      mode,
      boardEpoch,
      currentBoard,
      runs: group.length,
      observedRuns: observed.length,
      scoreP1: percentile(scores, 0.01),
      scoreP50: percentile(scores, 0.5),
      scoreP99: percentile(scores, 0.99),
      medianReadMsP1: round(percentile(medians, 0.01)),
      medianReadMsP50: round(percentile(medians, 0.5)),
      medianReadMsP99: round(percentile(medians, 0.99)),
      readSpreadMsP1: round(percentile(spreads, 0.01)),
      readSpreadMsP50: round(percentile(spreads, 0.5)),
      readSpreadMsP99: round(percentile(spreads, 0.99)),
    });
    // Retired boards inform their own distribution only; nobody can climb them.
    if (!currentBoard) continue;

    for (const { run, medianRead, readSpread } of group) {
      const fired: RuleMeasure[] = [];
      if (run.reads && run.reads.length >= MIN_READS) {
        const under = run.reads.filter((ms) => ms < HUMAN_FLOOR_MS).length;
        const share = under / run.reads.length;
        if (share >= SUBHUMAN_READ_SHARE)
          fired.push({
            rule: RULES.subhumanReads,
            readsUnderFloor: under,
            reads: run.reads.length,
            share: round2(share),
            floorMs: HUMAN_FLOOR_MS,
          });
      }
      if (readSpread !== undefined) {
        const cadenceZ = z(logMs(readSpread), spreadPopulation);
        if (
          readSpread < MECHANICAL_SPREAD_MS ||
          (cadenceZ !== undefined && cadenceZ <= CADENCE_Z)
        )
          fired.push({
            rule: RULES.mechanicalCadence,
            readSpreadMs: Math.round(readSpread),
            ...(cadenceZ !== undefined ? { z: round2(cadenceZ) } : {}),
            ...(spreadPopulation
              ? {
                  populationReadSpreadMs: Math.round(percentile(spreads, 0.5)!),
                }
              : {}),
          });
      }
      const scoreZ = z(goodness(mode, run.score), scorePopulation);
      if (medianRead !== undefined && scoreZ !== undefined) {
        const readZ = z(logMs(medianRead), readPopulation);
        if (
          readZ !== undefined &&
          scoreZ >= ELITE_SCORE_Z &&
          readZ <= ELITE_READ_Z
        )
          fired.push({
            rule: RULES.eliteSpeedAndScore,
            scoreZ: round2(scoreZ),
            medianReadMs: Math.round(medianRead),
            readZ: round2(readZ),
          });
      }
      if (scorePopulation) {
        const earlier = [
          ...own
            .get(`${run.account}\u0000${groupKey(mode, boardEpoch)}`)!
            .entries(),
        ]
          .filter(
            ([runId, row]) =>
              runId !== run.runId && row.completedAt < run.completedAt,
          )
          .map(([, row]) => row.score);
        if (earlier.length >= MIN_PRIOR_RUNS) {
          const priorBest = earlier.reduce((best, score) =>
            goodness(mode, score) > goodness(mode, best) ? score : best,
          );
          const jumpZ =
            (goodness(mode, run.score) - goodness(mode, priorBest)) /
            scorePopulation.scale;
          if (jumpZ >= JUMP_Z)
            fired.push({
              rule: RULES.abruptJump,
              priorRuns: earlier.length,
              priorBest,
              jumpZ: round2(jumpZ),
            });
        }
      }
      const signals = run.reviewSignals.filter(
        (signal) => !POSITION_SIGNALS.has(signal),
      );
      if (signals.length) fired.push({ rule: RULES.automaticSignal, signals });
      if ((run.untrustedInputs ?? 0) > 0)
        fired.push({
          rule: RULES.untrustedInput,
          untrustedInputs: run.untrustedInputs!,
          inputs: run.inputCount ?? 0,
        });
      if (sharedFlagged.has(run.runId))
        fired.push({
          rule: RULES.sharedDevice,
          accountsSharing: sharedDeviceRuns.get(run.runId)!,
        });
      if (fired.length)
        flags.push({
          event: "run-analysis.flag",
          ...base,
          runTag: runReference(run.runId),
          mode,
          boardEpoch,
          seasonId: run.seasonId,
          score: run.score,
          rules: fired,
        });
    }
  }

  flags.sort(
    (a, b) => a.mode.localeCompare(b.mode) || a.runTag.localeCompare(b.runTag),
  );
  distributions.sort(
    (a, b) =>
      a.mode.localeCompare(b.mode) || a.boardEpoch.localeCompare(b.boardEpoch),
  );
  const flagsByRule = Object.fromEntries(
    Object.values(RULES).map((rule) => [rule, 0]),
  ) as Record<RuleName, number>;
  const flagsByMode: Partial<Record<GameMode, number>> = {};
  for (const flag of flags) {
    flagsByMode[flag.mode] = (flagsByMode[flag.mode] ?? 0) + 1;
    for (const { rule } of flag.rules) flagsByRule[rule] += 1;
  }
  return {
    summary: {
      event: "run-analysis.summary",
      ...base,
      runsRead: runs.length,
      currentBoardRuns: runs.filter((run) => run.currentBoard).length,
      observedTimingRuns: runs.filter((run) => run.reads !== undefined).length,
      unscoredRead: options.unscoredRead ?? 0,
      runsFlagged: flags.length,
      flagsByRule,
      flagsByMode,
      distributionGroups: distributions.length,
    },
    distributions,
    flags,
  };
}

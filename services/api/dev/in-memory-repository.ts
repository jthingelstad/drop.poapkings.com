import { randomUUID } from "node:crypto";
import { HttpError } from "../src/errors.js";
import {
  isCurrentBoardRun,
  isLeaderboardEligibleScore,
  leaderboardSortKey,
  MODE_RULES,
} from "../src/games.js";
import { placeholderPublicProfile, publicProfile } from "../src/public-profile.js";
import type {
  RunItem,
  RunRecoveryOptions,
  StoredBadgeCounters,
  PublicPlayerLookup,
} from "../src/repository.js";
import type {
  Correlation,
  CrProfileSnapshot,
  GameMode,
  PlayerProfile,
  RefereeDecision,
  RunChallenge,
  RunRecord,
  RunTiebreaks,
  StoredCrWarClock,
  RankedAccessStatus,
} from "../src/types.js";

// A Node-only, in-memory stand-in for the DynamoDB-backed Repository, for the
// local dev harness ONLY (services/api/dev/server.ts). It runs the REAL handler,
// routing, validation, scoring, session-signing and contracts — only storage is
// swapped for plain Maps. It is NOT a faithful DynamoDB replica: sort/transaction
// fidelity is simplified and there is no referee/CR/learning machinery. Any
// Repository method the frontend flows do not exercise throws loudly rather than
// returning a plausible-but-wrong value.
//
// It is assigned to callers as `Repository` via a cast in server.ts; the real
// class's private fields make it structurally incompatible, which is expected.

const TROPHY_ROAD_STARTING_GAMES = 592;

interface Completion {
  owner: string;
  runId: string;
  mode: GameMode;
  score: number;
  seasonId: string;
  completedAt: string;
  ranked: boolean;
  answerCount?: number;
  xp?: number;
  boardEpoch?: string;
  rungs?: string[];
}

type Row = Record<string, unknown>;

function notImplemented(method: string): never {
  throw new Error(`${method} is not implemented in the dev harness`);
}

export class InMemoryRepository {
  private profiles = new Map<string, PlayerProfile>();
  private playerIdIndex = new Map<string, string>(); // playerId -> sub
  private runs = new Map<string, RunItem>();
  private completions: Completion[] = [];
  private allTimeBest = new Map<string, { score: number; sortKey: string }>();
  private badges = new Map<string, StoredBadgeCounters>();
  private magicLinks = new Map<
    string,
    { email: string; pollId?: string; expiresAt: number }
  >();
  private pollSessions = new Map<
    string,
    { session: unknown; expiresAt: number }
  >();
  private extraGames = 0;

  // ── Rate limits (always allow locally) ──────────────────────────────────
  async useRateLimit(): Promise<void> {}

  // ── Magic link + poll handoff ───────────────────────────────────────────
  async saveMagicLink(
    tokenHash: string,
    email: string,
    expiresAt: number,
    pollId?: string,
  ): Promise<void> {
    this.magicLinks.set(tokenHash, { email, pollId, expiresAt });
  }
  async deleteMagicLink(tokenHash: string): Promise<void> {
    this.magicLinks.delete(tokenHash);
  }
  async peekMagicLink(
    tokenHash: string,
    nowSeconds: number,
  ): Promise<{ email: string; pollId?: string }> {
    const link = this.magicLinks.get(tokenHash);
    if (!link || link.expiresAt <= nowSeconds)
      throw new HttpError(
        400,
        "This login link is invalid or has expired.",
        "invalid_magic_link",
      );
    return { email: link.email, pollId: link.pollId };
  }
  async consumeMagicLink(tokenHash: string): Promise<void> {
    this.magicLinks.delete(tokenHash);
  }
  async savePollSession(
    pollId: string,
    session: unknown,
    expiresAt: number,
  ): Promise<void> {
    this.pollSessions.set(pollId, { session, expiresAt });
  }
  async takePollSession(
    pollId: string,
    nowSeconds: number,
  ): Promise<unknown | undefined> {
    const held = this.pollSessions.get(pollId);
    if (!held || held.expiresAt <= nowSeconds) return undefined;
    this.pollSessions.delete(pollId);
    return held.session;
  }

  // ── Profiles ────────────────────────────────────────────────────────────
  async ensureProfile(
    sub: string,
    email: string,
  ): Promise<{ profile: PlayerProfile; created: boolean }> {
    const now = new Date().toISOString();
    const existing = this.profiles.get(sub);
    if (existing) {
      existing.lastLoginAt = now;
      return { profile: existing, created: false };
    }
    const profile: PlayerProfile = {
      sub,
      playerId: randomUUID(),
      email,
      totalGames: 0,
      xp: 0,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    this.profiles.set(sub, profile);
    this.playerIdIndex.set(profile.playerId, sub);
    return { profile, created: true };
  }
  async getProfile(sub: string): Promise<PlayerProfile | undefined> {
    return this.profiles.get(sub);
  }
  async updateProfile(
    sub: string,
    updates: {
      publicName?: string;
      favoriteCardId?: number;
      playerTag?: string;
      clearPlayerTag?: boolean;
      lastOpenedUpdates?: string;
    },
  ): Promise<PlayerProfile> {
    const profile = this.profiles.get(sub);
    if (!profile) throw new HttpError(404, "Player profile not found.");
    if (updates.publicName !== undefined) profile.publicName = updates.publicName;
    if (updates.favoriteCardId !== undefined)
      profile.favoriteCardId = updates.favoriteCardId;
    if (updates.lastOpenedUpdates !== undefined)
      profile.lastOpenedUpdates = updates.lastOpenedUpdates;
    if (updates.playerTag !== undefined) profile.playerTag = updates.playerTag;
    else if (updates.clearPlayerTag) delete profile.playerTag;
    profile.updatedAt = new Date().toISOString();
    return profile;
  }
  async getPublicPlayer(
    playerId: string,
  ): Promise<PublicPlayerLookup | undefined> {
    const sub = this.playerIdIndex.get(playerId);
    const profile = sub ? this.profiles.get(sub) : undefined;
    if (!sub || !profile) return undefined;
    return { sub, player: publicProfile(profile) };
  }
  async deleteAccount(sub: string): Promise<{ deletedGames: number }> {
    const deletedGames = this.completions.filter((c) => c.owner === sub).length;
    const profile = this.profiles.get(sub);
    if (profile) this.playerIdIndex.delete(profile.playerId);
    this.profiles.delete(sub);
    this.completions = this.completions.filter((c) => c.owner !== sub);
    this.badges.delete(sub);
    for (const key of [...this.allTimeBest.keys()])
      if (key.startsWith(`${sub}#`)) this.allTimeBest.delete(key);
    return { deletedGames };
  }
  async rankedAccess(): Promise<RankedAccessStatus> {
    return "allowed";
  }
  async badgeDecisionRevision(): Promise<number | undefined> {
    return undefined;
  }

  // ── Runs ────────────────────────────────────────────────────────────────
  async createRun(
    owner: string,
    mode: GameMode,
    challenge: RunChallenge,
    expiresAt: number,
    ranked = true,
    guest = false,
    startCorrelation?: Correlation,
  ): Promise<RunItem> {
    const runId = randomUUID();
    const item: RunItem = {
      pk: `RUN#${runId}`,
      sk: "RUN",
      runId,
      owner,
      mode,
      challenge,
      state: "started",
      startedAt: new Date().toISOString(),
      expiresAt,
      ranked,
      guest,
      ...(startCorrelation ? { startCorrelation } : {}),
    };
    this.runs.set(runId, item);
    return item;
  }
  async getRun(runId: string): Promise<RunItem | undefined> {
    return this.runs.get(runId);
  }
  async completeRun(
    run: RunItem,
    score: number,
    seasonId: string,
    xp: number,
    _tiebreaks?: RunTiebreaks,
    _automaticReviewReason?: string,
    _recovery?: RunRecoveryOptions,
  ): Promise<{ totalGames: number; completedAt: string; profile: PlayerProfile }> {
    const completedAt = new Date().toISOString();
    const item = this.runs.get(run.runId);
    if (item) {
      item.state = "completed";
      item.completedAt = completedAt;
      item.score = score;
      item.seasonId = seasonId;
    }
    const profile = this.profiles.get(run.owner);
    if (!profile) throw new Error("completeRun: owner profile missing");
    profile.totalGames += 1;
    profile.xp = (profile.xp ?? 0) + xp;
    profile.updatedAt = completedAt;
    this.completions.push({
      owner: run.owner,
      runId: run.runId,
      mode: run.mode,
      score,
      seasonId,
      completedAt,
      ranked: run.ranked !== false,
      ...(run.answerCount !== undefined ? { answerCount: run.answerCount } : {}),
      ...(xp ? { xp } : {}),
      ...(run.boardEpoch ? { boardEpoch: run.boardEpoch } : {}),
    });
    this.extraGames += 1;
    return { totalGames: profile.totalGames, completedAt, profile };
  }
  async updateAllTimeBest(
    run: RunItem,
    score: number,
    _tiebreaks: RunTiebreaks | undefined,
    completedAt: string,
  ): Promise<{ improved: boolean; previousScore?: number }> {
    if (
      !isLeaderboardEligibleScore(score) ||
      !isCurrentBoardRun({
        mode: run.mode,
        boardEpoch: run.boardEpoch,
        completedAt,
      })
    )
      return { improved: false };
    const key = `${run.owner}#${run.mode}`;
    const sortKey = leaderboardSortKey(run.mode, score, completedAt, run.owner);
    const existing = this.allTimeBest.get(key);
    if (!existing || sortKey < existing.sortKey) {
      this.allTimeBest.set(key, { score, sortKey });
      return {
        improved: true,
        ...(existing ? { previousScore: existing.score } : {}),
      };
    }
    return { improved: false };
  }
  async setRunRungs(sub: string, runId: string, _completedAt: string, slugs: string[]): Promise<void> {
    if (!slugs.length) return;
    const completion = this.completions.find((c) => c.owner === sub && c.runId === runId);
    if (completion) completion.rungs = slugs;
  }
  // The dev harness never holds a run for the referee, so a leading run simply
  // records normally. (No in-memory referee to hold it.)
  async wouldLeadAllTime(): Promise<boolean> {
    return false;
  }
  async wouldLeadSeason(): Promise<boolean> {
    return false;
  }
  async refereeDecisions(): Promise<Map<string, RefereeDecision>> {
    return new Map();
  }
  async podiumFinishers(): Promise<string[]> {
    return [];
  }
  async refereeEvidenceForRuns(): Promise<[]> {
    return [];
  }
  async putRefereeEvidence(): Promise<void> {}
  async getRunRecovery(): Promise<undefined> {
    return undefined;
  }
  async finishRunRecovery(): Promise<void> {}
  async saveRecoveredBadges(): Promise<void> {}
  async savePodiumAward(): Promise<void> {}

  private runRecords(sub: string): RunRecord[] {
    return this.completions
      .filter((c) => c.owner === sub)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      .map((c) => ({
        runId: c.runId,
        mode: c.mode,
        score: c.score,
        seasonId: c.seasonId,
        completedAt: c.completedAt,
        ...(c.answerCount !== undefined ? { answerCount: c.answerCount } : {}),
        ...(c.xp !== undefined ? { xp: c.xp } : {}),
        ...(c.rungs ? { rungs: c.rungs } : {}),
      }));
  }
  async listRecentRuns(sub: string, limit = 20): Promise<RunRecord[]> {
    return this.runRecords(sub).slice(0, limit);
  }
  async listRunHistory(sub: string): Promise<RunRecord[]> {
    return this.runRecords(sub);
  }
  async listAllRuns(sub: string): Promise<RunRecord[]> {
    return this.runRecords(sub);
  }

  // ── Boards ──────────────────────────────────────────────────────────────
  private bestPerOwner(records: Completion[]): Completion[] {
    const best = new Map<string, { record: Completion; sortKey: string }>();
    for (const record of records) {
      if (!isLeaderboardEligibleScore(record.score)) continue;
      const sortKey = leaderboardSortKey(
        record.mode,
        record.score,
        record.completedAt,
        record.owner,
      );
      const held = best.get(record.owner);
      if (!held || sortKey < held.sortKey) best.set(record.owner, { record, sortKey });
    }
    return [...best.values()]
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map((entry) => entry.record);
  }
  private toRow(record: Completion, index: number): Row {
    const profile = this.profiles.get(record.owner);
    return {
      rank: index + 1,
      score: record.score,
      achievedAt: record.completedAt,
      player: profile ? publicProfile(profile) : placeholderPublicProfile(index),
    };
  }
  async leaderboard(mode: GameMode, seasonId: string, limit = 50): Promise<Row[]> {
    return this.bestPerOwner(
      this.completions.filter(
        (c) => c.mode === mode && c.seasonId === seasonId && c.ranked,
      ),
    )
      .slice(0, limit)
      .map((record, index) => this.toRow(record, index));
  }
  async allTimeLeaderboard(mode: GameMode, limit = 50): Promise<Row[]> {
    return this.bestPerOwner(
      this.completions.filter((c) => c.mode === mode && c.ranked),
    )
      .slice(0, limit)
      .map((record, index) => this.toRow(record, index));
  }
  async clanAllTimeLeaderboard(): Promise<Row[]> {
    // No Clash Royale clan data locally, so a clan board is empty.
    return [];
  }
  async recentActivity(_seasonId: string, limit = 8): Promise<Row[]> {
    const groups = new Map<
      string,
      { c: Completion; runCount: number; achievedAt: string }
    >();
    for (const c of this.completions) {
      if (!c.ranked) continue;
      const key = `${c.owner} ${c.mode}`;
      const held = groups.get(key);
      if (!held) {
        groups.set(key, { c, runCount: 1, achievedAt: c.completedAt });
        continue;
      }
      held.runCount += 1;
      if (c.completedAt > held.achievedAt) held.achievedAt = c.completedAt;
      const better =
        MODE_RULES[c.mode].direction === "lower"
          ? c.score < held.c.score
          : c.score > held.c.score;
      if (better) held.c = c;
    }
    return [...groups.values()]
      .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt))
      .slice(0, Math.max(1, Math.min(limit, 25)))
      .map((group, index) => {
        const profile = this.profiles.get(group.c.owner);
        return {
          mode: group.c.mode,
          score: group.c.score,
          achievedAt: group.achievedAt,
          runCount: group.runCount,
          player: profile
            ? publicProfile(profile)
            : placeholderPublicProfile(index),
        };
      });
  }
  async globalStats(): Promise<{ trophyRoadGames: number }> {
    return { trophyRoadGames: TROPHY_ROAD_STARTING_GAMES + this.extraGames };
  }

  // ── Badges + learning (badges stored; learning left empty locally) ──────
  async getBadges(sub: string): Promise<StoredBadgeCounters | undefined> {
    return this.badges.get(sub);
  }
  async saveBadges(
    sub: string,
    counters: StoredBadgeCounters,
    at: string,
  ): Promise<boolean> {
    this.badges.set(sub, { ...counters, updatedAt: at });
    return true;
  }
  async getCardStats(): Promise<Record<string, never>> {
    return {};
  }
  async saveCardStats(): Promise<void> {}
  async getLedgerStats(): Promise<undefined> {
    return undefined;
  }
  async saveLedgerStats(): Promise<void> {}

  // ── Clash Royale (no bridge locally) ────────────────────────────────────
  async getCrProfile(): Promise<CrProfileSnapshot | undefined> {
    return undefined;
  }
  async saveCrProfileResult(): Promise<boolean> {
    return true;
  }
  async claimCrRefresh(): Promise<never> {
    return notImplemented("claimCrRefresh");
  }
  async markCrRefreshUnavailable(): Promise<void> {}
  async getCrWarClock(): Promise<StoredCrWarClock | undefined> {
    return undefined;
  }
  async saveCrWarClock(): Promise<void> {}

  // ── Seed a little data so boards, activity, and the period rail aren't empty.
  seed(seasons: string[]): void {
    const current = seasons[0] ?? "2026-08";
    const previous = seasons[1] ?? current;
    const players: Array<{
      name: string;
      card: number;
      runs: Array<[GameMode, number, string]>;
    }> = [
      {
        name: "Knightmare",
        card: 26000000,
        runs: [
          ["surge", 16234, current],
          ["surge", 15980, current],
          ["rain", 46, current],
          ["survival", 92, current],
          ["higher-lower", 38, current],
          ["trade", 9400, current],
          ["surge", 17110, previous],
        ],
      },
      {
        name: "Spellbound",
        card: 26000009,
        runs: [
          ["surge", 17420, current],
          ["rain", 41, current],
          ["survival", 74, current],
          ["higher-lower", 33, current],
          ["surge", 18010, previous],
        ],
      },
      {
        name: "Towerfall",
        card: 26000004,
        runs: [
          ["surge", 19230, current],
          ["rain", 35, current],
          ["trade", 11200, current],
        ],
      },
    ];
    let seededGames = 0;
    for (const [index, player] of players.entries()) {
      const sub = `seed-${index + 1}`;
      const now = new Date().toISOString();
      const profile: PlayerProfile = {
        sub,
        playerId: `seed-player-${index + 1}`,
        email: `${sub}@example.com`,
        publicName: player.name,
        favoriteCardId: player.card,
        totalGames: player.runs.length,
        xp: player.runs.length * 12,
        createdAt: now,
        updatedAt: now,
      };
      this.profiles.set(sub, profile);
      this.playerIdIndex.set(profile.playerId, sub);
      for (const [runIndex, [mode, score, seasonId]] of player.runs.entries()) {
        const completedAt = new Date(
          Date.now() - (seededGames + runIndex) * 3_600_000,
        ).toISOString();
        this.completions.push({
          owner: sub,
          runId: `seed-${sub}-${runIndex}`,
          mode,
          score,
          seasonId,
          completedAt,
          ranked: true,
          xp: 12,
        });
      }
      seededGames += player.runs.length;
    }
    this.extraGames += seededGames;
  }
}

import { BADGE_LIST } from "@elixir-drop/contracts";
import cardCatalog from "@elixir-drop/game-data/cards.json";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  decideRun,
  getOverview,
  getPlayer,
  getRun,
  setRankedAccess,
  updatePlayerProfile,
} from "./api";
import type { Overview, PlayerDetail, PlayerSummary, RunDetail } from "./types";

type Cohort = "all" | "pending" | "restricted";
type WorkspaceTab = "runs" | "profile" | "badges";
type PlayerRun = PlayerDetail["progression"][string][number] & {
  mode: string;
};

const MODE_NAMES: Record<string, string> = {
  surge: "Surge",
  trade: "Trade",
  survival: "Survival",
  rain: "Rain",
  "higher-lower": "Higher / Lower",
  practice: "Practice",
};
const CARDS = [...cardCatalog.cards].sort((left, right) =>
  left.name.localeCompare(right.name),
);

function modeName(mode?: string): string {
  return mode ? (MODE_NAMES[mode] ?? mode) : "Unknown mode";
}

function modeIcon(mode?: string): string {
  return `/assets/modes/${mode && MODE_NAMES[mode] ? mode : "practice"}-192.png`;
}

function formatDate(value?: string, full = false): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return date.toLocaleString(
    undefined,
    full
      ? { dateStyle: "medium", timeStyle: "medium" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

function formatScore(mode?: string, score?: number): string {
  if (score === undefined || !Number.isFinite(score)) return "Unscored";
  if (mode === "surge" || mode === "trade")
    return `${(score / 1000).toFixed(3)}s`;
  return score.toLocaleString();
}

function scalar(value: unknown, fallback = "—"): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value);
}

function Avatar({
  cardId,
  small = false,
}: {
  cardId?: number;
  small?: boolean;
}) {
  return (
    <span class={`cr-avatar${small ? " cr-avatar--small" : ""}`}>
      <img
        src={cardId ? `/cards/${cardId}.png` : "/assets/icon/drop-icon-192.png"}
        alt=""
      />
    </span>
  );
}

function CopyTag({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      class="cr-tag"
      title={`Copy ${children}`}
      onClick={(event) => {
        event.stopPropagation();
        copyText(children);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied!" : children}
    </button>
  );
}

function runStatus(
  run: PlayerRun,
): "pending" | "reviewed" | "excluded" | "unreviewed" {
  const decision = run.decision;
  if (!decision) return "unreviewed";
  if (decision.queueState === "pending") return "pending";
  if (decision.visibility === "hidden") return "excluded";
  return "reviewed";
}

function statusLabel(status: ReturnType<typeof runStatus>): string {
  if (status === "pending") return "🔎 Pending";
  if (status === "excluded") return "🚫 Excluded";
  if (status === "reviewed") return "✅ Reviewed";
  return "• Unreviewed";
}

export default function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [cohort, setCohort] = useState<Cohort>("all");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>();
  const [playerDetail, setPlayerDetail] = useState<PlayerDetail | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [runError, setRunError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Connecting to Drop…");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      setError("");
      const next = await getOverview();
      setOverview(next);
      setStatus(
        `Live · ${new Date(next.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
      );
      setSelectedPlayerId((current) => {
        if (
          current &&
          next.players.some((player) => player.playerId === current)
        )
          return current;
        const pendingId = next.players.find(
          (player) => player.pendingRuns,
        )?.playerId;
        return pendingId ?? next.players[0]?.playerId;
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Control Room could not load.",
      );
      setStatus("Offline");
    }
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 120_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setPlayerDetail(null);
    setSelectedRunId(undefined);
    setRunDetail(null);
    if (!selectedPlayerId) return;
    void getPlayer(selectedPlayerId)
      .then(setPlayerDetail)
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Player could not load.",
        ),
      );
  }, [selectedPlayerId]);

  useEffect(() => {
    setRunDetail(null);
    setRunError("");
    if (!selectedRunId) return;
    void getRun(selectedRunId)
      .then(setRunDetail)
      .catch((reason) =>
        setRunError(
          reason instanceof Error
            ? reason.message
            : "Retained evidence could not load.",
        ),
      );
  }, [selectedRunId]);

  const players = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (overview?.players ?? []).filter((player) => {
      if (cohort === "pending" && player.pendingRuns === 0) return false;
      if (cohort === "restricted" && player.rankedAccess !== "restricted")
        return false;
      if (!query) return true;
      return [
        player.publicName,
        player.playerReference,
        player.playerTag,
        player.playerId,
        player.email,
        player.clashName,
        player.clanName,
        player.clanTag,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [overview, search, cohort]);

  const selectCohort = (next: Cohort) => {
    setCohort(next);
    setSearch("");
    const candidate = (overview?.players ?? []).find((player) =>
      next === "pending"
        ? player.pendingRuns > 0
        : next === "restricted"
          ? player.rankedAccess === "restricted"
          : true,
    );
    if (candidate) setSelectedPlayerId(candidate.playerId);
  };

  const selectedSummary = overview?.players.find(
    (player) => player.playerId === selectedPlayerId,
  );

  return (
    <div class="cr-shell">
      <aside class="cr-sidebar">
        <div class="cr-brand">
          <img src="/assets/icon/drop-icon-192.png" alt="" />
          <div>
            <strong>DROP</strong>
            <span>Control Room</span>
          </div>
        </div>
        <nav aria-label="Player cohorts">
          <NavButton
            active={cohort === "all"}
            icon="♟"
            label="All Players"
            count={overview?.totals.players}
            onClick={() => selectCohort("all")}
          />
          <NavButton
            active={cohort === "pending"}
            icon="🔎"
            label="Review Queue"
            count={overview?.totals.pending}
            onClick={() => selectCohort("pending")}
          />
          <NavButton
            active={cohort === "restricted"}
            icon="🚫"
            label="Restricted"
            count={overview?.totals.restricted}
            onClick={() => selectCohort("restricted")}
          />
        </nav>
        <div class="cr-sidebar__stats">
          <span>
            <b>{overview?.totals.runs ?? "—"}</b> recorded runs
          </span>
          <span>
            <b>{overview?.totals.pending ?? "—"}</b> awaiting review
          </span>
          <span>
            <b>{overview?.totals.restricted ?? "—"}</b> restricted
          </span>
        </div>
        <div class="cr-operator">
          <span class="cr-live" />
          {overview?.operator ?? "Tailnet operator"}
        </div>
      </aside>

      <main class="cr-directory">
        <header class="cr-directory__header">
          <div>
            <span class="cr-eyebrow">Player directory</span>
            <h1>
              {cohort === "pending"
                ? "Needs review"
                : cohort === "restricted"
                  ? "Restricted"
                  : "Everyone"}
            </h1>
          </div>
          <span class="cr-directory__count">{players.length}</span>
        </header>
        <label class="cr-search">
          <span>⌕</span>
          <input
            value={search}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Name, email, #P, Clash tag, clan…"
          />
        </label>
        {error && (
          <div class="cr-error" role="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        <PlayerDirectory
          players={players}
          selectedPlayerId={selectedPlayerId}
          onSelect={setSelectedPlayerId}
        />
        <footer class="cr-directory__footer">
          <span>{status}</span>
          <button onClick={() => void refresh()}>Refresh</button>
        </footer>
      </main>

      <section class="cr-workspace" aria-label="Player workspace">
        {selectedPlayerId ? (
          <PlayerWorkspace
            key={selectedPlayerId}
            detail={playerDetail}
            summary={selectedSummary}
            selectedRunId={selectedRunId}
            runDetail={runDetail}
            runError={runError}
            onOpenRun={setSelectedRunId}
            onCloseRun={() => setSelectedRunId(undefined)}
            onDecide={async (body) => {
              if (!selectedRunId) return;
              setRunDetail(await decideRun(selectedRunId, body));
              await refresh();
              if (selectedPlayerId)
                setPlayerDetail(await getPlayer(selectedPlayerId));
            }}
            onAccess={async (body) => {
              setPlayerDetail(await setRankedAccess(selectedPlayerId, body));
              await refresh();
            }}
            onProfile={async (body) => {
              setPlayerDetail(
                await updatePlayerProfile(selectedPlayerId, body),
              );
              await refresh();
            }}
          />
        ) : (
          <WorkspaceEmpty />
        )}
      </section>
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button class={active ? "active" : ""} onClick={onClick}>
      <span>{icon}</span>
      {label}
      {count !== undefined ? <b>{count}</b> : null}
    </button>
  );
}

function PlayerDirectory({
  players,
  selectedPlayerId,
  onSelect,
}: {
  players: PlayerSummary[];
  selectedPlayerId?: string;
  onSelect: (playerId: string) => void;
}) {
  if (!players.length)
    return (
      <Empty
        icon="⌕"
        title="No players found"
        text="Try another search or cohort."
      />
    );
  return (
    <div class="cr-player-list">
      {players.map((player) => (
        <button
          key={player.playerId}
          class={selectedPlayerId === player.playerId ? "selected" : ""}
          onClick={() => onSelect(player.playerId)}
        >
          <Avatar cardId={player.favoriteCardId} small />
          <span class="cr-player-list__identity">
            <strong>{player.publicName ?? "Unnamed player"}</strong>
            <small>{player.email ?? player.playerReference}</small>
          </span>
          <span class="cr-player-list__tags">
            <code>{player.playerReference}</code>
            {player.playerTag && <code>{player.playerTag}</code>}
          </span>
          <span class="cr-player-list__meta">
            <b>{player.runCount}</b> runs · <b>{player.earnedBadges}</b> badges
          </span>
          <span class="cr-player-list__state">
            {player.pendingRuns > 0 && <em>🔎 {player.pendingRuns}</em>}
            {player.rankedAccess === "restricted" && <em>🚫</em>}
            <small>{formatDate(player.lastSeen)}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function PlayerWorkspace({
  detail,
  summary,
  selectedRunId,
  runDetail,
  runError,
  onOpenRun,
  onCloseRun,
  onDecide,
  onAccess,
  onProfile,
}: {
  detail: PlayerDetail | null;
  summary?: PlayerSummary;
  selectedRunId?: string;
  runDetail: RunDetail | null;
  runError: string;
  onOpenRun: (runId: string) => void;
  onCloseRun: () => void;
  onDecide: (body: {
    action: string;
    reason: string;
    playerReason?: string;
    visibility?: string;
  }) => Promise<void>;
  onAccess: (body: {
    status: "allowed" | "restricted";
    reason: string;
  }) => Promise<void>;
  onProfile: (body: {
    publicName?: string;
    favoriteCardId?: number;
    playerTag?: string;
    reason: string;
  }) => Promise<void>;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("runs");
  const name = scalar(
    detail?.account.publicName ??
      detail?.player.publicName ??
      summary?.publicName,
    "Player",
  );
  const reference =
    detail?.playerReference ?? summary?.playerReference ?? "#P…";
  const cardId = Number(
    detail?.account.favoriteCardId ??
      detail?.player.favoriteCardId ??
      summary?.favoriteCardId,
  );
  if (selectedRunId)
    return (
      <RunInspector
        detail={runDetail}
        error={runError}
        onBack={onCloseRun}
        onDecide={onDecide}
      />
    );
  return (
    <div class="cr-workspace__inner">
      <header class="cr-player-hero">
        <Avatar cardId={cardId} />
        <div>
          <span class="cr-eyebrow">Player workspace</span>
          <h2>{name}</h2>
          <div class="cr-player-hero__tags">
            <CopyTag>{reference}</CopyTag>
            {detail?.account.playerTag && (
              <CopyTag>{detail.account.playerTag}</CopyTag>
            )}
          </div>
        </div>
        <span
          class={`cr-access-chip ${
            (detail?.rankedAccess.status ?? summary?.rankedAccess) ===
            "restricted"
              ? "danger"
              : ""
          }`}
        >
          {(detail?.rankedAccess.status ?? summary?.rankedAccess) ===
          "restricted"
            ? "🚫 Restricted"
            : "✅ Ranked"}
        </span>
      </header>
      <nav class="cr-tabs" aria-label="Player workspace sections">
        <TabButton active={tab === "runs"} onClick={() => setTab("runs")}>
          Runs <b>{detail?.totalRuns ?? summary?.runCount ?? 0}</b>
        </TabButton>
        <TabButton active={tab === "profile"} onClick={() => setTab("profile")}>
          Profile
        </TabButton>
        <TabButton active={tab === "badges"} onClick={() => setTab("badges")}>
          Badges <b>{summary?.earnedBadges ?? 0}</b>
        </TabButton>
      </nav>
      {!detail ? (
        <Loading />
      ) : tab === "runs" ? (
        <RunsPanel detail={detail} onOpenRun={onOpenRun} />
      ) : tab === "profile" ? (
        <ProfilePanel
          detail={detail}
          onAccess={onAccess}
          onProfile={onProfile}
        />
      ) : (
        <BadgesPanel detail={detail} />
      )}
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ComponentChildren;
  onClick: () => void;
}) {
  return (
    <button class={active ? "active" : ""} onClick={onClick}>
      {children}
    </button>
  );
}

function RunsPanel({
  detail,
  onOpenRun,
}: {
  detail: PlayerDetail;
  onOpenRun: (runId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  const [review, setReview] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [maxSeconds, setMaxSeconds] = useState("");
  const [sort, setSort] = useState("newest");
  const allRuns = useMemo(
    () =>
      Object.entries(detail.progression).flatMap(([runMode, entries]) =>
        entries.map((run) => ({ ...run, mode: runMode })),
      ),
    [detail],
  );
  const runs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const min = minimum === "" ? undefined : Number(minimum);
    const max = maximum === "" ? undefined : Number(maximum);
    const duration = maxSeconds === "" ? undefined : Number(maxSeconds) * 1000;
    const filtered = allRuns.filter((run) => {
      if (
        normalized &&
        ![run.runReference, run.runId, run.seasonId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalized))
      )
        return false;
      if (mode !== "all" && run.mode !== mode) return false;
      if (review !== "all" && runStatus(run) !== review) return false;
      const day = run.completedAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      const comparableScore =
        run.mode === "surge" || run.mode === "trade"
          ? run.score / 1000
          : run.score;
      if (min !== undefined && comparableScore < min) return false;
      if (max !== undefined && comparableScore > max) return false;
      const elapsed =
        run.timeMs ??
        (run.mode === "surge" || run.mode === "trade" ? run.score : undefined);
      if (
        duration !== undefined &&
        (elapsed === undefined || elapsed > duration)
      )
        return false;
      return true;
    });
    return filtered.sort((left, right) => {
      if (sort === "oldest")
        return left.completedAt.localeCompare(right.completedAt);
      if (sort === "best") return left.score - right.score;
      if (sort === "worst") return right.score - left.score;
      return right.completedAt.localeCompare(left.completedAt);
    });
  }, [
    allRuns,
    query,
    mode,
    review,
    from,
    to,
    minimum,
    maximum,
    maxSeconds,
    sort,
  ]);

  const clear = () => {
    setQuery("");
    setMode("all");
    setReview("all");
    setFrom("");
    setTo("");
    setMinimum("");
    setMaximum("");
    setMaxSeconds("");
    setSort("newest");
  };

  return (
    <section class="cr-runs">
      <div class="cr-filter-card">
        <div class="cr-filter-card__top">
          <label class="cr-search cr-search--runs">
            <span>⌕</span>
            <input
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Run tag, UUID, or season"
            />
          </label>
          <button class="cr-link-button" onClick={clear}>
            Clear filters
          </button>
        </div>
        <div class="cr-filters">
          <Filter label="Mode">
            <select
              value={mode}
              onChange={(event) => setMode(event.currentTarget.value)}
            >
              <option value="all">All modes</option>
              {Object.entries(MODE_NAMES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Review">
            <select
              value={review}
              onChange={(event) => setReview(event.currentTarget.value)}
            >
              <option value="all">Any status</option>
              <option value="pending">🔎 Pending</option>
              <option value="reviewed">✅ Reviewed</option>
              <option value="excluded">🚫 Excluded</option>
              <option value="unreviewed">Unreviewed</option>
            </select>
          </Filter>
          <Filter label="From">
            <input
              type="date"
              value={from}
              onInput={(event) => setFrom(event.currentTarget.value)}
            />
          </Filter>
          <Filter label="Through">
            <input
              type="date"
              value={to}
              onInput={(event) => setTo(event.currentTarget.value)}
            />
          </Filter>
          <Filter label="Min result">
            <input
              type="number"
              min="0"
              step="any"
              value={minimum}
              onInput={(event) => setMinimum(event.currentTarget.value)}
              placeholder="Any"
            />
          </Filter>
          <Filter label="Max result">
            <input
              type="number"
              min="0"
              step="any"
              value={maximum}
              onInput={(event) => setMaximum(event.currentTarget.value)}
              placeholder="Any"
            />
          </Filter>
          <Filter label="Max time (s)">
            <input
              type="number"
              min="0"
              step="0.001"
              value={maxSeconds}
              onInput={(event) => setMaxSeconds(event.currentTarget.value)}
              placeholder="Any"
            />
          </Filter>
          <Filter label="Sort">
            <select
              value={sort}
              onChange={(event) => setSort(event.currentTarget.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="best">Lowest result</option>
              <option value="worst">Highest result</option>
            </select>
          </Filter>
        </div>
      </div>
      <div class="cr-result-count">
        <strong>{runs.length}</strong> of {allRuns.length} runs
        {allRuns.length >= 2_000 && <span> · history capped at 2,000</span>}
      </div>
      <div class="cr-run-table">
        <div class="cr-run-table__head">
          <span>Run</span>
          <span>Status</span>
          <span>Completed</span>
          <span>Result</span>
        </div>
        {runs.length ? (
          runs.map((run) => (
            <button key={run.runId} onClick={() => onOpenRun(run.runId)}>
              <span class="cr-run-table__run">
                <img src={modeIcon(run.mode)} alt="" />
                <span>
                  <strong>{modeName(run.mode)}</strong>
                  <code>{run.runReference}</code>
                </span>
              </span>
              <span class={`cr-run-status ${runStatus(run)}`}>
                {statusLabel(runStatus(run))}
              </span>
              <span>{formatDate(run.completedAt)}</span>
              <b>{formatScore(run.mode, run.score)}</b>
            </button>
          ))
        ) : (
          <Empty
            icon="⌕"
            title="No matching runs"
            text="Relax one or more filters."
          />
        )}
      </div>
    </section>
  );
}

function Filter({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <label class="cr-filter">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ProfilePanel({
  detail,
  onAccess,
  onProfile,
}: {
  detail: PlayerDetail;
  onAccess: (body: {
    status: "allowed" | "restricted";
    reason: string;
  }) => Promise<void>;
  onProfile: (body: {
    publicName?: string;
    favoriteCardId?: number;
    playerTag?: string;
    reason: string;
  }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const account = detail.account;
  const clash = detail.clashRoyale;
  return (
    <div class="cr-profile">
      <section class="cr-profile-card">
        <header>
          <div>
            <span class="cr-eyebrow">Drop account</span>
            <h3>Identity & access</h3>
          </div>
          <button
            class="cr-button cr-button--ghost"
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Cancel" : "Edit profile"}
          </button>
        </header>
        <dl class="cr-detail-grid">
          <Detail label="Email" value={account.email} copy />
          <Detail label="Player tag" value={detail.playerReference} copy />
          <Detail label="Player UUID" value={detail.playerId} copy />
          <Detail
            label="Last login"
            value={formatDate(account.lastLoginAt, true)}
          />
          <Detail label="Created" value={formatDate(account.createdAt, true)} />
          <Detail
            label="Profile updated"
            value={formatDate(account.updatedAt, true)}
          />
          <Detail label="Recorded games" value={account.totalGames} />
          <Detail label="XP" value={account.xp} />
        </dl>
        <p class="cr-help">
          Email is the authentication key and is intentionally read-only.
          Changing it safely requires an account migration, not a profile edit.
        </p>
        {editing && (
          <EditProfileForm
            detail={detail}
            onSave={onProfile}
            onDone={() => setEditing(false)}
          />
        )}
      </section>

      <section class="cr-profile-card">
        <header>
          <div>
            <span class="cr-eyebrow">Clash Royale</span>
            <h3>{clash?.name ?? "No linked snapshot"}</h3>
          </div>
          {clash?.status && (
            <span class="cr-snapshot-state">{clash.status}</span>
          )}
        </header>
        <dl class="cr-detail-grid">
          <Detail
            label="Clash tag"
            value={clash?.tag ?? account.playerTag}
            copy
          />
          <Detail label="Clan" value={clash?.clan?.name} />
          <Detail label="Clan tag" value={clash?.clan?.tag} copy />
          <Detail label="Clan role" value={clash?.clan?.role} />
          <Detail
            label="Account age"
            value={
              clash?.accountAge?.days !== undefined
                ? `${clash.accountAge.days.toLocaleString()} days (${clash.accountAge.years ?? "?"} years)`
                : undefined
            }
          />
          <Detail label="Cards seen" value={clash?.cardCount} />
          <Detail
            label="Snapshot fetched"
            value={formatDate(clash?.fetchedAt, true)}
          />
          <Detail
            label="Snapshot updated"
            value={formatDate(clash?.updatedAt, true)}
          />
        </dl>
      </section>

      <RankedAccess detail={detail} onAccess={onAccess} />

      <section class="cr-profile-card">
        <header>
          <div>
            <span class="cr-eyebrow">Immutable history</span>
            <h3>Profile changes</h3>
          </div>
          <span class="cr-snapshot-state">{detail.changes.length}</span>
        </header>
        {detail.changes.length ? (
          <div class="cr-change-list">
            {detail.changes.map((change, index) => (
              <article key={`${change.changedAt}-${index}`}>
                <div>
                  <strong>{change.changedFields?.join(", ")}</strong>
                  <span>{formatDate(change.changedAt, true)}</span>
                </div>
                <p>{change.reason}</p>
                <code>
                  {JSON.stringify(change.before)} →{" "}
                  {JSON.stringify(change.after)}
                </code>
              </article>
            ))}
          </div>
        ) : (
          <p class="cr-help">
            No Control Room profile corrections have been made.
          </p>
        )}
      </section>
    </div>
  );
}

function Detail({
  label,
  value,
  copy = false,
}: {
  label: string;
  value: unknown;
  copy?: boolean;
}) {
  const text = scalar(value);
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {text}
        {copy && text !== "—" && (
          <button title={`Copy ${label}`} onClick={() => copyText(text)}>
            Copy
          </button>
        )}
      </dd>
    </div>
  );
}

function EditProfileForm({
  detail,
  onSave,
  onDone,
}: {
  detail: PlayerDetail;
  onSave: (body: {
    publicName?: string;
    favoriteCardId?: number;
    playerTag?: string;
    reason: string;
  }) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(detail.account.publicName ?? "");
  const [cardId, setCardId] = useState(
    String(detail.account.favoriteCardId ?? ""),
  );
  const [playerTag, setPlayerTag] = useState(detail.account.playerTag ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      class="cr-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        const body = {
          ...(name && cardId
            ? { publicName: name, favoriteCardId: Number(cardId) }
            : {}),
          playerTag,
          reason,
        };
        void onSave(body)
          .then(() => {
            setMessage("Profile correction saved and audited.");
            onDone();
          })
          .catch((error) =>
            setMessage(
              error instanceof Error ? error.message : "Profile update failed.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <div class="cr-edit-form__row">
        <label>
          Public name
          <input
            value={name}
            minLength={2}
            maxLength={64}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label>
          Favorite card
          <select
            value={cardId}
            onChange={(event) => setCardId(event.currentTarget.value)}
          >
            <option value="">No card selected</option>
            {CARDS.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Clash player tag
          <input
            value={playerTag}
            maxLength={16}
            onInput={(event) => setPlayerTag(event.currentTarget.value)}
            placeholder="#PLAYER"
          />
        </label>
      </div>
      <label>
        Audit reason
        <textarea
          required
          minLength={8}
          maxLength={1000}
          value={reason}
          onInput={(event) => setReason(event.currentTarget.value)}
          placeholder="Why this correction is needed"
        />
      </label>
      <button class="cr-button" disabled={busy || reason.trim().length < 8}>
        {busy ? "Saving…" : "Save audited correction"}
      </button>
      {message && <p class="cr-form-message">{message}</p>}
    </form>
  );
}

function RankedAccess({
  detail,
  onAccess,
}: {
  detail: PlayerDetail;
  onAccess: (body: {
    status: "allowed" | "restricted";
    reason: string;
  }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const restricted = detail.rankedAccess.status === "restricted";
  return (
    <section class={`cr-profile-card cr-ranked ${restricted ? "danger" : ""}`}>
      <header>
        <div>
          <span class="cr-eyebrow">Fair Play access</span>
          <h3>
            {restricted
              ? "🚫 Ranked play restricted"
              : "✅ Ranked play allowed"}
          </h3>
        </div>
      </header>
      {detail.rankedAccess.reason && (
        <p class="cr-help">{detail.rankedAccess.reason}</p>
      )}
      <form
        class="cr-edit-form cr-edit-form--access"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          void onAccess({
            status: restricted ? "allowed" : "restricted",
            reason,
          })
            .then(() => {
              setReason("");
              setMessage("Ranked access updated.");
            })
            .catch((error) =>
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Access update failed.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Private rationale
          <textarea
            required
            minLength={12}
            maxLength={1000}
            value={reason}
            onInput={(event) => setReason(event.currentTarget.value)}
            placeholder="Why ranked access should change"
          />
        </label>
        <button
          class={`cr-button ${restricted ? "" : "cr-button--danger"}`}
          disabled={busy || reason.trim().length < 12}
        >
          {restricted ? "Restore ranked access" : "Restrict ranked access"}
        </button>
        {message && <p class="cr-form-message">{message}</p>}
      </form>
    </section>
  );
}

function BadgesPanel({ detail }: { detail: PlayerDetail }) {
  return (
    <section class="cr-badge-grid">
      {BADGE_LIST.map((badge) => {
        const stamps = detail.badges.earned?.[badge.slug] ?? [];
        const value = detail.badges.values?.[badge.slug];
        return (
          <article class={stamps.length ? "earned" : ""} key={badge.slug}>
            <span>{stamps.length ? "✅" : "◇"}</span>
            <div>
              <h3>{badge.name}</h3>
              <p>{badge.requirement ?? "Hidden achievement"}</p>
            </div>
            <strong>
              {stamps.length}/{badge.rungs.length} rungs
            </strong>
            <small>Counter: {value ?? 0}</small>
          </article>
        );
      })}
    </section>
  );
}

function RunInspector({
  detail,
  error,
  onBack,
  onDecide,
}: {
  detail: RunDetail | null;
  error: string;
  onBack: () => void;
  onDecide: (body: {
    action: string;
    reason: string;
    playerReason?: string;
    visibility?: string;
  }) => Promise<void>;
}) {
  const [action, setAction] = useState("clear");
  const [playerReason, setPlayerReason] = useState("combined_evidence");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (error)
    return (
      <div class="cr-run-detail">
        <button class="cr-back" onClick={onBack}>
          ← Back to runs
        </button>
        <Empty
          icon="⌛"
          title="Evidence unavailable"
          text={`${error} Canonical run history remains visible, but detailed referee evidence may have expired.`}
        />
      </div>
    );
  if (!detail) return <Loading />;
  const run = detail.run;
  const mode = String(run.mode ?? "");
  const decision = detail.decision;
  const timing = (run.timing ?? {}) as Record<string, unknown>;
  const transcript = (run.transcript ?? {}) as {
    answers?: Array<{ atMs?: number }>;
  };
  const answers = Array.isArray(transcript.answers) ? transcript.answers : [];
  const answerGaps = answers.map((answer, index) => {
    const current = Number(answer.atMs ?? 0);
    const previous = index > 0 ? Number(answers[index - 1]?.atMs ?? 0) : 0;
    return Math.max(0, current - previous);
  });
  const largestGap = Math.max(...answerGaps, 1);
  const correlation = (run.correlation ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const browserFamily = scalar(
    correlation.start?.uaFamily ?? correlation.complete?.uaFamily,
    "unknown",
  );
  const inputKinds = timing.inputKindCounts as
    Record<string, number> | undefined;
  const inputSummary = inputKinds
    ? Object.entries(inputKinds)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(", ")
    : timing.model === "inferred-v1"
      ? "legacy transcript"
      : "not retained";
  const scoringVersion = (run.scoringVersion ?? {}) as Record<string, unknown>;
  const clientSubmission = {
    runToken: "[verified at submission; secret token not retained]",
    transcript: run.transcript ?? {},
  };
  const evidenceJson = JSON.stringify(run, null, 2);
  const submissionJson = JSON.stringify(clientSubmission, null, 2);
  return (
    <div class="cr-run-detail">
      <button class="cr-back" onClick={onBack}>
        ← Back to runs
      </button>
      <header class="cr-run-detail__hero">
        <img src={modeIcon(mode)} alt="" />
        <div>
          <span class="cr-eyebrow">Run evidence</span>
          <h2>{modeName(mode)}</h2>
          <CopyTag>{detail.runReference}</CopyTag>
        </div>
        <strong>{formatScore(mode, Number(run.score))}</strong>
      </header>
      <div class="cr-evidence-grid">
        <Detail
          label="Completed"
          value={formatDate(String(run.completedAt), true)}
        />
        <Detail label="Integrity" value={run.integrityOutcome} />
        <Detail label="Browser" value={browserFamily} />
        <Detail label="Input" value={inputSummary} />
        <Detail
          label="Timing model"
          value={timing.model ?? "pre-timing evidence"}
        />
        <Detail
          label="Wall time"
          value={
            run.wallElapsedMs
              ? `${Number(run.wallElapsedMs).toLocaleString()} ms`
              : undefined
          }
        />
        <Detail label="Web version" value={scoringVersion.web} copy />
        <Detail label="Rules version" value={scoringVersion.rules} />
      </div>
      {answerGaps.length > 0 && (
        <section class="cr-cadence">
          <div>
            <h3>Response cadence</h3>
            <span>{answerGaps.length} submitted answers</span>
          </div>
          <div class="cr-cadence__chart">
            {answerGaps.map((gap, index) => (
              <i
                key={`${index}-${Math.round(gap)}`}
                class={gap < 150 ? "fast" : gap < 300 ? "quick" : ""}
                style={{
                  height: `${Math.max(8, Math.round((gap / largestGap) * 78))}px`,
                }}
                title={`Answer ${index + 1}: ${Math.round(gap)} ms`}
              />
            ))}
          </div>
        </section>
      )}
      {decision && (
        <div class="cr-current-decision">
          <strong>Current overlay</strong>
          <span>
            {decision.queueState === "pending"
              ? "🔎 Pending"
              : decision.visibility === "hidden"
                ? "🚫 Excluded"
                : "✅ Reviewed"}
          </span>
          <p>{scalar(decision.reason, "")}</p>
        </div>
      )}
      <section class="cr-json-section">
        <header>
          <div>
            <span class="cr-eyebrow">Deep inspection</span>
            <h3>Submitted data</h3>
          </div>
          <span>Sanitized · retained</span>
        </header>
        <details open>
          <summary>
            Client submission JSON
            <small>
              Exact transcript; verified run token is intentionally not retained
            </small>
          </summary>
          <button class="cr-copy-json" onClick={() => copyText(submissionJson)}>
            Copy JSON
          </button>
          <pre>{submissionJson}</pre>
        </details>
        <details>
          <summary>
            Full evidence envelope
            <small>
              Challenge, timing analysis, correlation hashes, and versions
            </small>
          </summary>
          <button class="cr-copy-json" onClick={() => copyText(evidenceJson)}>
            Copy JSON
          </button>
          <pre>{evidenceJson}</pre>
        </details>
        <p class="cr-help">
          Authorization, raw IP, and raw user-agent are never retained. The
          opaque hashes and coarse browser family above are the full correlation
          surface.
        </p>
      </section>
      <form
        class="cr-action"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          void onDecide({
            action,
            reason,
            playerReason: action === "exclude" ? playerReason : undefined,
            visibility: run.runType === "unscored" ? "not_ranked" : undefined,
          })
            .then(() => {
              setMessage("Decision recorded.");
              setReason("");
            })
            .catch((err) =>
              setMessage(
                err instanceof Error ? err.message : "Decision failed.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <div class="cr-action__row">
          <label>
            Decision
            <select
              value={action}
              onChange={(event) => setAction(event.currentTarget.value)}
            >
              <option value="clear">✅ Clear and rank</option>
              <option value="watch">✅ Clear, watch player</option>
              <option value="exclude">🚫 Exclude</option>
              <option value="insufficient">🔎 Insufficient evidence</option>
              <option value="reopen">🔎 Reopen review</option>
            </select>
          </label>
          {action === "exclude" && (
            <label>
              Player-visible category
              <select
                value={playerReason}
                onChange={(event) => setPlayerReason(event.currentTarget.value)}
              >
                <option value="automated_input">Automated input</option>
                <option value="response_timing">
                  Impossible response timing
                </option>
                <option value="altered_play_record">Altered play record</option>
                <option value="ranked_rules">Ranked rules violation</option>
                <option value="combined_evidence">Combined evidence</option>
              </select>
            </label>
          )}
        </div>
        <label>
          Private rationale
          <textarea
            required
            minLength={8}
            maxLength={1000}
            value={reason}
            onInput={(event) => setReason(event.currentTarget.value)}
            placeholder="Evidence-based reason for the audit log"
          />
        </label>
        <button class="cr-button" disabled={busy || reason.trim().length < 8}>
          {busy ? "Recording…" : "Record decision"}
        </button>
        {message && <p class="cr-form-message">{message}</p>}
      </form>
    </div>
  );
}

function Loading() {
  return (
    <div class="cr-loading">
      <span />
      Loading player data…
    </div>
  );
}

function WorkspaceEmpty() {
  return (
    <div class="cr-workspace-empty">
      <img src="/assets/empty/empty-runs-256.png" alt="" />
      <h2>Choose a player</h2>
      <p>Runs, account details, badges, and audited controls open here.</p>
    </div>
  );
}

function Empty({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div class="cr-empty">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

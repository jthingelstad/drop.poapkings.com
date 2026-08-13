import { BADGE_LIST } from "@elixir-drop/contracts";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  decideRun,
  getOverview,
  getPlayer,
  getRun,
  setRankedAccess,
} from "./api";
import type {
  Overview,
  PlayerDetail,
  PlayerSummary,
  ReviewQueueItem,
  RunDetail,
} from "./types";

type View = "queue" | "players" | "activity";
type Selection = { kind: "run"; id: string } | { kind: "player"; id: string };

const MODE_NAMES: Record<string, string> = {
  surge: "Surge",
  trade: "Trade",
  survival: "Survival",
  rain: "Rain",
  "higher-lower": "Higher / Lower",
  practice: "Practice",
};

function modeName(mode?: string): string {
  return mode ? (MODE_NAMES[mode] ?? mode) : "Unknown mode";
}

function modeIcon(mode?: string): string {
  return `/assets/modes/${mode && MODE_NAMES[mode] ? mode : "practice"}-192.png`;
}

function formatDate(value?: string): string {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatScore(mode?: string, score?: number): string {
  if (score === undefined) return "Unscored";
  if (mode === "surge" || mode === "trade")
    return `${(score / 1000).toFixed(3)}s`;
  return score.toLocaleString();
}

function scalar(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
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

function CopyTag({
  children,
  interactive = true,
}: {
  children: string;
  interactive?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!interactive) return <code class="cr-tag">{children}</code>;
  return (
    <button
      class="cr-tag"
      title="Copy tag"
      onClick={() => {
        void navigator.clipboard?.writeText(children);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied!" : children}
    </button>
  );
}

export default function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [view, setView] = useState<View>("queue");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playerDetail, setPlayerDetail] = useState<PlayerDetail | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Connecting to the referee…");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      setError("");
      const next = await getOverview();
      setOverview(next);
      setStatus(
        `Live · refreshed ${new Date(next.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
      );
      if (next.reviewQueue[0])
        setSelection(
          (current) =>
            current ?? { kind: "run", id: next.reviewQueue[0]!.runId },
        );
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
    setRunDetail(null);
    if (!selection) return;
    const load =
      selection.kind === "player"
        ? getPlayer(selection.id)
        : getRun(selection.id);
    void load
      .then((detail) => {
        if (selection.kind === "player")
          setPlayerDetail(detail as PlayerDetail);
        else setRunDetail(detail as RunDetail);
      })
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Detail could not load.",
        ),
      );
  }, [selection]);

  const players = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!overview || !query) return overview?.players ?? [];
    return overview.players.filter((player) =>
      [
        player.publicName,
        player.playerReference,
        player.playerTag,
        player.playerId,
      ].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [overview, search]);

  const queue = overview?.reviewQueue ?? [];
  const activity = overview?.recentRuns ?? [];

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
        <nav aria-label="Control Room">
          <NavButton
            active={view === "queue"}
            icon="🔎"
            label="Referee Queue"
            count={overview?.totals.pending}
            onClick={() => setView("queue")}
          />
          <NavButton
            active={view === "players"}
            icon="♟"
            label="Players"
            onClick={() => setView("players")}
          />
          <NavButton
            active={view === "activity"}
            icon="⚡"
            label="Live Runs"
            onClick={() => setView("activity")}
          />
        </nav>
        <div class="cr-sidebar__stats">
          <span>
            <b>{overview?.totals.players ?? "—"}</b> players
          </span>
          <span>
            <b>{overview?.totals.runs ?? "—"}</b> recorded runs
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

      <main class="cr-main">
        <header class="cr-topbar">
          <div>
            <span class="cr-eyebrow">Fair Play operations</span>
            <h1>
              {view === "queue"
                ? "Referee Queue"
                : view === "players"
                  ? "Players"
                  : "Live Runs"}
            </h1>
          </div>
          <div class="cr-topbar__actions">
            <span class="cr-status">{status}</span>
            <button
              class="cr-button cr-button--ghost"
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div class="cr-error" role="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}

        {view === "queue" && (
          <Queue items={queue} selection={selection} onSelect={setSelection} />
        )}
        {view === "players" && (
          <Players
            players={players}
            search={search}
            onSearch={setSearch}
            selection={selection}
            onSelect={setSelection}
          />
        )}
        {view === "activity" && (
          <Activity
            items={activity}
            selection={selection}
            onSelect={setSelection}
          />
        )}
      </main>

      <aside class="cr-inspector" aria-label="Inspector">
        {selection?.kind === "run" ? (
          <RunInspector
            detail={runDetail}
            fallback={[...queue, ...activity].find(
              (run) => run.runId === selection.id,
            )}
            onOpenPlayer={(id) => {
              setView("players");
              setSelection({ kind: "player", id });
            }}
            onDecide={async (body) => {
              setRunDetail(await decideRun(selection.id, body));
              await refresh();
            }}
          />
        ) : selection?.kind === "player" ? (
          <PlayerInspector
            detail={playerDetail}
            summary={overview?.players.find(
              (player) => player.playerId === selection.id,
            )}
            onOpenRun={(id) => setSelection({ kind: "run", id })}
            onAccess={async (body) => {
              setPlayerDetail(await setRankedAccess(selection.id, body));
              await refresh();
            }}
          />
        ) : (
          <InspectorEmpty />
        )}
      </aside>
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
      {count ? <b>{count}</b> : null}
    </button>
  );
}

function Queue({
  items,
  selection,
  onSelect,
}: {
  items: ReviewQueueItem[];
  selection: Selection | null;
  onSelect: (value: Selection) => void;
}) {
  return (
    <section class="cr-content">
      <div class="cr-summary-card">
        <div>
          <span>Awaiting review</span>
          <strong>{items.length}</strong>
        </div>
        <p>
          Held scores stay out of placement until you record a referee decision.
        </p>
      </div>
      <div class="cr-list-head">
        <span>Oldest first</span>
        <span>Player</span>
        <span>Result</span>
        <span>Waiting</span>
      </div>
      <div class="cr-list">
        {items.length ? (
          items.map((item) => (
            <button
              key={item.runId}
              class={
                selection?.kind === "run" && selection.id === item.runId
                  ? "selected"
                  : ""
              }
              onClick={() => onSelect({ kind: "run", id: item.runId })}
            >
              <img class="cr-mode" src={modeIcon(item.mode)} alt="" />
              <span class="cr-list__primary">
                <strong>{modeName(item.mode)}</strong>
                <CopyTag interactive={false}>{item.runReference}</CopyTag>
              </span>
              <span class="cr-list__player">
                <strong>{item.publicName ?? "Unknown player"}</strong>
                <small>
                  {item.playerReference ??
                    item.playerId ??
                    "Profile unavailable"}
                </small>
              </span>
              <span class="cr-list__result">
                <strong>{formatScore(item.mode, item.score)}</strong>
                <small>{formatDate(item.completedAt)}</small>
              </span>
              <span class="cr-wait">🔎 Pending</span>
            </button>
          ))
        ) : (
          <Empty
            icon="✅"
            title="Queue clear"
            text="No held runs are waiting for referee review."
          />
        )}
      </div>
    </section>
  );
}

function Players({
  players,
  search,
  onSearch,
  selection,
  onSelect,
}: {
  players: PlayerSummary[];
  search: string;
  onSearch: (value: string) => void;
  selection: Selection | null;
  onSelect: (value: Selection) => void;
}) {
  return (
    <section class="cr-content">
      <label class="cr-search">
        <span>⌕</span>
        <input
          value={search}
          onInput={(event) => onSearch(event.currentTarget.value)}
          placeholder="Search name, #P tag, Clash tag, or UUID"
        />
      </label>
      <div class="cr-player-grid">
        {players.map((player) => (
          <button
            key={player.playerId}
            class={
              selection?.kind === "player" && selection.id === player.playerId
                ? "selected"
                : ""
            }
            onClick={() => onSelect({ kind: "player", id: player.playerId })}
          >
            <Avatar cardId={player.favoriteCardId} />
            <span class="cr-player-card__name">
              <strong>{player.publicName ?? "Unnamed player"}</strong>
              <CopyTag interactive={false}>{player.playerReference}</CopyTag>
            </span>
            <span
              class={`cr-pill ${player.rankedAccess === "restricted" ? "cr-pill--danger" : ""}`}
            >
              {player.rankedAccess}
            </span>
            <span class="cr-player-card__stats">
              <b>{player.runCount}</b> runs · <b>{player.earnedBadges}</b>{" "}
              badges · <b>{player.pendingRuns}</b> pending
            </span>
            <small>Last seen {formatDate(player.lastSeen)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function Activity({
  items,
  selection,
  onSelect,
}: {
  items: ReviewQueueItem[];
  selection: Selection | null;
  onSelect: (value: Selection) => void;
}) {
  return (
    <section class="cr-content">
      <div class="cr-list cr-list--activity">
        {items.map((item) => (
          <button
            key={item.runId}
            class={
              selection?.kind === "run" && selection.id === item.runId
                ? "selected"
                : ""
            }
            onClick={() => onSelect({ kind: "run", id: item.runId })}
          >
            <img class="cr-mode" src={modeIcon(item.mode)} alt="" />
            <span class="cr-list__primary">
              <strong>{modeName(item.mode)}</strong>
              <CopyTag interactive={false}>{item.runReference}</CopyTag>
            </span>
            <span class="cr-list__player">
              <strong>{item.publicName ?? "Unknown player"}</strong>
              <small>{item.playerReference}</small>
            </span>
            <span class="cr-list__result">
              <strong>{formatScore(item.mode, item.score)}</strong>
              <small>{formatDate(item.completedAt)}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RunInspector({
  detail,
  fallback,
  onOpenPlayer,
  onDecide,
}: {
  detail: RunDetail | null;
  fallback?: ReviewQueueItem;
  onOpenPlayer: (id: string) => void;
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
  const run = detail?.run;
  const mode = String(run?.mode ?? fallback?.mode ?? "");
  const decision = detail?.decision;
  const reference = detail?.runReference ?? fallback?.runReference ?? "Run";
  const playerId = String(run?.playerId ?? fallback?.playerId ?? "");
  const timing = (run?.timing ?? {}) as Record<string, unknown>;
  const transcript = (run?.transcript ?? {}) as {
    answers?: Array<{ atMs?: number }>;
  };
  const answers = Array.isArray(transcript.answers) ? transcript.answers : [];
  const answerGaps = answers.map((answer, index) => {
    const current = Number(answer.atMs ?? 0);
    const previous = index > 0 ? Number(answers[index - 1]?.atMs ?? 0) : 0;
    return Math.max(0, current - previous);
  });
  const largestGap = Math.max(...answerGaps, 1);
  const correlation = (run?.correlation ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const browserFamily = scalar(
    correlation.start?.uaFamily ?? correlation.complete?.uaFamily ?? "unknown",
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
  return (
    <div class="cr-inspector__inner">
      <span class="cr-eyebrow">Run inspector</span>
      <div class="cr-inspector__hero">
        <img src={modeIcon(mode)} alt="" />
        <div>
          <h2>{modeName(mode)}</h2>
          <CopyTag>{reference}</CopyTag>
        </div>
      </div>
      <div class="cr-score">
        <span>Recorded result</span>
        <strong>
          {formatScore(mode, Number(run?.score ?? fallback?.score))}
        </strong>
        <small>
          {formatDate(String(run?.completedAt ?? fallback?.completedAt ?? ""))}
        </small>
      </div>
      {playerId && (
        <button class="cr-player-link" onClick={() => onOpenPlayer(playerId)}>
          Open player{" "}
          {String(run?.playerId ? "" : (fallback?.playerReference ?? ""))} →
        </button>
      )}
      <dl class="cr-evidence">
        <div>
          <dt>Integrity</dt>
          <dd>{scalar(run?.integrityOutcome, "not reported")}</dd>
        </div>
        <div>
          <dt>Browser</dt>
          <dd>{browserFamily}</dd>
        </div>
        <div>
          <dt>Input</dt>
          <dd>{inputSummary}</dd>
        </div>
        <div>
          <dt>Samples</dt>
          <dd>
            {typeof timing.inputCount === "number"
              ? timing.inputCount
              : answers.length || "—"}
          </dd>
        </div>
        <div>
          <dt>Timing model</dt>
          <dd>{scalar(timing.model, "pre-timing evidence")}</dd>
        </div>
        <div>
          <dt>Wall time</dt>
          <dd>
            {run?.wallElapsedMs
              ? `${Number(run.wallElapsedMs).toLocaleString()} ms`
              : "—"}
          </dd>
        </div>
      </dl>
      {answerGaps.length > 0 && (
        <section class="cr-cadence">
          <div>
            <h3>Response cadence</h3>
            <span>recorded gaps · {answerGaps.length} answers</span>
          </div>
          <div
            class="cr-cadence__chart"
            aria-label={`Recorded response gaps for ${answerGaps.length} answers`}
          >
            {answerGaps.map((gap, index) => (
              <i
                key={`${index}-${Math.round(gap)}`}
                class={gap < 150 ? "fast" : gap < 300 ? "quick" : ""}
                style={{
                  height: `${Math.max(8, Math.round((gap / largestGap) * 58))}px`,
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
            {String(
              decision.queueState === "pending"
                ? "🔎 Pending"
                : decision.visibility === "hidden"
                  ? "🚫 Excluded"
                  : "✅ Reviewed",
            )}
          </span>
          <p>{scalar(decision.reason, "")}</p>
        </div>
      )}
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
            visibility: run?.runType === "unscored" ? "not_ranked" : undefined,
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
        {message && (
          <p class="cr-form-message" role="status">
            {message}
          </p>
        )}
      </form>
    </div>
  );
}

function PlayerInspector({
  detail,
  summary,
  onOpenRun,
  onAccess,
}: {
  detail: PlayerDetail | null;
  summary?: PlayerSummary;
  onOpenRun: (id: string) => void;
  onAccess: (body: {
    status: "allowed" | "restricted";
    reason: string;
  }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const name = scalar(
    detail?.player.publicName ?? summary?.publicName ?? "Player",
    "Player",
  );
  const reference =
    detail?.playerReference ?? summary?.playerReference ?? "#P…";
  const access =
    detail?.rankedAccess.status ?? summary?.rankedAccess ?? "allowed";
  const runs = detail
    ? Object.entries(detail.progression)
        .flatMap(([mode, entries]) => entries.map((run) => ({ ...run, mode })))
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    : [];
  const earnedBadges = BADGE_LIST.flatMap((badge) => {
    const stamps = detail?.badges.earned?.[badge.slug] ?? [];
    return stamps.length ? [{ ...badge, rungCount: stamps.length }] : [];
  });
  const earned = earnedBadges.length;
  return (
    <div class="cr-inspector__inner">
      <span class="cr-eyebrow">Player record</span>
      <div class="cr-inspector__player">
        <Avatar
          cardId={Number(
            detail?.player.favoriteCardId ?? summary?.favoriteCardId,
          )}
        />
        <div>
          <h2>{name}</h2>
          <CopyTag>{reference}</CopyTag>
        </div>
      </div>
      <div class="cr-stat-grid">
        <div>
          <strong>{detail?.totalRuns ?? summary?.runCount ?? "—"}</strong>
          <span>Runs</span>
        </div>
        <div>
          <strong>{earned || summary?.earnedBadges || 0}</strong>
          <span>Badges</span>
        </div>
        <div>
          <strong>{summary?.excludedRuns ?? "—"}</strong>
          <span>Excluded</span>
        </div>
      </div>
      <div
        class={`cr-access ${access === "restricted" ? "cr-access--danger" : ""}`}
      >
        <strong>Ranked access: {access}</strong>
        {detail?.rankedAccess.reason && <p>{detail.rankedAccess.reason}</p>}
      </div>
      {earnedBadges.length > 0 && (
        <section class="cr-badges">
          <h3>Badges earned</h3>
          <div>
            {earnedBadges.map((badge) => (
              <span key={badge.slug}>
                <b>{badge.name}</b>
                <small>
                  {badge.rungCount} {badge.rungCount === 1 ? "rung" : "rungs"}
                </small>
              </span>
            ))}
          </div>
        </section>
      )}
      <section class="cr-mini-runs">
        <h3>Run history ({runs.length})</h3>
        {runs.map((run) => (
          <button key={run.runId} onClick={() => onOpenRun(run.runId)}>
            <img src={modeIcon(run.mode)} alt="" />
            <span>
              <strong>{modeName(run.mode)}</strong>
              <small>{run.runReference}</small>
            </span>
            <b>{formatScore(run.mode, run.score)}</b>
          </button>
        ))}
      </section>
      <form
        class="cr-action"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          const status = access === "restricted" ? "allowed" : "restricted";
          void onAccess({ status, reason })
            .then(() => setReason(""))
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
          class={`cr-button ${access !== "restricted" ? "cr-button--danger" : ""}`}
          disabled={busy || reason.trim().length < 12}
        >
          {access === "restricted"
            ? "Restore ranked access"
            : "Restrict ranked access"}
        </button>
      </form>
    </div>
  );
}

function InspectorEmpty() {
  return (
    <div class="cr-inspector-empty">
      <img src="/assets/empty/empty-runs-256.png" alt="" />
      <h2>Choose a record</h2>
      <p>
        Run evidence, player history, badges, and audited controls appear here.
      </p>
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

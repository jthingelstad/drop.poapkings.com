/**
 * deploy.mjs's CI gate for a deploy from a laptop (2026-09-26, the PR
 * workflow; elixir-mcp's infra/scripts/lib/ci-gate.mjs, copied because
 * the two repos share no infra package): production only runs a commit
 * that is origin/main and that GitHub's `validate` check passed. CI's own
 * deploy needs no gate; it runs only after `validate` passed on main.
 *
 * A green check on HEAD itself passes. So does a green check on the
 * head of the merged PR whose tree is HEAD's tree: main requires a
 * branch to be up to date before it merges and merges by rebase, so the
 * PR's head and main's new tip hold the same files.
 *
 * `git(args)` returns trimmed stdout; `ghApi(path)` returns parsed JSON.
 * Both are injected so the test drives every branch without a network.
 */

const CI_CHECK = "validate";

const PENDING = new Set(["queued", "in_progress", "waiting", "pending"]);

/** The newest `validate` check run on a commit: "success", "failure"
 *  (any finished run that is not a success), "pending", or null when
 *  there is none yet. */
async function checkState(ghApi, repo, sha) {
  const r = await ghApi(
    `repos/${repo}/commits/${sha}/check-runs?check_name=${CI_CHECK}&filter=latest`,
  );
  const run = (r.check_runs ?? [])[0];
  if (!run) return null;
  if (PENDING.has(run.status)) return "pending";
  return run.conclusion === "success" ? "success" : "failure";
}

/** Commits whose green check stands for HEAD: HEAD, then the heads of
 *  merged PRs that carry exactly HEAD's tree. */
async function candidates(ghApi, repo, head, tree) {
  const out = [head];
  let pulls = [];
  try {
    pulls = await ghApi(`repos/${repo}/commits/${head}/pulls`);
  } catch {
    // The association is a shortcut; HEAD's own run still decides.
  }
  for (const pr of pulls ?? []) {
    const sha = pr?.head?.sha;
    if (!pr?.merged_at || !sha || sha === head) continue;
    const commit = await ghApi(`repos/${repo}/git/commits/${sha}`);
    if (commit?.tree?.sha === tree) out.push(sha);
  }
  return out;
}

/**
 * @returns {Promise<{ ok: true, sha: string, via: string } | { ok: false, reason: string }>}
 */
export async function ciGate({
  git,
  ghApi,
  repo,
  waitMs = 15 * 60_000,
  pollMs = 15_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  log = () => {},
}) {
  git(["fetch", "--quiet", "origin", "main"]);
  const head = git(["rev-parse", "HEAD"]);
  const main = git(["rev-parse", "origin/main"]);
  if (head !== main)
    return {
      ok: false,
      reason: `HEAD ${head.slice(0, 8)} is not origin/main ${main.slice(0, 8)}. Production runs only what main holds: open a PR, let it merge, then deploy from an up-to-date main.`,
    };
  const tree = git(["rev-parse", "HEAD^{tree}"]);
  const deadline = now() + waitMs;
  let announced = false;
  for (;;) {
    const shas = await candidates(ghApi, repo, head, tree);
    const states = [];
    for (const sha of shas) {
      const state = await checkState(ghApi, repo, sha);
      if (state === "success")
        return {
          ok: true,
          sha: head,
          via: sha === head ? "main" : `PR head ${sha.slice(0, 8)}`,
        };
      states.push(state);
    }
    // A finished red run with nothing still running is a refusal; a run
    // not created yet (GitHub is seconds behind a merge) or still going
    // is waited for.
    const waiting = states.some((s) => s === "pending" || s === null);
    if (!waiting)
      return {
        ok: false,
        reason: `the ${CI_CHECK} check failed on ${head.slice(0, 8)}. Fix forward through a PR; nothing was deployed.`,
      };
    if (now() >= deadline)
      return {
        ok: false,
        reason: `the ${CI_CHECK} check on ${head.slice(0, 8)} did not finish within ${Math.round(waitMs / 60_000)} minutes; nothing was deployed.`,
      };
    if (!announced) {
      log(
        `deploy: waiting for the ${CI_CHECK} check on ${head.slice(0, 8)}...`,
      );
      announced = true;
    }
    await sleep(pollMs);
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { ciGate } from "../scripts/ci-gate.mjs";

// The CI gate (the PR workflow, 2026-09-26): a fake git and GitHub.
const HEAD = "a".repeat(40);
const PR_HEAD = "b".repeat(40);
const TREE = "t".repeat(40);
function gateWorld({
  main = HEAD,
  runs = {},
  pulls = [],
  trees = {},
  pullsThrow = false,
} = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "fetch") return "";
    if (args[1] === "HEAD") return HEAD;
    if (args[1] === "origin/main") return main;
    if (args[1] === "HEAD^{tree}") return TREE;
    throw new Error(`unexpected git ${args}`);
  };
  const ghApi = async (path) => {
    const check = path.match(/commits\/(\w+)\/check-runs/);
    if (check) {
      const seq = runs[check[1]];
      const run = Array.isArray(seq) ? seq.shift() : seq;
      return { check_runs: run ? [run] : [] };
    }
    if (/commits\/\w+\/pulls$/.test(path)) {
      if (pullsThrow) throw new Error("HTTP 502");
      return pulls;
    }
    const commit = path.match(/git\/commits\/(\w+)$/);
    if (commit) return { tree: { sha: trees[commit[1]] } };
    throw new Error(`unexpected gh ${path}`);
  };
  return { git, ghApi, calls };
}
const run = (ciGateWorld, opts = {}) =>
  ciGate({
    ...ciGateWorld,
    repo: "o/r",
    sleep: async () => {},
    pollMs: 1,
    ...opts,
  });
const green = { status: "completed", conclusion: "success" };
const red = { status: "completed", conclusion: "failure" };
const going = { status: "in_progress", conclusion: null };

void test("ci gate: HEAD must be origin/main, fetched first", async () => {
  const w = gateWorld({ main: PR_HEAD, runs: { [HEAD]: green } });
  const r = await run(w);
  assert.equal(r.ok, false);
  assert.match(r.reason, /is not origin\/main/);
  assert.equal(w.calls[0], "fetch --quiet origin main");
});

void test("ci gate: green on HEAD passes; red with nothing running refuses", async () => {
  assert.deepEqual(await run(gateWorld({ runs: { [HEAD]: green } })), {
    ok: true,
    sha: HEAD,
    via: "main",
  });
  const r = await run(gateWorld({ runs: { [HEAD]: red } }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /check failed/);
});

void test("ci gate: the merged PR's green head stands for HEAD only when the trees match", async () => {
  const pulls = [{ merged_at: "2026-09-26T20:00:00Z", head: { sha: PR_HEAD } }];
  const same = await run(
    gateWorld({
      pulls,
      trees: { [PR_HEAD]: TREE },
      runs: { [HEAD]: going, [PR_HEAD]: green },
    }),
  );
  assert.equal(same.ok, true);
  assert.match(same.via, /^PR head bbbbbbbb/);
  // A different tree (the branch was behind main) proves nothing about HEAD.
  const other = await run(
    gateWorld({
      pulls,
      trees: { [PR_HEAD]: "x".repeat(40) },
      runs: { [HEAD]: red, [PR_HEAD]: green },
    }),
  );
  assert.equal(other.ok, false);
  // An open PR is not a merge.
  const open = await run(
    gateWorld({
      pulls: [{ merged_at: null, head: { sha: PR_HEAD } }],
      trees: { [PR_HEAD]: TREE },
      runs: { [HEAD]: red, [PR_HEAD]: green },
    }),
  );
  assert.equal(open.ok, false);
  // The association lookup failing falls back to HEAD's own run.
  const fallback = await run(
    gateWorld({ pullsThrow: true, runs: { [HEAD]: green } }),
  );
  assert.equal(fallback.ok, true);
});

void test("ci gate: a run not yet created or still going is waited for, up to the deadline", async () => {
  const w = gateWorld({ runs: { [HEAD]: [undefined, going, green] } });
  const lines = [];
  const r = await run(w, { log: (l) => lines.push(l) });
  assert.equal(r.ok, true);
  assert.equal(lines.length, 1, "announced once");
  let t = 0;
  const late = await run(gateWorld({ runs: { [HEAD]: going } }), {
    waitMs: 10,
    now: () => (t += 6),
  });
  assert.equal(late.ok, false);
  assert.match(late.reason, /did not finish/);
});

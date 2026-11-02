#!/bin/sh
# Keeps the workflows hardened: every action pinned to a full commit SHA,
# no default token permissions, every job asking for its own, and no
# checkout leaving the token in .git/config. Copied from
# elixir-mcp-collector's scripts/test-workflows.sh (2026-09-26), without
# its signing-key check: this repository has no signing key.
#
#   sh scripts/test-workflows.sh

set -u
SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
WF="$(dirname "$SELF_DIR")/.github/workflows"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
no() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && echo "       $2"; }

for f in "$WF"/*.yml; do
  name="$(basename "$f")"
  unpinned="$(grep -nE '^[[:space:]]*-?[[:space:]]*uses:' "$f" | grep -vE 'uses:[[:space:]]*[^@[:space:]]+@[0-9a-f]{40}([[:space:]]|$)')"
  if [ -z "$unpinned" ]; then ok "$name: every action is pinned to a commit SHA"
  else no "$name: every action is pinned to a commit SHA" "$unpinned"; fi

  if grep -qx 'permissions: {}' "$f"; then ok "$name: no default token permissions"
  else no "$name: no default token permissions" "want a top-level 'permissions: {}'"; fi

  # Each job (two-space key under jobs:) must carry its own permissions.
  missing="$(awk '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
      if (job != "" && !seen) print job
      job = $1; seen = 0; next
    }
    in_jobs && /^    permissions:/ { seen = 1 }
    END { if (job != "" && !seen) print job }
  ' "$f")"
  if [ -z "$missing" ]; then ok "$name: every job sets its own permissions"
  else no "$name: every job sets its own permissions" "$missing"; fi

  checkouts="$(grep -c 'uses: actions/checkout@' "$f")"
  kept="$(grep -c 'persist-credentials: false' "$f")"
  if [ "$checkouts" = "$kept" ]; then ok "$name: no checkout persists the token"
  else no "$name: no checkout persists the token" "$checkouts checkouts, $kept with persist-credentials: false"; fi
  # pull_request_target runs with a write token in the base repository's
  # context; nothing here needs it, and Dependabot auto-merge uses
  # pull_request with raised job permissions instead.
  if ! grep -qE '^[[:space:]]*pull_request_target' "$f"; then ok "$name: no pull_request_target trigger"
  else no "$name: no pull_request_target trigger" "use pull_request with per-job permissions"; fi
done

# The auto-merge job holds contents and pull-requests write. It must never
# check out or run the pull request's code: only the pinned fetch-metadata
# action and gh.
AUTOMERGE="$WF/dependabot-automerge.yml"
if [ -f "$AUTOMERGE" ]; then
  if ! grep -qE 'actions/checkout|npm |npx |node |run: \./|sh scripts/' "$AUTOMERGE"; then
    ok "dependabot-automerge.yml: checks out and runs no repository code"
  else no "dependabot-automerge.yml: checks out and runs no repository code" \
    "$(grep -nE 'actions/checkout|npm |npx |node |run: \./|sh scripts/' "$AUTOMERGE")"; fi
  if grep -q "github.actor == 'dependabot\[bot\]'" "$AUTOMERGE" &&
    grep -q "github.event.pull_request.user.login == 'dependabot\[bot\]'" "$AUTOMERGE"; then
    ok "dependabot-automerge.yml: runs only for Dependabot's own pushes"
  else no "dependabot-automerge.yml: runs only for Dependabot's own pushes" \
    "want both the pull request author and the actor to be dependabot[bot]"; fi
  if ! grep -q 'semver-major' "$AUTOMERGE" &&
    grep -q "update-type == 'version-update:semver-minor'" "$AUTOMERGE"; then
    ok "dependabot-automerge.yml: arms only listed minor and patch updates"
  else no "dependabot-automerge.yml: arms only listed minor and patch updates" \
    "allow-list minor and patch; never test for major, so an unknown type stays unarmed"; fi
else
  no "dependabot-automerge.yml exists"
fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

#!/usr/bin/env bash
#
# Git preflight for AGENT-TEAM objective owners. Run from the repo root at the start
# of every run. Prints the working-tree state and a verdict; exits non-zero when
# the tree is in a state an automated run should NOT act on (dirty / behind /
# diverged). An automated agent should stop and report on a
# non-zero exit rather than pull/merge/rebase/stash.
#
set -euo pipefail

command -v git >/dev/null 2>&1 || { echo "git not found"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not inside a git checkout"; exit 2; }

if ! git fetch origin --prune >/dev/null 2>&1; then
  echo "  ✗ git fetch origin failed — remote synchronization is unknown; stop mutation."
  exit 1
fi

if ! branch="$(git symbolic-ref --quiet --short HEAD)"; then
  echo "  ✗ checkout is DETACHED — stop mutation."
  exit 1
fi
echo "==> Preflight on branch: $branch"
git status --short --branch | sed 's/^/  /'

verdict=0

if [ "$branch" != "main" ]; then
  echo "  ✗ objective runs publish only from main, not $branch — stop mutation."
  verdict=1
fi

# Dirty worktree?
if [ -n "$(git status --porcelain)" ]; then
  echo "  ✗ worktree is DIRTY — stop mutation (do not act on unexpected local changes)."
  verdict=1
fi

# Compare to upstream. An objective checkout without one is not safe to publish.
if upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  if [ "$upstream" != "origin/main" ]; then
    echo "  ✗ main must track origin/main, not $upstream — stop mutation."
    verdict=1
  fi
  ahead="$(git rev-list --count '@{u}..HEAD')"
  behind="$(git rev-list --count 'HEAD..@{u}')"
  if [ "$behind" -gt 0 ] && [ "$ahead" -gt 0 ]; then
    echo "  ✗ DIVERGED from $upstream ($ahead ahead, $behind behind) — stop and report."
    verdict=1
  elif [ "$behind" -gt 0 ]; then
    echo "  ✗ BEHIND $upstream by $behind — stop and report (do not pull from an automated run)."
    verdict=1
  elif [ "$ahead" -gt 0 ]; then
    echo "  ✗ AHEAD of $upstream by $ahead — never publish a pre-existing commit."
    verdict=1
  fi
else
  echo "  ✗ no upstream configured for $branch — stop mutation."
  verdict=1
fi

if [ "$verdict" -eq 0 ]; then
  echo "  ✓ clean and in sync — safe to work."
fi
exit "$verdict"

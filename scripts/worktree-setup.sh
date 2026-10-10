#!/usr/bin/env bash
# Prepares a session's worktree of this repository. Codex runs it from
# .codex/environments/environment.toml with the new worktree as the working
# directory; on Jamie's machine the domain's `scripts/session-start` runs it
# after `git worktree add --detach <dir>`, setting the same two variables.
#
#   CODEX_SOURCE_TREE_PATH  the main checkout
#   CODEX_WORKTREE_PATH     this worktree
#
# It moves the worktree to a freshly fetched origin/main, links in the
# machine's gitignored local files, and installs dependencies. Links, never
# copies: a copy of a secrets file is a secret. Sibling repositories are not
# its business; whoever made the worktree places them.
set -euo pipefail

: "${CODEX_SOURCE_TREE_PATH:?worktree-setup: CODEX_SOURCE_TREE_PATH is unset (the main checkout)}"
: "${CODEX_WORKTREE_PATH:?worktree-setup: CODEX_WORKTREE_PATH is unset (this worktree)}"

worktree=$(git rev-parse --show-toplevel)
source_tree=$(cd "$CODEX_SOURCE_TREE_PATH" && pwd -P)
git_dir=$(git rev-parse --path-format=absolute --git-dir)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)

# Never in the main checkout: a reset there would take someone's work.
if [ "$git_dir" = "$common_dir" ] || [ "$(cd "$worktree" && pwd -P)" = "$source_tree" ]; then
  echo "worktree-setup: $worktree is the main checkout, not a linked worktree; nothing done." >&2
  exit 2
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "worktree-setup: $worktree already has changes; nothing done." >&2
  exit 2
fi

git fetch --quiet origin main
git checkout --quiet --detach origin/main

# The mode-0600 .env (Updates publish token, deploy settings) and the
# local design prototypes.
for rel in .env design-ref; do
  if [ -e "$source_tree/$rel" ] && [ ! -e "$worktree/$rel" ] && [ ! -L "$worktree/$rel" ]; then
    ln -s "$source_tree/$rel" "$worktree/$rel"
  fi
done

npm ci --no-audit --no-fund --loglevel=error
echo "worktree-setup: $worktree at origin/main $(git rev-parse --short HEAD), ready."

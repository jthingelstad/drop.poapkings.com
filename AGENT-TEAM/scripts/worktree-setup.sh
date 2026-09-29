#!/usr/bin/env bash
# Prepares one run's private worktree (WORKFLOW.md, "One worktree per
# run"). Codex runs it from .codex/environments/environment.toml with the
# new worktree as the working directory; a domain run or an interactive
# session runs it by hand after `git worktree add --detach <dir>`, setting
# the same two variables.
#
#   CODEX_SOURCE_TREE_PATH  the main checkout (~/Projects/clash-royale/drop.poapkings.com)
#   CODEX_WORKTREE_PATH     this worktree
#
# It moves the worktree to a freshly fetched origin/main (Codex starts it
# from whatever origin/main the main checkout last fetched), links in the
# machine's gitignored local files, links the sibling repositories beside
# it so ../elixir-mcp and ../elixir-bot/.env resolve as they do from the
# main checkout, and installs dependencies. Links, never copies, for
# anything secret: a copy of a secrets file is a secret.
set -euo pipefail

: "${CODEX_SOURCE_TREE_PATH:?worktree-setup: CODEX_SOURCE_TREE_PATH is unset (the main checkout)}"
: "${CODEX_WORKTREE_PATH:?worktree-setup: CODEX_WORKTREE_PATH is unset (this worktree)}"

worktree=$(git rev-parse --show-toplevel)
source_tree=$(cd "$CODEX_SOURCE_TREE_PATH" && pwd -P)
git_dir=$(git rev-parse --path-format=absolute --git-dir)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)

# Never in the shared checkout: a reset there would take someone's work.
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

# The mode-0600 .env (Updates publish token, deploy settings), the
# per-run scratch notes every run shares, and the local design prototypes.
for rel in .env AGENT-TEAM/notes design-ref; do
  if [ -e "$source_tree/$rel" ] && [ ! -e "$worktree/$rel" ] && [ ! -L "$worktree/$rel" ]; then
    mkdir -p "$(dirname "$worktree/$rel")"
    ln -s "$source_tree/$rel" "$worktree/$rel"
  fi
done

# Siblings, only into a directory that is this run's alone (Codex gives
# each worktree its own parent); never beside the main checkout.
source_parent=$(dirname "$source_tree")
worktree_parent=$(cd "$(dirname "$worktree")" && pwd -P)
if [ "$worktree_parent" != "$source_parent" ]; then
  for sibling in "$source_parent"/*; do
    name=$(basename "$sibling")
    [ "$name" = "$(basename "$worktree")" ] && continue
    [ -e "$worktree_parent/$name" ] || [ -L "$worktree_parent/$name" ] ||
      ln -s "$sibling" "$worktree_parent/$name"
  done
fi

npm ci --no-audit --no-fund --loglevel=error
echo "worktree-setup: $worktree at origin/main $(git rev-parse --short HEAD), ready."

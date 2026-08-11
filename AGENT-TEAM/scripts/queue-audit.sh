#!/usr/bin/env bash
set -euo pipefail

command -v gh >/dev/null 2>&1 || { echo "gh CLI not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated"; exit 1; }

echo "Objective queue — $(gh repo view --json nameWithOwner --jq .nameWithOwner)"
for label in objective:run objective:grow objective:fair-play; do
  echo
  echo "==> $label"
  gh issue list --state open --label "$label" --limit 100 \
    --json number,title,labels,updatedAt \
    --jq '.[] | "  #\(.number)  [\([.labels[].name] | join(","))]  \(.title)  (\(.updatedAt[0:10]))"'
done

echo
echo "==> Decisions waiting on Jamie"
gh issue list --state open --label decision --limit 100

echo
echo "==> Missing or conflicting objective ownership"
gh issue list --state open --limit 100 --json number,title,labels \
  --jq '.[] | ([.labels[].name | select(startswith("objective:"))]) as $o | select(($o|length) != 1) | "  #\(.number)  objectives=\($o|join(","))  \(.title)"'

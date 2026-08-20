#!/usr/bin/env bash
set -euo pipefail

command -v gh >/dev/null 2>&1 || { echo "gh CLI not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated"; exit 1; }
upsert() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null; }
existing="$(gh label list --limit 300 --json name --jq '.[].name')"
has() { printf '%s\n' "$existing" | grep -Fxq "$1"; }
remove() {
  if has "$1"; then
    gh label delete "$1" --yes >/dev/null
  fi
}

upsert "objective:run" "1D76DB" "Owned end-to-end by Run Drop"
upsert "objective:grow" "0E8A16" "Owned end-to-end by Grow Drop"
upsert "objective:improve" "7057FF" "Owned end-to-end by Improve Drop"
upsert "objective:season" "D4A72C" "Owned end-to-end by Call the Season"
upsert "objective:fair-play" "B60205" "Owned end-to-end by Protect Fair Play"
upsert "decision" "FBCA04" "Jamie must answer before the objective can continue"
upsert "blocked" "000000" "Waiting on an external dependency"
upsert "generated" "FEF2C0" "Filed by an automated agent"

# Work-type labels remain descriptive, never routing.
upsert "bug" "D73A4A" "Reproducible defect"
upsert "regression" "B60205" "Worked before and is now broken"
upsert "enhancement" "A2EEEF" "New or improved capability"
upsert "eval" "5319E7" "Missing measurement"
upsert "operations" "D93F0B" "Production, deploy, runtime, or reliability"
upsert "integrity" "B60205" "Competitive-integrity finding"
upsert "growth" "0E8A16" "Acquisition, retention, engagement, or participation finding"
upsert "meta" "6F42C1" "Objective definitions, automation, or tooling"

# Retired role/queue labels. Durable work now has one objective owner; the checkout
# lease serializes active mutation and `decision` is the human gate.
for label in approved needs-deploy needs-design proposal ready release wip; do
  remove "$label"
done

echo "Objective labels are current."

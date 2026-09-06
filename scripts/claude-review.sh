#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
exec "$repo_root/scripts/claude-review-common.sh" \
  "review" \
  "$repo_root/.ai/prompts/claude-review.md" \
  "${CLAUDE_REVIEW_MODEL:-sonnet}"

#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
exec "$repo_root/scripts/claude-review-common.sh" \
  "security-review" \
  "$repo_root/.ai/prompts/claude-security-review.md" \
  "${CLAUDE_SECURITY_REVIEW_MODEL:-opus}"

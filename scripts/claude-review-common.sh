#!/usr/bin/env bash

set -euo pipefail

review_kind="${1:?review kind is required}"
prompt_path="${2:?prompt path is required}"
review_model="${3:-sonnet}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo "Claude review requires a named branch." >&2
  exit 2
fi

if [[ ! -f "$prompt_path" ]]; then
  echo "Review prompt does not exist: $prompt_path" >&2
  exit 2
fi

base="${CLAUDE_REVIEW_BASE:-}"
if [[ -z "$base" ]] && git rev-parse --verify --quiet origin/main >/dev/null; then
  base="origin/main"
elif [[ -z "$base" ]] && git rev-parse --verify --quiet main >/dev/null; then
  base="main"
elif [[ -z "$base" ]]; then
  base="$(git hash-object -t tree /dev/null)"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
review_dir="$repo_root/.ai/reviews"
review_path="$review_dir/${timestamp}-${review_kind}.md"
latest_path_file="$review_dir/latest-${review_kind}.txt"
snapshot_root="$(mktemp -d "${TMPDIR:-/tmp}/marketing-task-review.XXXXXX")"
snapshot="$snapshot_root/repository"

cleanup() {
  rm -rf "$snapshot_root"
}
trap cleanup EXIT

mkdir -p "$review_dir" "$snapshot/.review"

while IFS= read -r -d '' file; do
  case "$file" in
    .env|.env.*|*.pem|*.key|*.p12|*.pfx)
      if [[ "$file" != ".env.example" ]]; then
        continue
      fi
      ;;
  esac

  if [[ -f "$file" ]]; then
    mkdir -p "$snapshot/$(dirname "$file")"
    cp "$file" "$snapshot/$file"
  fi
done < <(git ls-files -co --exclude-standard -z)

{
  echo "# Review context"
  echo
  echo "- Branch: \`$branch\`"
  echo "- Base: \`$base\`"
  echo "- HEAD: \`$(git rev-parse HEAD)\`"
  echo "- Generated: \`$timestamp\`"
  echo
  echo "## Working tree status"
  echo
  echo '```text'
  git status --short --branch
  echo '```'
} > "$snapshot/.review/CONTEXT.md"

git diff --no-ext-diff --no-color "$base" -- . \
  ':(exclude).env' \
  ':(exclude).env.*' \
  ':(exclude)*.pem' \
  ':(exclude)*.key' \
  > "$snapshot/.review/changes.diff"

set +e
(
  cd "$snapshot"
  {
    cat "$prompt_path"
    printf '%s\n' "" "The repository snapshot is sanitized and read-only for this review. Do not request additional access, do not execute code, and do not attempt to modify files."
  } | claude -p \
    --model "$review_model" \
    --effort high \
    --no-session-persistence \
    --permission-mode dontAsk \
    --allowedTools "Read,Grep,Glob" \
    --disallowedTools "Bash,Edit,Write,NotebookEdit"
) > "$review_path"
claude_status=$?
set -e

printf '%s\n' "${review_path#$repo_root/}" > "$latest_path_file"

if [[ $claude_status -ne 0 ]]; then
  echo "Claude review failed with exit code $claude_status; output: $review_path" >&2
  exit "$claude_status"
fi

echo "Claude review saved to $review_path"
if rg -q '^Verdict:[[:space:]]+(\*\*)?FAIL(\*\*)?$' "$review_path"; then
  exit 3
fi

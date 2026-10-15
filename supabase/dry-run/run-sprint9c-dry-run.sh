#!/usr/bin/env bash
# Sprint 9C LOCAL DRY-RUN — disposable PostgreSQL 17 in Docker only.
# Never point this script at Supabase: it creates and drops named databases.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$REPO/supabase/migrations"
ROLLBACKS="$REPO/supabase/rollbacks"
CURRENT="$MIGRATIONS/20261014130332_content_os_task_transition_compatibility.sql"
CURRENT_DOWN="$ROLLBACKS/20261014130332_content_os_task_transition_compatibility.down.sql"
CONTAINER="${PG_CONTAINER:-codex-sprint9c-pg17}"
CONTENT_OS_REPO="${CONTENT_OS_REPO:-$(cd "$REPO/../ibox-content-funnel" && pwd)}"
CONTENT_OS="$CONTENT_OS_REPO/supabase/content-os-drafts"

sql() {
  local database="$1"
  shift
  docker exec -i "$CONTAINER" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -q -X "$@"
}

value() {
  sql "$1" -tA -c "$2"
}

section() {
  echo
  echo "=== $*"
}

apply_file() {
  echo "  apply $(basename "$2")"
  sql "$1" --single-transaction < "$2"
}

run_file() {
  sql "$1" -f - < "$2" 2>&1 | sed -E 's/^(psql:[^ ]* )?(NOTICE|ERROR):  //'
}

fresh_pre_sprint9c() {
  local database="$1"
  docker exec "$CONTAINER" psql -U postgres -q \
    -c "drop database if exists $database with (force)" \
    -c "create database $database"
  sql "$database" < "$CONTENT_OS/dry-run/00_supabase_roles_bootstrap.sql"
  for migration in "$MIGRATIONS"/*.sql; do
    if [[ "$migration" != "$CURRENT" ]]; then
      sql "$database" --single-transaction < "$migration"
    fi
  done
}

function_hash() {
  value "$1" "select md5(replace(prosrc, '40001', 'PT409')) || '|' || array_to_string(proconfig, ',') || '|' || prosecdef from pg_proc where oid = 'public.transition_task_with_events(uuid, uuid, text, text)'::regprocedure"
}

expect_failure() {
  local label="$1"
  local database="$2"
  local statement="$3"
  local output_file="/tmp/sprint9c-dry-run-error.txt"
  if sql "$database" -c "$statement" > "$output_file" 2>&1; then
    echo "FAIL $label (statement succeeded)"
    exit 1
  fi
  echo "PASS $label ($(grep -o 'ERROR: .*' "$output_file" | head -1))"
}

expect_file_failure() {
  local label="$1"
  local database="$2"
  local file="$3"
  local output_file="/tmp/sprint9c-dry-run-file-error.txt"
  if sql "$database" --single-transaction < "$file" > "$output_file" 2>&1; then
    echo "FAIL $label (file succeeded)"
    exit 1
  fi
  echo "PASS $label ($(grep -o 'ERROR: .*' "$output_file" | head -1))"
}

section "environment"
docker exec "$CONTAINER" psql -U postgres -tAc "select version()"
echo "Task Bot: $(git -C "$REPO" branch --show-current) $(git -C "$REPO" rev-parse --short HEAD)"
echo "Content OS (read only): $(git -C "$CONTENT_OS_REPO" branch --show-current) $(git -C "$CONTENT_OS_REPO" rev-parse --short HEAD)"
CONTENT_OS_HASH_BEFORE="$(cat "$CONTENT_OS"/migrations/*.sql "$CONTENT_OS"/rollback/*.sql | sha256sum | cut -d' ' -f1)"
CONTENT_OS_STATUS_BEFORE="$(git -C "$CONTENT_OS_REPO" status --porcelain)"

section "canonical ordering and atomic Content OS lifecycle"
ORDER_DB=sprint9c_order
fresh_pre_sprint9c "$ORDER_DB"
BASE_HASH="$(function_hash "$ORDER_DB")"
apply_file "$ORDER_DB" "$CURRENT"
run_file "$ORDER_DB" "$HERE/sprint9c_legacy_transition_matrix.sql"
run_file "$ORDER_DB" "$HERE/sprint9c_content_os_transition_tests.sql"

apply_file "$ORDER_DB" "$CURRENT_DOWN"
if [[ "$(function_hash "$ORDER_DB")" != "$BASE_HASH" ]]; then
  echo "FAIL Sprint 9C rollback did not restore prior behavior/security"
  exit 1
fi
echo "PASS Sprint 9C rollback restores prior behavior/security with PT409 refusals"
run_file "$ORDER_DB" "$HERE/sprint9c_legacy_transition_matrix.sql"
apply_file "$ORDER_DB" "$CURRENT"

apply_file "$ORDER_DB" "$CONTENT_OS/rollback/content_os_99_down.sql"
run_file "$ORDER_DB" "$HERE/sprint9c_legacy_transition_matrix.sql"
echo "PASS legacy behavior survives Content OS rollback while Sprint 9C remains installed"

section "Content OS contract from canonical manifest"
CONTRACT_DB=sprint9c_contract
fresh_pre_sprint9c "$CONTRACT_DB"
apply_file "$CONTRACT_DB" "$CURRENT"
run_file "$CONTRACT_DB" "$CONTENT_OS/dry-run/20_contract_tests.sql"
run_file "$CONTRACT_DB" "$CONTENT_OS/dry-run/25_transition_contract_tests.sql"

section "role, privilege, and #posting regressions"
HARDENING_DB=sprint9c_hardening
fresh_pre_sprint9c "$HARDENING_DB"
apply_file "$HARDENING_DB" "$CURRENT"
run_file "$HARDENING_DB" "$HERE/sprint9c_hardening_regression_tests.sql"
run_file "$HARDENING_DB" "$HERE/sprint9b_posting_checklist_tests.sql"

expect_file_failure "SEO rollback refuses while users hold SEO_SPECIALIST" "$HARDENING_DB" "$ROLLBACKS/20261014120000_seo_specialist_role.down.sql"
sql "$HARDENING_DB" -c "update public.users set role = 'SMM_MANAGER' where role = 'SEO_SPECIALIST'"
apply_file "$HARDENING_DB" "$ROLLBACKS/20261014120000_seo_specialist_role.down.sql"
apply_file "$HARDENING_DB" "$MIGRATIONS/20261014120000_seo_specialist_role.sql"
echo "PASS SEO role rollback and reapply"

apply_file "$HARDENING_DB" "$ROLLBACKS/20261014120100_harden_service_role_table_privileges.down.sql"
apply_file "$HARDENING_DB" "$MIGRATIONS/20261014120100_harden_service_role_table_privileges.sql"
run_file "$HARDENING_DB" "$HERE/sprint9c_hardening_regression_tests.sql"
echo "PASS service-role privilege rollback and reapply"

apply_file "$HARDENING_DB" "$ROLLBACKS/20261014123341_repair_posting_checklist_creation.down.sql"
expect_failure "#posting rollback reintroduces the old UPDATE privilege failure" "$HARDENING_DB" \
  "set role service_role; select public.create_task_with_event_v2((select value from dryrun.ids where key = 'creator'), (select value from dryrun.ids where key = 'assignee'), 'Sprint 9C rollback probe #posting', '', 'normal', now() + interval '1 day')"
apply_file "$HARDENING_DB" "$MIGRATIONS/20261014123341_repair_posting_checklist_creation.sql"
echo "PASS #posting repair rollback and reapply"

section "read-only Content OS ownership check"
CONTENT_OS_HASH_AFTER="$(cat "$CONTENT_OS"/migrations/*.sql "$CONTENT_OS"/rollback/*.sql | sha256sum | cut -d' ' -f1)"
if [[ "$CONTENT_OS_HASH_BEFORE" != "$CONTENT_OS_HASH_AFTER" ]]; then
  echo "FAIL Content OS SQL changed"
  exit 1
fi
if [[ "$(git -C "$CONTENT_OS_REPO" status --porcelain)" != "$CONTENT_OS_STATUS_BEFORE" ]]; then
  echo "FAIL Content OS worktree status changed during the Task Bot dry-run"
  exit 1
fi
echo "PASS Content OS SQL and pre-existing worktree status remained unchanged"

echo
echo "SPRINT 9C POSTGRESQL DRY-RUN COMPLETE"

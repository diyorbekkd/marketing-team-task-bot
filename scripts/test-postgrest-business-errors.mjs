import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const CONTAINER = process.env.PG_CONTAINER ?? "ibox-pg-dryrun";
const DATABASE = process.env.E2E_DB ?? "e2e";
const UPSTREAM = process.env.PGRST_UPSTREAM ?? "http://172.17.0.2:3000";
const JWT_SECRET = "local-e2e-jwt-secret-not-a-real-secret-0123456789";

if (!/^http:\/\/(127\.0\.0\.1|172\.(1[6-9]|2\d|3[01])\.)/.test(UPSTREAM)) {
  throw new Error(`Refusing non-local PostgREST target: ${UPSTREAM}`);
}

function sql(query) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE, "-v", "ON_ERROR_STOP=1", "-tAqX"],
    { input: query, encoding: "utf8" },
  ).trim();
}

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function serviceRoleKey() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({ role: "service_role", iat: now, exp: now + 3600 })}`;
  return `${unsigned}.${createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url")}`;
}

const actorId = randomUUID();
const telegramId = Date.now();
sql(`
  insert into public.users (id, telegram_user_id, display_name, role, is_active)
  values ('${actorId}', ${telegramId}, 'Sprint 9E PostgREST actor', 'CONTENT_MARKETER', true);
`);
const taskId = sql(`
  select id from public.create_task_with_event_v2(
    '${actorId}', '${actorId}', 'Sprint 9E PT409 probe', '', 'normal', now() + interval '1 day'
  );
`);

const rollbacks = () => Number(sql("select xact_rollback from pg_stat_database where datname = current_database()"));
const activeAuthenticatorQueries = () => Number(sql(`
  select count(*) from pg_stat_activity
  where usename = 'authenticator' and state <> 'idle' and query not like 'LISTEN%'
`));
const before = rollbacks();

async function refuseOnce() {
  const started = performance.now();
  const response = await fetch(`${UPSTREAM}/rpc/transition_task_with_events`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceRoleKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_task_id: taskId, p_actor_id: actorId, p_new_status: "DONE", p_reason: null }),
    signal: AbortSignal.timeout(3_000),
  });
  const body = await response.json();
  return { status: response.status, body, elapsedMs: Math.round(performance.now() - started) };
}

const first = await refuseOnce();
const second = await refuseOnce();
await new Promise((resolve) => setTimeout(resolve, 150));
const rollbackDelta = rollbacks() - before;
const activeConnections = activeAuthenticatorQueries();
const taskStatus = sql(`select status from public.tasks where id = '${taskId}'`);

assert.equal(first.status, 409);
assert.equal(first.body.code, "PT409");
assert.equal(first.body.message, "task status changed concurrently");
assert.deepEqual(second.body, first.body);
assert.equal(second.status, 409);
assert.ok(rollbackDelta <= 2, `refusals must not create an internal retry loop (rollback delta ${rollbackDelta})`);
assert.equal(activeConnections, 0, "the PostgREST pool connection must be released after the response");
assert.equal(taskStatus, "IN_PROGRESS");

console.log(JSON.stringify({
  postgrest: "real",
  requests: 2,
  httpStatus: first.status,
  sqlState: first.body.code,
  message: first.body.message,
  elapsedMs: [first.elapsedMs, second.elapsedMs],
  rollbackDelta,
  activeConnections,
  taskStatus,
}));

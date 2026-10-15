import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

const databaseUrl = process.env.CONTENT_OS_AUTH_TEST_DB_URL;
if (!databaseUrl) {
  throw new Error("CONTENT_OS_AUTH_TEST_DB_URL is required.");
}

const parsedUrl = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("Refusing to run the destructive concurrency fixture against a non-local database.");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function query(sql) {
  return execFileSync("psql", [databaseUrl, "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

function queryAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [databaseUrl, "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `psql exited ${code}`));
    });
  });
}

const userOne = randomUUID();
const userTwo = randomUUID();
const telegramOne = 920000000 + Math.floor(Math.random() * 1000000);
const telegramTwo = telegramOne + 1000001;
const verifierHash = "a".repeat(64);
const tokenOne = "b".repeat(64);
const tokenTwo = "c".repeat(64);
let redeemChallenge;
let approvalChallenge;

try {
  query(`
    insert into public.users (id, telegram_user_id, display_name, role, is_active)
    values
      (${sqlLiteral(userOne)}::uuid, ${telegramOne}, 'Race One', 'CONTENT_MARKETER', true),
      (${sqlLiteral(userTwo)}::uuid, ${telegramTwo}, 'Race Two', 'SEO_SPECIALIST', true);
  `);

  redeemChallenge = query(`
    set role service_role;
    select challenge_id from public.content_os_auth_create_challenge(${sqlLiteral(verifierHash)});
  `).split("\n").at(-1);
  query(`
    set role service_role;
    select status from public.content_os_auth_approve_challenge(
      ${sqlLiteral(redeemChallenge)}::uuid, ${telegramOne}
    );
  `);

  const redeemResults = await Promise.all([
    queryAsync(`set role service_role; select status from public.content_os_auth_redeem_challenge(${sqlLiteral(redeemChallenge)}::uuid, ${sqlLiteral(verifierHash)}, ${sqlLiteral(tokenOne)});`),
    queryAsync(`set role service_role; select status from public.content_os_auth_redeem_challenge(${sqlLiteral(redeemChallenge)}::uuid, ${sqlLiteral(verifierHash)}, ${sqlLiteral(tokenTwo)});`),
  ]);
  if (redeemResults.filter((status) => status === "REDEEMED").length !== 1
    || redeemResults.filter((status) => status === "ALREADY_CONSUMED").length !== 1) {
    throw new Error(`Concurrent redemption was not one-shot: ${redeemResults.join(", ")}`);
  }
  const sessionCount = Number(query(`select count(*) from private.content_os_web_sessions where user_id = ${sqlLiteral(userOne)}::uuid;`));
  if (sessionCount !== 1) throw new Error(`Concurrent redemption created ${sessionCount} sessions.`);

  approvalChallenge = query(`
    set role service_role;
    select challenge_id from public.content_os_auth_create_challenge(${sqlLiteral("d".repeat(64))});
  `).split("\n").at(-1);
  const approvalResults = await Promise.all([
    queryAsync(`set role service_role; select status from public.content_os_auth_approve_challenge(${sqlLiteral(approvalChallenge)}::uuid, ${telegramOne});`),
    queryAsync(`set role service_role; select status from public.content_os_auth_approve_challenge(${sqlLiteral(approvalChallenge)}::uuid, ${telegramTwo});`),
  ]);
  if (approvalResults.filter((status) => status === "APPROVED").length !== 1
    || approvalResults.filter((status) => status === "UNAVAILABLE").length !== 1) {
    throw new Error(`Concurrent approval did not bind exactly one user: ${approvalResults.join(", ")}`);
  }
  const approvedUser = query(`select approved_user_id from private.content_os_login_challenges where id = ${sqlLiteral(approvalChallenge)}::uuid;`);
  if (![userOne, userTwo].includes(approvedUser)) {
    throw new Error("Concurrent approval bound an unexpected user.");
  }

  console.log("PASS concurrent approval and one-shot redemption");
} finally {
  query(`
    delete from private.content_os_web_sessions where user_id in (${sqlLiteral(userOne)}::uuid, ${sqlLiteral(userTwo)}::uuid);
    delete from private.content_os_login_challenges where id in (
      ${redeemChallenge ? `${sqlLiteral(redeemChallenge)}::uuid` : "null::uuid"},
      ${approvalChallenge ? `${sqlLiteral(approvalChallenge)}::uuid` : "null::uuid"}
    );
    delete from public.users where id in (${sqlLiteral(userOne)}::uuid, ${sqlLiteral(userTwo)}::uuid);
  `);
}

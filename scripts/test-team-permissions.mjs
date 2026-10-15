import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.TEAM_PERMISSIONS_TEST_DB_URL;
if (!databaseUrl) throw new Error("TEAM_PERMISSIONS_TEST_DB_URL is required.");

const parsedUrl = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("Refusing to run the destructive Sprint 10B fixture against a non-local database.");
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const script of ["test-team-permissions.sql", "test-team-permissions-concurrency.sql"]) {
  execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", join(root, "scripts", script)], {
    stdio: "inherit",
  });
}

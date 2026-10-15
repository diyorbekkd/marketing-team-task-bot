import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const EXPECTED_MIGRATIONS = [
  "20260906143255_foundation_schema.sql",
  "20260906150722_harden_revision_history.sql",
  "20260906151514_fast_track_mvp_core.sql",
  "20260906162000_secure_head_bootstrap.sql",
  "20260906163500_telegram_username_integrity.sql",
  "20260909090000_next_product_phase.sql",
  "20260909200000_reminders_and_membership.sql",
  "20260914090000_autostart_tasks.sql",
  "20261009100000_content_os_00_helpers.sql",
  "20261009100100_content_os_01_content_entities.sql",
  "20261009100200_content_os_02_task_config.sql",
  "20261009100300_content_os_03_task_runtime.sql",
  "20261009100400_content_os_04_idempotency.sql",
  "20261009100500_content_os_05_external_identity_links.sql",
  "20261014120000_seo_specialist_role.sql",
  "20261014120100_harden_service_role_table_privileges.sql",
  "20261014123341_repair_posting_checklist_creation.sql",
  "20261014130000_content_os_06_transition_contract.sql",
  "20261014130332_content_os_task_transition_compatibility.sql",
];

export const IMPORTED_CONTENT_OS_HASHES = new Map([
  ["20261009100000_content_os_00_helpers.sql", "d13a5c81148bc9afa69c814be7cc8c11536755b446d8801fcca4dde67e7ef84c"],
  ["20261009100100_content_os_01_content_entities.sql", "7ab65dce8058e0832af2f173b6defa3da22fc78838d19ae0da1999e65e981140"],
  ["20261009100200_content_os_02_task_config.sql", "e0eededd8301d684458b2e73034302a462a1e6ec079a07ac8b758b021dc732ff"],
  ["20261009100300_content_os_03_task_runtime.sql", "e71bdbf925f319434f41d85a67aecb1ad948299ca09cd0bec2d54ec74bf68317"],
  ["20261009100400_content_os_04_idempotency.sql", "f7740d8a2cdd725270e0e8aef859cdc38aa83175a6fd5750a25ab99e9f50534c"],
  ["20261009100500_content_os_05_external_identity_links.sql", "cbe6ce99142af69695dacce6fccc3284838c1a0786160d7177a77368bc953c8d"],
  ["20261014130000_content_os_06_transition_contract.sql", "5a08a8fe37ffaeaf7559f614531d19000a80d98754004230c8d72948fce90992"],
]);

export function checkMigrationManifest(migrationsDir = join(ROOT, "supabase", "migrations")) {
  const files = readdirSync(migrationsDir).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
  const versions = files.map((name) => name.slice(0, 14));
  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);

  if (duplicates.length > 0) {
    throw new Error(`Duplicate migration versions: ${[...new Set(duplicates)].join(", ")}`);
  }
  if (JSON.stringify(files) !== JSON.stringify(EXPECTED_MIGRATIONS)) {
    throw new Error(`Migration manifest differs from the canonical order.\nExpected: ${EXPECTED_MIGRATIONS.join("\n")}\nActual: ${files.join("\n")}`);
  }

  for (const [name, expected] of IMPORTED_CONTENT_OS_HASHES) {
    const actual = createHash("sha256").update(readFileSync(join(migrationsDir, name))).digest("hex");
    if (actual !== expected) {
      throw new Error(`Imported Content OS migration hash mismatch for ${name}: expected ${expected}, got ${actual}`);
    }
  }

  return { files, importedHashes: Object.fromEntries(IMPORTED_CONTENT_OS_HASHES) };
}

if (process.argv[1] && basename(process.argv[1]) === "check-migration-manifest.mjs") {
  const result = checkMigrationManifest();
  console.log(`PASS canonical migration manifest: ${result.files.length} ordered versions, no duplicates`);
  console.log(`PASS imported Content OS hashes: ${Object.keys(result.importedHashes).length} byte-identical files`);
}

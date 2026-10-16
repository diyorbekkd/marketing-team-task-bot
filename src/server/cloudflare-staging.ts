import "server-only";

const STAGING_WORKER_NAME = "ibox-task-bot-staging";
const STAGING_SUPABASE_PROJECT_REF = "yuznbaaoonyqonhiywkt";
const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`;

type StagingEnvironment = {
  readonly DEPLOYMENT_ENVIRONMENT?: string;
  readonly SUPABASE_PROJECT_REF?: string;
  readonly SUPABASE_URL?: string;
  readonly APP_URL?: string;
};

function isLocalAppUrl(url: URL) {
  return url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

function isStagingWorkerUrl(url: URL) {
  return url.protocol === "https:"
    && url.hostname.startsWith(`${STAGING_WORKER_NAME}.`)
    && url.hostname.endsWith(".workers.dev");
}

export function assertCloudflareStagingEnvironment(env: StagingEnvironment) {
  if (env.DEPLOYMENT_ENVIRONMENT !== "staging") {
    throw new Error("Cloudflare Task Bot requires DEPLOYMENT_ENVIRONMENT=staging.");
  }
  if (env.SUPABASE_PROJECT_REF !== STAGING_SUPABASE_PROJECT_REF || env.SUPABASE_URL !== STAGING_SUPABASE_URL) {
    throw new Error("Cloudflare Task Bot requires the approved staging Supabase project.");
  }

  let appUrl: URL;
  try {
    appUrl = new URL(env.APP_URL ?? "");
  } catch {
    throw new Error("Cloudflare Task Bot requires a valid staging APP_URL.");
  }
  if (!isLocalAppUrl(appUrl) && !isStagingWorkerUrl(appUrl)) {
    throw new Error("Cloudflare Task Bot APP_URL must be local or the staging workers.dev URL.");
  }
}

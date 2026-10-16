import handler from "vinext/server/fetch-handler";
import { runCloudflareScheduledCron } from "../src/server/cloudflare-scheduled";
import { assertCloudflareStagingEnvironment } from "../src/server/cloudflare-staging";

function logScheduledEvent(event: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...details }));
}

export default {
  async fetch(request, env, context) {
    try {
      assertCloudflareStagingEnvironment(env);
    } catch (error) {
      console.error(JSON.stringify({
        event: "cloudflare_staging_guard_rejected",
        reason: error instanceof Error ? error.message : "Unknown staging configuration error.",
      }));
      return Response.json({ error: "Cloudflare staging is not configured." }, { status: 503 });
    }
    return handler.fetch(request, env, context);
  },

  async scheduled(controller, env) {
    assertCloudflareStagingEnvironment(env);
    logScheduledEvent("cloudflare_cron_started", {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    });
    const jobs = await runCloudflareScheduledCron(controller.cron);
    logScheduledEvent("cloudflare_cron_completed", {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
      jobs,
    });
  },
} satisfies ExportedHandler<Cloudflare.Env>;

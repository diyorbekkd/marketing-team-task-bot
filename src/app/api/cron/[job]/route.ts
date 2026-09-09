import { z } from "zod";
import { getMarketingService, getReportingService } from "@/server/application";
import { isAuthorizedCronRequest } from "@/server/auth/cron";
import { ConfigurationError } from "@/server/config";
import { errorResponse } from "@/server/http/errors";

const JobSchema = z.enum(["daily-morning", "daily-evening", "weekly", "recurring"]);

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ job: string }> }) {
  try {
    if (!isAuthorizedCronRequest(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
    const job = JobSchema.parse((await context.params).job);
    const result = job === "recurring"
      ? await getMarketingService().generateDueRecurringTasks()
      : await getReportingService().deliver(
          job === "daily-morning" ? "DAILY_MORNING" : job === "daily-evening" ? "DAILY_EVENING" : "WEEKLY",
        );
    return Response.json({ ok: true, job, result });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      return Response.json({ error: "Scheduled jobs are not configured." }, { status: 503 });
    }
    return errorResponse(error);
  }
}

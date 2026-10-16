import { isAuthorizedCronRequest } from "@/server/auth/cron";
import { ConfigurationError } from "@/server/config";
import { errorResponse } from "@/server/http/errors";
import { runScheduledJob, ScheduledJobSchema } from "@/server/scheduled-jobs";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ job: string }> }) {
  try {
    if (!isAuthorizedCronRequest(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
    const job = ScheduledJobSchema.parse((await context.params).job);
    const result = await runScheduledJob(job);
    return Response.json({ ok: true, job, result });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      return Response.json({ error: "Scheduled jobs are not configured." }, { status: 503 });
    }
    return errorResponse(error);
  }
}

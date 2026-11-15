import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET() {
  try {
    const actor = await requireRequestActor();
    const service = getMarketingService();
    const [plans, checkpoints] = await Promise.all([
      service.listPersonalPlans(actor), service.listTodaysCheckpoints(actor),
    ]);
    return Response.json({ plans, checkpoints });
  } catch (error) {
    return errorResponse(error);
  }
}

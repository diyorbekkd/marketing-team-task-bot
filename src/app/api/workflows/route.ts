import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET() {
  try {
    const actor = await requireRequestActor();
    return Response.json({ plans: await getMarketingService().listWorkflowPlans(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireRequestActor();
    const result = await getMarketingService().startWorkflow(actor, await request.json());
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

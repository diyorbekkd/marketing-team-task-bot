import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor(request);
    const { id } = await context.params;
    return Response.json(await getMarketingService().getTaskDetails(actor, id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor(request);
    const { id } = await context.params;
    const task = await getMarketingService().editTask(actor, id, await request.json());
    return Response.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}

import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    return Response.json({ checkpoint: await getMarketingService().toggleCheckpointFast(actor, id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    return Response.json(await getMarketingService().removeCheckpoint(actor, id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    return Response.json({ checkpoint: await getMarketingService().setCheckpointDue(actor, id, await request.json()) });
  } catch (error) { return errorResponse(error); }
}

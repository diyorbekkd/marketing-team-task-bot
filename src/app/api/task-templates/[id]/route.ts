import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    return Response.json(await getMarketingService().archiveTaskTemplate(actor, id));
  } catch (error) { return errorResponse(error); }
}

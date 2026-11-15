import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const item = await getMarketingService().togglePostingChecklistItemFast(actor, id);
    return Response.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

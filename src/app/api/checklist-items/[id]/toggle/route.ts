import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const postingChecklist = await getMarketingService().togglePostingChecklistItem(actor, id);
    return Response.json({ postingChecklist });
  } catch (error) {
    return errorResponse(error);
  }
}

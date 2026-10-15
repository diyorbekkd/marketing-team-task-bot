import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor(request);
    const { id } = await context.params;
    const task = await getMarketingService().restoreTask(actor, id);
    return Response.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}

import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const archive = await getMarketingService().archiveTask(actor, id, body);
    return Response.json({ archive });
  } catch (error) {
    return errorResponse(error);
  }
}

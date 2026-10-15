import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor(request);
    const { id } = await context.params;
    const reassignRequest = await getMarketingService().requestReassign(actor, id, await request.json());
    return Response.json({ reassignRequest }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

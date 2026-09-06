import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const deadlineRequest = await getMarketingService().requestDeadlineChange(actor, id, await request.json());
    return Response.json({ deadlineRequest }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

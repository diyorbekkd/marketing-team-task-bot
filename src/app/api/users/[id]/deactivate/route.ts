import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const result = await getMarketingService().deactivateUser(actor, id, body);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

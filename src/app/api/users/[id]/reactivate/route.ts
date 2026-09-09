import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const user = await getMarketingService().reactivateUser(actor, id);
    return Response.json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}

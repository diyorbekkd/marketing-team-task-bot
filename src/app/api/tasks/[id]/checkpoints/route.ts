import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const checkpoint = await getMarketingService().addCheckpoint(actor, id, await request.json());
    return Response.json({ checkpoint }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

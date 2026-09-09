import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const recurringDefinition = await getMarketingService().createRecurrence(actor, id, await request.json());
    return Response.json({ recurringDefinition }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const recurringDefinition = await getMarketingService().updateRecurrence(actor, id, await request.json());
    return Response.json({ recurringDefinition });
  } catch (error) {
    return errorResponse(error);
  }
}

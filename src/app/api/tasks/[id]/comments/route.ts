import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    return Response.json(await getMarketingService().listTaskComments(actor, id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const comment = await getMarketingService().addTaskComment(actor, id, await request.json());
    return Response.json(comment, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

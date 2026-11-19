import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET() {
  try {
    const actor = await requireRequestActor();
    return Response.json({ templates: await getMarketingService().listWorkflowTemplates(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireRequestActor();
    return Response.json(await getMarketingService().saveWorkflowTemplate(actor, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}

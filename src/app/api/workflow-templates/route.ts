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

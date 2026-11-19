import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET() {
  try {
    const actor = await requireRequestActor();
    return Response.json(await getMarketingService().getNotificationPreferences(actor));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireRequestActor();
    return Response.json(await getMarketingService().updateNotificationPreferences(actor, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}

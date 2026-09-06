import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET() {
  try {
    const actor = await requireRequestActor();
    return Response.json({ users: await getMarketingService().listUsers(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

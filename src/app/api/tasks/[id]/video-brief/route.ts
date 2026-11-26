import { after } from "next/server";
import { getMarketingService } from "@/server/application";
import { getNotificationRetryService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const brief = await getMarketingService().saveVideoBrief(actor, id, await request.json());
    if (brief.kind === "SHOOT") after(async () => {
      try { await getNotificationRetryService().deliver(25); }
      catch { console.error(JSON.stringify({ event: "post_response_shoot_scenario_delivery_failed", taskId: id })); }
    });
    return Response.json(brief);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    return Response.json(await getMarketingService().confirmShoot(actor, id));
  } catch (error) {
    return errorResponse(error);
  }
}

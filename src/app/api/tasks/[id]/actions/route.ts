import { after } from "next/server";
import { getMarketingService } from "@/server/application";
import { getNotificationRetryService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const task = await getMarketingService().performTaskAction(actor, id, await request.json(), { deferNotifications: true });
    after(async () => {
      try {
        await getNotificationRetryService().deliver(25);
      } catch {
        console.error(JSON.stringify({ event: "post_response_workflow_delivery_failed", taskId: task.id }));
      }
    });
    return Response.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}

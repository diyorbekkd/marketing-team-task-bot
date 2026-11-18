import { after } from "next/server";
import { z } from "zod";
import { getAssistantService, getNotificationRetryService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

const InputSchema = z.object({ turnId: z.uuid() }).strict();

export async function POST(request: Request) {
  try {
    const actor = await requireRequestActor();
    const { turnId } = InputSchema.parse(await request.json());
    const result = await getAssistantService().confirm(actor, turnId);
    after(async () => {
      try { await getNotificationRetryService().deliver(25); }
      catch { console.error(JSON.stringify({ event: "post_response_assistant_action_delivery_failed", turnId })); }
    });
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}

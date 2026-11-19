import { getAssistantService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";
import { z } from "zod";

export const maxDuration = 30;

const InputSchema = z.object({
  requestKey: z.string().uuid(),
  text: z.string().trim().min(1).max(3000),
}).strict();

export async function GET() {
  try {
    const actor = await requireRequestActor();
    const service = getAssistantService();
    return Response.json({ available: service.available(), turns: await service.listRecent(actor) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireRequestActor();
    const input = InputSchema.parse(await request.json());
    return Response.json(await getAssistantService().respond(actor, { ...input, source: "WEB" }));
  } catch (error) { return errorResponse(error); }
}

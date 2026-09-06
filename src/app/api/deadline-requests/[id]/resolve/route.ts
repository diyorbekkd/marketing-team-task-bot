import { z } from "zod";
import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

const BodySchema = z
  .object({
    approve: z.boolean(),
    resolutionNote: z.string().trim().max(2000).optional(),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const body = BodySchema.parse(await request.json());
    const deadlineRequest = await getMarketingService().resolveDeadlineChangeRequest(
      actor,
      id,
      body.approve,
      body.resolutionNote,
    );
    return Response.json({ deadlineRequest });
  } catch (error) {
    return errorResponse(error);
  }
}

import { z } from "zod";
import { NON_HEAD_ROLES } from "@/domain/permissions";
import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

const BodySchema = z.object({
  role: z.enum(NON_HEAD_ROLES),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const body = BodySchema.parse(await request.json());
    return Response.json({ user: await getMarketingService().updateUserRole(actor, id, body.role) });
  } catch (error) {
    return errorResponse(error);
  }
}

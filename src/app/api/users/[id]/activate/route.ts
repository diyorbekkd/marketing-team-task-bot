import { z } from "zod";
import { TeamRoleSchema } from "@/domain/models";
import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

const BodySchema = z.object({ role: TeamRoleSchema }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const body = BodySchema.parse(await request.json());
    return Response.json({ user: await getMarketingService().activateUser(actor, id, body.role) });
  } catch (error) {
    return errorResponse(error);
  }
}

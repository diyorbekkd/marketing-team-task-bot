import { z } from "zod";
import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

const StatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);

export async function GET(request: Request) {
  try {
    const actor = await requireRequestActor(request);
    const rawStatus = new URL(request.url).searchParams.get("status");
    const status = rawStatus ? StatusSchema.parse(rawStatus) : undefined;
    return Response.json(await getMarketingService().listChangeRequests(actor, status));
  } catch (error) {
    return errorResponse(error);
  }
}

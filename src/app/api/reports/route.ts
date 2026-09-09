import { z } from "zod";
import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

const WindowSchema = z.coerce.number().int().min(1).max(365).default(30);

export async function GET(request: Request) {
  try {
    const actor = await requireRequestActor();
    const windowDays = WindowSchema.parse(new URL(request.url).searchParams.get("days") ?? "30");
    return Response.json(await getMarketingService().getAnalytics(actor, windowDays));
  } catch (error) {
    return errorResponse(error);
  }
}

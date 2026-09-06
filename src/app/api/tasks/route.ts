import { z } from "zod";
import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

const ScopeSchema = z.enum(["my", "team", "today", "overdue", "review"]);

export async function GET(request: Request) {
  try {
    const actor = await requireRequestActor();
    const requestedScope = new URL(request.url).searchParams.get("scope") ?? "my";
    const scope = ScopeSchema.parse(requestedScope);
    return Response.json({ tasks: await getMarketingService().listTasks(actor, scope) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireRequestActor();
    const task = await getMarketingService().createTask(actor, await request.json());
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

import { z } from "zod";
import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

const ScopeSchema = z.enum(["my", "created", "team", "today", "overdue", "review"]);

export async function GET(request: Request) {
  try {
    const actor = await requireRequestActor();
    const searchParams = new URL(request.url).searchParams;
    const requestedScope = searchParams.get("scope") ?? "my";
    const scope = ScopeSchema.parse(requestedScope);
    const input = Object.fromEntries(
      ["status", "priority", "assigneeId", "deadlineRange", "search", "sort", "pageSize", "cursor"]
        .flatMap((key) => {
          const value = searchParams.get(key);
          return value === null ? [] : [[key, value] as const];
        }),
    );
    return Response.json(await getMarketingService().listTaskPage(actor, scope, input));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireRequestActor();
    const result = await getMarketingService().createTask(actor, await request.json());
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

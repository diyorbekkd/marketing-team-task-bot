import { z } from "zod";
import { after } from "next/server";
import { ApplicationError } from "@/application/errors";
import { getMarketingService } from "@/server/application";
import { getNotificationRetryService } from "@/server/application";
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
      ["status", "priority", "assigneeId", "deadlineRange", "reportView", "search", "sort", "pageSize", "cursor"]
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
    // Browser retries must carry the same operation ID. Internal AI actions
    // have their own one-time claim and call the service directly.
    const input = z.object({ clientRequestId: z.uuid() }).passthrough().safeParse(await request.json());
    if (!input.success) {
      throw new ApplicationError("INVALID_INPUT", "Ilovani yangilab, vazifani qayta yuboring.");
    }
    const result = await getMarketingService().createTaskQueued(actor, input.data);
    after(async () => {
      try {
        await getNotificationRetryService().deliver(25);
      } catch {
        // The durable outbox remains available to the scheduled retry worker.
        console.error(JSON.stringify({ event: "post_response_assignment_delivery_failed", taskId: result.task.id }));
      }
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

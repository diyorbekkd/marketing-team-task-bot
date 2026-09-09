import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor();
    const { id } = await context.params;
    const preview = await getMarketingService().getDeactivationPreview(actor, id);
    return Response.json({
      user: preview.user,
      openTasks: preview.openTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        deadline: task.deadline,
      })),
      historicalTaskCount: preview.historicalTaskCount,
      activeRecurringCount: preview.activeRecurringCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

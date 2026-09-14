import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

// Thin consolidating endpoint for the Mini App's first paint: the current
// user's identity is already known from auth, so this returns only the
// active team list (needed for the assignee picker) and the Home-scope task
// list, fetched in parallel server-side. No new business logic — both
// queries already exist as MarketingService methods; this just avoids two
// sequential client round trips (each paying the Vercel<->Supabase
// cross-region latency) before the first useful screen can render.
export async function GET() {
  try {
    const actor = await requireRequestActor();
    const service = getMarketingService();
    const homeScope = actor.role === "HEAD_OF_MARKETING" ? "team" : "my";

    const [users, tasks] = await Promise.all([
      service.listUsers(actor),
      service.listTasks(actor, homeScope),
    ]);

    return Response.json({
      users: users.map((user) => ({
        id: user.id,
        telegramUsername: user.telegramUsername,
        displayName: user.displayName,
        role: user.role,
        isActive: user.isActive,
        deactivatedAt: user.deactivatedAt,
      })),
      tasks,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

import { getMarketingService } from "@/server/application";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET() {
  try {
    const actor = await requireRequestActor();
    const users = (await getMarketingService().listUsers(actor)).map((user) => ({
      id: user.id,
      telegramUsername: user.telegramUsername,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
    }));
    return Response.json({ users });
  } catch (error) {
    return errorResponse(error);
  }
}

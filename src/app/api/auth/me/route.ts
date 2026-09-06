import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET() {
  try {
    return Response.json({ user: await requireRequestActor() });
  } catch (error) {
    return errorResponse(error);
  }
}

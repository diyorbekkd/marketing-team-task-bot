import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

export async function GET(request: Request) {
  try {
    return Response.json({ user: await requireRequestActor(request) });
  } catch (error) {
    return errorResponse(error);
  }
}

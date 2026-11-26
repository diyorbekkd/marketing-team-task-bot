import { getBootstrapData } from "@/server/bootstrap";
import { requireRequestActor } from "@/server/auth/request-actor";
import { errorResponse } from "@/server/http/errors";

// Returning identity with the Home data lets an existing web session start in
// one request rather than waiting for /api/auth/me and then loading Home.
export async function GET() {
  try {
    const actor = await requireRequestActor();
    return Response.json(await getBootstrapData(actor));
  } catch (error) {
    return errorResponse(error);
  }
}

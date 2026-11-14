import { NextResponse, type NextRequest } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cookie authentication is already SameSite=Strict. This lightweight network
 * boundary adds explicit Origin/Sec-Fetch-Site enforcement for browser writes,
 * while still allowing non-browser Telegram webhook calls that legitimately do
 * not send either header. Authentication and authorization remain in routes.
 */
export function proxy(request: NextRequest) {
  if (!MUTATING_METHODS.has(request.method)) return NextResponse.next();

  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const crossSite = fetchSite === "cross-site" || (origin !== null && origin !== request.nextUrl.origin);
  if (crossSite) {
    return Response.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};

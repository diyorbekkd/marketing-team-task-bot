import type { User } from "@/domain/models";

/**
 * Every server-to-server or browser auth path ultimately resolves to the
 * same real `public.users` row and the same source-agnostic `User` shape
 * that `MarketingService` and every route already work with. `source` is
 * carried alongside it (not exposed to existing call sites -- see
 * request-actor.ts) so a future, narrower consumer (e.g. a create-task path
 * that must require idempotency only for service-originated requests) can
 * distinguish them without any existing route or business logic needing to
 * know or care.
 */
export type RequestActorSource = "COOKIE" | "CONTENT_OS_SERVICE";

export interface RequestActorResolution {
  readonly actor: User;
  readonly source: RequestActorSource;
}

export interface RequestActorProvider {
  /**
   * Resolves the actor for this request, or returns null if this provider
   * does not apply to it at all (e.g. no session cookie present, or no
   * service-auth signature header present) -- letting the next provider in
   * the chain try. Throwing means this provider DID apply but the request
   * failed its checks (bad signature, expired, unknown/inactive actor,
   * malformed session, ...); the caller must not fall through to a
   * different provider in that case, since that would let the same request
   * be retried under a weaker check.
   */
  resolve(request: Request): Promise<RequestActorResolution | null>;
}

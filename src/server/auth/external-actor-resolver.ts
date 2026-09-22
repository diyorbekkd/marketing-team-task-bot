import "server-only";

import type { User } from "@/domain/models";

/**
 * Resolves a Content OS-side identity claim (its own auth subject -- e.g. a
 * SIWC `oai-authenticated-user-id`) into a real `public.users` actor.
 * Content OS's SIWC subject is never treated as a `public.users.id` directly
 * -- Codex's `external_identity_links` schema is the intended source of
 * truth for that mapping, and does not exist yet, which is why the only
 * production implementation here (SchemaNotReadyExternalActorResolver)
 * fails closed.
 */
export interface ExternalActorResolverInput {
  readonly provider: string;
  readonly externalSubject: string;
}

export class ExternalIdentityNotLinkedError extends Error {
  readonly code = "EXTERNAL_IDENTITY_NOT_LINKED";
  constructor(message = "No linked public.users actor exists for this external identity.") {
    super(message);
    this.name = "ExternalIdentityNotLinkedError";
  }
}

export interface ExternalActorResolver {
  resolve(input: ExternalActorResolverInput): Promise<User>;
}

/**
 * The only production-wired ExternalActorResolver today. Always fails
 * closed: no `external_identity_links` table or equivalent exists yet, so
 * there is nothing real to query, and this class must never guess or
 * fabricate a mapping. This is a second, independent gate on top of
 * CONTENT_OS_SERVICE_AUTH_ENABLED -- even if that flag were mistakenly set
 * true, no request could ever resolve to a real actor through this path
 * until Codex's schema lands and a real resolver replaces this one.
 */
export class SchemaNotReadyExternalActorResolver implements ExternalActorResolver {
  async resolve(input: ExternalActorResolverInput): Promise<User> {
    void input;
    throw new ExternalIdentityNotLinkedError(
      "external_identity_links schema is not available yet (Codex handoff pending); no provider/externalSubject mapping can be resolved.",
    );
  }
}

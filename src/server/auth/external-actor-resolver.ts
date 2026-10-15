import "server-only";

import type { MarketingRepository } from "@/application/ports/marketing-repository";
import type { User } from "@/domain/models";

export const CONTENT_OS_TELEGRAM_SESSION_PROVIDER = "CONTENT_OS_TELEGRAM_SESSION";

/** Resolves a signed Content OS actor claim into a current public.users row. */
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
 * Resolves the actor id already authenticated by Content OS's Telegram web
 * session. The shared HMAC proves the assertion came from the trusted
 * Content OS server; the repository read then resolves the current
 * public.users row. ContentOsRequestActorProvider performs the final active
 * check so role/active state is never frozen into a signed assertion.
 */
export class ContentOsTelegramSessionActorResolver implements ExternalActorResolver {
  constructor(
    private readonly users: Pick<MarketingRepository, "getUserById">,
  ) {}

  async resolve(input: ExternalActorResolverInput): Promise<User> {
    if (input.provider !== CONTENT_OS_TELEGRAM_SESSION_PROVIDER
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.externalSubject)) {
      throw new ExternalIdentityNotLinkedError();
    }
    const actor = await this.users.getUserById(input.externalSubject);
    if (!actor) throw new ExternalIdentityNotLinkedError();
    return actor;
  }
}

/** Legacy fail-closed resolver retained for compatibility/tests. */
export class SchemaNotReadyExternalActorResolver implements ExternalActorResolver {
  async resolve(input: ExternalActorResolverInput): Promise<User> {
    void input;
    throw new ExternalIdentityNotLinkedError(
      "external_identity_links schema is not available yet (Codex handoff pending); no provider/externalSubject mapping can be resolved.",
    );
  }
}

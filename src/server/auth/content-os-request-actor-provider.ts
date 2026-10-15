import "server-only";

import { ApplicationError } from "@/application/errors";
import { getContentOsServiceAuthConfig } from "@/server/config";
import {
  CONTENT_OS_ACTOR_PROVIDER_HEADER,
  CONTENT_OS_ACTOR_SUBJECT_HEADER,
  CONTENT_OS_SIGNATURE_HEADER,
  CONTENT_OS_TIMESTAMP_HEADER,
  ContentOsSignatureError,
  verifyContentOsSignature,
} from "./content-os-signature";
import { ContentOsTelegramSessionActorResolver, ExternalIdentityNotLinkedError } from "./external-actor-resolver";
import type { ExternalActorResolver } from "./external-actor-resolver";
import type { RequestActorProvider, RequestActorResolution } from "./request-actor-provider";
import { SupabaseMarketingRepository } from "@/server/repositories/supabase-marketing-repository";

/**
 * Server-to-server provider for signed Content OS requests. Fully inert
 * (never even reads the request body) unless CONTENT_OS_SERVICE_AUTH_ENABLED
 * is explicitly "true" AND the request carries the signature header --
 * either condition missing means "not applicable", returning null so the
 * cookie provider (or the orchestrator's final fallback) handles it
 * normally. A present-but-invalid signature, an unresolvable identity, or an
 * inactive resolved actor all throw UNAUTHENTICATED rather than falling
 * through, since a service request with a bad signature is a security
 * event, not an "try the next auth method" situation.
 *
 * The config flag defaults false. When explicitly enabled, the default
 * resolver accepts only the fixed Content OS Telegram-session provider and
 * resolves its signed public.users id through the current repository row.
 */
export class ContentOsRequestActorProvider implements RequestActorProvider {
  constructor(
    private readonly externalActorResolver: ExternalActorResolver = new ContentOsTelegramSessionActorResolver(
      new SupabaseMarketingRepository(),
    ),
    private readonly getConfig: typeof getContentOsServiceAuthConfig = getContentOsServiceAuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(request: Request): Promise<RequestActorResolution | null> {
    const config = this.getConfig();
    if (!config.enabled) return null;

    const signature = request.headers.get(CONTENT_OS_SIGNATURE_HEADER);
    if (!signature) return null;

    if (!config.secret) {
      throw new ApplicationError("UNAUTHENTICATED", "Content OS service auth is not fully configured.");
    }

    const timestampHeader = request.headers.get(CONTENT_OS_TIMESTAMP_HEADER);
    const provider = request.headers.get(CONTENT_OS_ACTOR_PROVIDER_HEADER);
    const externalSubject = request.headers.get(CONTENT_OS_ACTOR_SUBJECT_HEADER);
    if (!timestampHeader || !provider || !externalSubject) {
      throw new ApplicationError("UNAUTHENTICATED", "Content OS service request is missing required headers.");
    }

    const timestamp = Number(timestampHeader);
    const bodyText = await request.text();

    try {
      verifyContentOsSignature(
        { method: request.method, path: new URL(request.url).pathname, bodyText, provider, externalSubject, timestamp },
        signature,
        config.secret,
        this.now(),
      );
    } catch (error) {
      if (error instanceof ContentOsSignatureError) {
        throw new ApplicationError("UNAUTHENTICATED", "Content OS service request signature is invalid or expired.");
      }
      throw error;
    }

    let actor;
    try {
      actor = await this.externalActorResolver.resolve({ provider, externalSubject });
    } catch (error) {
      if (error instanceof ExternalIdentityNotLinkedError) {
        throw new ApplicationError("UNAUTHENTICATED", "No linked team member exists for this Content OS identity.");
      }
      throw error;
    }

    if (!actor.isActive) {
      throw new ApplicationError("UNAUTHENTICATED", "The linked team member is not active.");
    }

    return { actor, source: "CONTENT_OS_SERVICE" };
  }
}

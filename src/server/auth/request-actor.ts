import "server-only";

import type { User } from "@/domain/models";
import { ApplicationError } from "@/application/errors";
import { CookieRequestActorProvider } from "./cookie-request-actor-provider";
import { ContentOsRequestActorProvider } from "./content-os-request-actor-provider";
import type { RequestActorProvider, RequestActorResolution } from "./request-actor-provider";

const defaultProviders: readonly RequestActorProvider[] = [
  new ContentOsRequestActorProvider(),
  new CookieRequestActorProvider(),
];

/**
 * Tries each provider in order and returns the first resolution. Exported
 * (rather than hardcoded inside requireRequestActor) so tests can exercise
 * the orchestration logic against fake providers without needing a real
 * Next.js cookies() context or a real signed request.
 */
export async function resolveRequestActor(
  request: Request,
  providers: readonly RequestActorProvider[] = defaultProviders,
): Promise<RequestActorResolution> {
  for (const provider of providers) {
    // Each provider gets its own clone so one provider reading the body
    // (only ContentOsRequestActorProvider does) never consumes the stream
    // for another provider or for the route handler's own later
    // `await request.json()` on the original, un-cloned `request`.
    const resolution = await provider.resolve(request.clone() as Request);
    if (resolution) return resolution;
  }
  throw new ApplicationError("UNAUTHENTICATED", "Telegram authentication is required.");
}

/**
 * Existing call sites (every route handler, MarketingService's callers)
 * keep working unchanged: this still returns a plain `User`, exactly as
 * before, regardless of which provider actually resolved it. Only the
 * parameter changed (now takes the route's `request`, needed so a service-
 * auth provider can read its method/path/body/headers) -- every existing
 * route already had `request` in scope.
 */
export async function requireRequestActor(request: Request): Promise<User> {
  return (await resolveRequestActor(request)).actor;
}

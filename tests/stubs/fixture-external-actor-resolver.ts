import { ExternalIdentityNotLinkedError } from "../../src/server/auth/external-actor-resolver";
import type { ExternalActorResolver, ExternalActorResolverInput } from "../../src/server/auth/external-actor-resolver";
import type { User } from "../../src/domain/models";

/**
 * Test-only stand-in for the real (Codex-owned, not-yet-built)
 * external_identity_links-backed resolver. Lives under tests/stubs, not
 * src/, specifically so production code has no importable path to a fake
 * identity mapping. Construct it with a fixed provider/externalSubject ->
 * User map; anything not in the map is treated as unlinked.
 */
export class FixtureExternalActorResolver implements ExternalActorResolver {
  constructor(private readonly links: ReadonlyMap<string, User>) {}

  static key(provider: string, externalSubject: string): string {
    return `${provider}:${externalSubject}`;
  }

  async resolve(input: ExternalActorResolverInput): Promise<User> {
    const user = this.links.get(FixtureExternalActorResolver.key(input.provider, input.externalSubject));
    if (!user) throw new ExternalIdentityNotLinkedError();
    return user;
  }
}

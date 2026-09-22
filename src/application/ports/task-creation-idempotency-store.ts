/**
 * Idempotency ledger for a task-creation request whose transport does not
 * already have one. The Telegram/webhook transport already has this
 * (`tasks.source_telegram_update_id`, enforced by a DB unique constraint);
 * the Mini App's cookie-based `POST /api/tasks` has never had one either,
 * and stays exactly as it is -- this port is specifically for a future
 * Content OS-originated create over the service-auth path, keyed by a
 * caller-supplied idempotency key, so a network retry from Content OS can
 * never silently create two tasks for the same logical request.
 *
 * No implementation exists yet and none is wired into any route: Codex owns
 * the DB-backed persistence model (content_* / idempotency schema track).
 * Until a real store lands, CONTENT_OS_SERVICE_AUTH_ENABLED plus a fail-
 * closed ExternalActorResolver already make a service-authenticated create
 * unreachable in production -- this interface exists so that constraint can
 * be replaced with a real, tested guarantee later without redesigning the
 * auth layer again.
 */
export interface TaskCreationIdempotencyStore {
  /** The previously created task's id for this key, or null if unclaimed. */
  findExistingTaskId(idempotencyKey: string): Promise<string | null>;
  /** Atomically claims the key for a newly created task. Must be safe under
   * concurrent duplicate calls for the same key (first write wins; a second
   * concurrent claim for the same key must not silently succeed). */
  claim(idempotencyKey: string, taskId: string): Promise<void>;
}

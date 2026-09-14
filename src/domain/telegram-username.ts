/**
 * Canonical form for a Telegram username: trims surrounding whitespace,
 * removes exactly one leading "@" (defensive — the shared task parser
 * already strips it before this ever runs, but every lookup should be safe
 * on its own), and lowercases the rest. `register_telegram_user` stores
 * `telegram_username` in this same trimmed-and-lowercased form, so every
 * lookup must normalize identically or a real, active username can silently
 * fail to match.
 */
export function canonicalTelegramUsername(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

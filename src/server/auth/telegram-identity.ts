/**
 * Identity produced only after a trusted server verifier validates Telegram
 * init data. The verifier implementation belongs to Sprint 6; browser input
 * must never be cast directly to this type.
 */
export interface VerifiedTelegramIdentity {
  readonly telegramUserId: string;
  readonly username?: string;
  readonly displayName: string;
  readonly verifiedAt: Date;
}

export interface TelegramIdentityVerifier {
  verify(initData: string): Promise<VerifiedTelegramIdentity>;
}

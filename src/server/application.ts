import "server-only";

import { MarketingService } from "@/application/marketing-service";
import { getAppConfig, getTelegramConfig } from "@/server/config";
import { TelegramNotificationDispatcher } from "@/server/notifications/telegram-notification-dispatcher";
import { SupabaseMarketingRepository } from "@/server/repositories/supabase-marketing-repository";

let service: MarketingService | undefined;

export function getMarketingService(): MarketingService {
  if (!service) {
    const appConfig = getAppConfig();
    const telegramConfig = getTelegramConfig();
    service = new MarketingService(
      new SupabaseMarketingRepository(),
      new TelegramNotificationDispatcher(telegramConfig.botToken, appConfig.appUrl),
    );
  }
  return service;
}

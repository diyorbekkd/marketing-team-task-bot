import "server-only";

import { MarketingService } from "@/application/marketing-service";
import { getAppConfig, getTelegramConfig } from "@/server/config";
import { TelegramNotificationDispatcher } from "@/server/notifications/telegram-notification-dispatcher";
import { SupabaseMarketingRepository } from "@/server/repositories/supabase-marketing-repository";
import { ReportingService } from "@/application/reporting-service";
import { ReminderService } from "@/application/reminder-service";

let service: MarketingService | undefined;
let reportingService: ReportingService | undefined;
let reminderService: ReminderService | undefined;
let dispatcher: TelegramNotificationDispatcher | undefined;

function getDispatcher() {
  if (!dispatcher) {
    const appConfig = getAppConfig();
    const telegramConfig = getTelegramConfig();
    dispatcher = new TelegramNotificationDispatcher(telegramConfig.botToken, appConfig.appUrl);
  }
  return dispatcher;
}

export function getMarketingService(): MarketingService {
  if (!service) {
    service = new MarketingService(
      new SupabaseMarketingRepository(),
      getDispatcher(),
    );
  }
  return service;
}

export function getReportingService(): ReportingService {
  if (!reportingService) {
    reportingService = new ReportingService(new SupabaseMarketingRepository(), getDispatcher());
  }
  return reportingService;
}

export function getReminderService(): ReminderService {
  if (!reminderService) {
    reminderService = new ReminderService(new SupabaseMarketingRepository(), getDispatcher());
  }
  return reminderService;
}

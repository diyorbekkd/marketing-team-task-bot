import "server-only";

import { MarketingService } from "@/application/marketing-service";
import { getAppConfig, getTelegramConfig } from "@/server/config";
import { TelegramNotificationDispatcher } from "@/server/notifications/telegram-notification-dispatcher";
import { SupabaseMarketingRepository } from "@/server/repositories/supabase-marketing-repository";
import { ReportingService } from "@/application/reporting-service";
import { ReminderService } from "@/application/reminder-service";
import { NotificationRetryService, ReliableNotificationDispatcher } from "@/server/notifications/reliable-notification-dispatcher";

let service: MarketingService | undefined;
let reportingService: ReportingService | undefined;
let reminderService: ReminderService | undefined;
let telegramDispatcher: TelegramNotificationDispatcher | undefined;
let reliableDispatcher: ReliableNotificationDispatcher | undefined;
let notificationRetryService: NotificationRetryService | undefined;

function getTelegramDispatcher() {
  if (!telegramDispatcher) {
    const appConfig = getAppConfig();
    const telegramConfig = getTelegramConfig();
    telegramDispatcher = new TelegramNotificationDispatcher(telegramConfig.botToken, appConfig.appUrl);
  }
  return telegramDispatcher;
}

function getReliableDispatcher() {
  if (!reliableDispatcher) {
    reliableDispatcher = new ReliableNotificationDispatcher(
      new SupabaseMarketingRepository(),
      getTelegramDispatcher(),
    );
  }
  return reliableDispatcher;
}

export function getMarketingService(): MarketingService {
  if (!service) {
    service = new MarketingService(
      new SupabaseMarketingRepository(),
      getReliableDispatcher(),
      getReliableDispatcher(),
    );
  }
  return service;
}

export function getReportingService(): ReportingService {
  if (!reportingService) {
    reportingService = new ReportingService(new SupabaseMarketingRepository(), getReliableDispatcher());
  }
  return reportingService;
}

export function getReminderService(): ReminderService {
  if (!reminderService) {
    reminderService = new ReminderService(new SupabaseMarketingRepository(), getReliableDispatcher());
  }
  return reminderService;
}

export function getNotificationRetryService(): NotificationRetryService {
  if (!notificationRetryService) {
    notificationRetryService = new NotificationRetryService(
      new SupabaseMarketingRepository(),
      getTelegramDispatcher(),
    );
  }
  return notificationRetryService;
}

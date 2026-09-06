import "server-only";

import { MarketingService } from "@/application/marketing-service";
import { SupabaseMarketingRepository } from "@/server/repositories/supabase-marketing-repository";

let service: MarketingService | undefined;

export function getMarketingService(): MarketingService {
  if (!service) {
    service = new MarketingService(new SupabaseMarketingRepository());
  }
  return service;
}

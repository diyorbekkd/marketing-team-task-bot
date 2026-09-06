import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/server/config";

let adminClient: ReturnType<typeof createClient> | undefined;

export function getSupabaseAdminClient() {
  if (!adminClient) {
    const config = getSupabaseConfig();
    adminClient = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
}

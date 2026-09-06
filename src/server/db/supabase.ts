import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/server/config";
import type { Database } from "./database.types";

let adminClient: SupabaseClient<Database> | undefined;

export function getSupabaseAdminClient() {
  if (!adminClient) {
    const config = getSupabaseConfig();
    adminClient = createClient<Database>(config.url, config.secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
}

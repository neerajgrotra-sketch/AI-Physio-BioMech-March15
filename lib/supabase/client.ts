// lib/supabase/client.ts
// Browser-side Supabase client — module-level singleton.
// createBrowserClient from @supabase/ssr is designed to be created once and
// reused. Creating a new instance on every call causes session loss mid-request,
// which makes auth.uid() return null inside RLS policies.

import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

// Alias for any code using createClient() directly
export const createClient = getSupabaseClient;

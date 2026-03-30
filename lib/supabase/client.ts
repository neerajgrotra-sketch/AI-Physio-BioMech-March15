// lib/supabase/client.ts
// Browser-side Supabase client — module-level singleton.
// Singleton pattern prevents session loss mid-request (auth.uid() returning
// null in RLS policies when a fresh client is created per call).
// Guard ensures this never runs during SSR / static prerender.

import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseClient() {
  if (typeof window === 'undefined') {
    // SSR / prerender path — return a fresh client each time.
    // This path is only hit during build-time static generation;
    // env vars may not be present, so we guard gracefully.
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
    );
  }

  // Browser path — singleton so session is never lost between calls
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

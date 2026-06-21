import type { SupabaseClient } from "@supabase/supabase-js";

const viteEnv = ("env" in import.meta ? import.meta.env : {}) as Partial<Record<"VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY", string>>;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function getSupabaseRuntimeInfo() {
  return {
    urlPresent: Boolean(supabaseUrl),
    anonKeyPresent: Boolean(supabaseAnonKey),
    configured: isSupabaseConfigured,
  };
}

let supabaseClientPromise: Promise<SupabaseClient | null> | null = null;

export async function getSupabaseClient() {
  if (!isSupabaseConfigured) return null;
  if (!supabaseClientPromise) {
    supabaseClientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      }),
    );
  }
  return supabaseClientPromise;
}

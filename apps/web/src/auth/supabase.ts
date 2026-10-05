/**
 * Supabase Auth adapter (magic link, PKCE). The only place in the web app
 * that knows about Supabase; switching to another OIDC provider means adding
 * a sibling adapter, not touching pages or modules.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function supabaseClient(url: string, anonKey: string): SupabaseClient {
  client ??= createClient(url, anonKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export async function sendMagicLink(
  url: string,
  anonKey: string,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { error } = await supabaseClient(url, anonKey).auth.signInWithOtp({
    email,
    // No public sign-up: only users created from ALLOWED_EMAILS (pnpm deploy:setup) can sign in.
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  if (error)
    throw new Error(
      error.message === 'Signups not allowed for otp'
        ? 'Tällä sähköpostiosoitteella ei ole pääsyä palveluun.'
        : error.message,
    );
}

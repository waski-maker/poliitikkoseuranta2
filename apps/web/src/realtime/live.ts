/**
 * Live updates for jobs and notifications. Adapter chosen by the API
 * (/config.realtime): Supabase Realtime (row changes, RLS applies) or polling.
 */
import * as React from 'react';
import { useQueryClient } from '@ps/sdk/react';
import { useAuth } from '../auth/AuthProvider.tsx';

export function usePollInterval(active: boolean): number | false {
  const { config } = useAuth();
  if (!active) return false;
  const provider = config?.realtime.provider;
  // With Supabase Realtime, polling is only a slow safety net.
  return provider === 'supabase' ? 15_000 : Number(config?.realtime.intervalMs ?? 3000);
}

/** Subscribes to Supabase Realtime changes and invalidates matching queries. */
export function useRealtimeInvalidation(): void {
  const { config, status } = useAuth();
  const qc = useQueryClient();
  React.useEffect(() => {
    if (status !== 'signedIn' || config?.realtime.provider !== 'supabase') return;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const { supabaseClient } = await import('../auth/supabase.ts');
      const sb = supabaseClient(String(config.realtime.url), String(config.realtime.anonKey));
      const channel = sb
        .channel('ps-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'core', table: 'jobs' },
          () => void qc.invalidateQueries({ queryKey: ['jobs'] }),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'core', table: 'notifications' },
          () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
        )
        .subscribe();
      cleanup = () => void sb.removeChannel(channel);
    })();
    return () => cleanup?.();
  }, [config, status, qc]);
}

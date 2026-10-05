import type { RealtimeAdapter } from '../types.ts';

/** Supabase Realtime: the browser subscribes to row changes of core.jobs / core.notifications (RLS applies). */
export function supabaseRealtime(opts: {
  url: string;
  anonKey: string;
  fetch?: typeof fetch;
}): RealtimeAdapter {
  const f = opts.fetch ?? fetch;
  return {
    provider: 'supabase',
    clientConfig: () => ({ provider: 'supabase', url: opts.url, anonKey: opts.anonKey }),
    async test() {
      try {
        const res = await f(`${opts.url.replace(/\/$/, '')}/rest/v1/`, { headers: { apikey: opts.anonKey } });
        return res.status < 500
          ? { ok: true, message: 'Supabase vastaa' }
          : { ok: false, message: `Supabase: HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Polling fallback: the browser asks the API for changes every few seconds. Works everywhere. */
export function pollingRealtime(intervalMs = 3000): RealtimeAdapter {
  return {
    provider: 'polling',
    clientConfig: () => ({ provider: 'polling', intervalMs }),
    async test() {
      return { ok: true, message: `Muutokset haetaan ${intervalMs / 1000} s välein` };
    },
  };
}

/** Holds the current access token for the SDK client (memory + optional storage for dev tokens). */
let token: string | null = null;
let refresh: (() => Promise<string | null>) | null = null;

export const tokenStore = {
  get: async (): Promise<string | null> => (refresh ? await refresh() : token),
  set(t: string | null) {
    token = t;
  },
  /** Supabase refreshes tokens itself; the getter asks it for the current one. */
  useRefresher(fn: (() => Promise<string | null>) | null) {
    refresh = fn;
  },
};

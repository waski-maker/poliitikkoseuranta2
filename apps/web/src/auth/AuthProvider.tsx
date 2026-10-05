import * as React from 'react';
import { unwrap, type ApiClient, type Schemas } from '@ps/sdk';
import { tokenStore } from './token-store.ts';
import { env } from '../env.ts';

type User = Schemas['CurrentUser'];
type ClientConfig = Schemas['ClientConfig'];

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn' | 'denied' | 'unavailable';
  user: User | null;
  config: ClientConfig | null;
  error: string | null;
  signInDev(email: string): Promise<void>;
  sendLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  can(permission: string): boolean;
}

const Ctx = React.createContext<AuthState | null>(null);
const DEV_TOKEN_KEY = 'ps-dev-token';

export function AuthProvider({ api, children }: { api: ApiClient; children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthState['status']>('loading');
  const [user, setUser] = React.useState<User | null>(null);
  const [config, setConfig] = React.useState<ClientConfig | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const establish = React.useCallback(async () => {
    try {
      const u = await unwrap(api.POST('/auth/session'));
      setUser(u);
      setStatus('signedIn');
    } catch (e) {
      const st = (e as { status?: number }).status;
      setUser(null);
      setStatus(st === 403 ? 'denied' : 'signedOut');
      if (st !== 401 && st !== 403) setError((e as Error).message);
    }
  }, [api]);

  React.useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      let cfg: ClientConfig;
      try {
        cfg = await unwrap(api.GET('/config'));
      } catch (e) {
        setError((e as Error).message);
        setStatus('unavailable');
        return;
      }
      setConfig(cfg);
      const provider = cfg.auth.provider as string;
      if (provider === 'supabase') {
        const { supabaseClient } = await import('./supabase.ts');
        const sb = supabaseClient(String(cfg.auth.url), String(cfg.auth.anonKey));
        tokenStore.useRefresher(async () => (await sb.auth.getSession()).data.session?.access_token ?? null);
        const { data } = await sb.auth.getSession();
        if (data.session) await establish();
        else setStatus('signedOut');
        const sub = sb.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_IN') void establish();
          if (event === 'SIGNED_OUT') {
            setUser(null);
            setStatus('signedOut');
          }
        });
        unsub = () => sub.data.subscription.unsubscribe();
      } else {
        const saved = localStorage.getItem(DEV_TOKEN_KEY);
        tokenStore.set(saved);
        if (saved) await establish();
        else setStatus('signedOut');
      }
    })();
    return () => unsub?.();
  }, [api, establish]);

  const value: AuthState = {
    status,
    user,
    config,
    error,
    async signInDev(email) {
      setError(null);
      try {
        const r = await unwrap(api.POST('/auth/dev-login', { body: { email } }));
        localStorage.setItem(DEV_TOKEN_KEY, r.token);
        tokenStore.set(r.token);
        setUser(r.user);
        setStatus('signedIn');
      } catch (e) {
        setError((e as Error).message);
      }
    },
    async sendLink(email) {
      setError(null);
      const { sendMagicLink } = await import('./supabase.ts');
      await sendMagicLink(
        String(config!.auth.url),
        String(config!.auth.anonKey),
        email,
        `${window.location.origin}${env.basePath}`,
      );
    },
    async signOut() {
      if ((config?.auth.provider as string) === 'supabase') {
        const { supabaseClient } = await import('./supabase.ts');
        await supabaseClient(String(config!.auth.url), String(config!.auth.anonKey)).auth.signOut();
      }
      localStorage.removeItem(DEV_TOKEN_KEY);
      tokenStore.set(null);
      setUser(null);
      setStatus('signedOut');
    },
    can: (p) => Boolean(user && (user.isAdmin || user.permissions.includes(p))),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

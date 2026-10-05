import * as React from 'react';
import { Button, Field, Input, useTheme } from '@ps/ui';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { t } from '../i18n.ts';

export function LoginPage() {
  const auth = useAuth();
  const { resolved, toggle } = useTheme();
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const provider = auth.config?.auth.provider as string | undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (provider === 'supabase') {
        await auth.sendLink(email);
        setSent(true);
      } else {
        await auth.signInDev(email);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center bg-bg px-4">
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-4 top-4"
        onClick={toggle}
        aria-label={t('theme.toggle')}
      >
        {resolved === 'dark' ? <Sun /> : <Moon />}
      </Button>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-accent text-base font-bold text-accent-fg">
            P
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight">{t('app.name')}</div>
            <div className="text-xs text-subtle">Suomalaisen politiikan avoimen datan seuranta</div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{t('auth.title')}</h1>
          {auth.status === 'unavailable' ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              Palvelimeen ei saada yhteyttä. {auth.error}
            </p>
          ) : sent ? (
            <p className="mt-3 text-sm text-muted">{t('auth.linkSent')}</p>
          ) : (
            <form onSubmit={submit} className="mt-4 grid gap-4">
              <Field label={t('auth.email')} htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {auth.status === 'denied' ? (
                <p role="alert" className="text-sm text-danger">
                  {t('auth.notAllowed')}
                </p>
              ) : null}
              {error || auth.error ? (
                <p role="alert" className="text-sm text-danger">
                  {error ?? auth.error}
                </p>
              ) : null}
              <Button type="submit" variant="primary" loading={busy}>
                {provider === 'supabase' ? t('auth.sendLink') : t('auth.devLogin')}
              </Button>
              {provider === 'dev' ? (
                <p className="text-xs text-subtle">
                  Kehitystila: kirjautuminen ilman sähköpostia. Vain sallittujen listalla olevat osoitteet
                  pääsevät sisään.
                </p>
              ) : null}
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-subtle">Pääsy vain kutsutuille käyttäjille.</p>
      </div>
    </div>
  );
}

import type { MailAdapter, MailMessage, TestResult } from '../types.ts';
import type { Logger } from '../../util/log.ts';

/**
 * Supabase Auth sends sign-in links itself; it does not deliver application
 * mail. send() therefore only logs and returns false.
 */
export function supabaseAuthMail(log: Logger): MailAdapter {
  return {
    provider: 'supabase-auth',
    async send(msg) {
      log.info('mail not sent: supabase-auth handles only sign-in emails', { subject: msg.subject });
      return false;
    },
    async test(): Promise<TestResult> {
      return {
        ok: true,
        message: 'Kirjautumissähköpostit lähettää Supabase Auth; sovelluksen omia viestejä ei lähetetä',
      };
    },
  };
}

export function consoleMail(log: Logger): MailAdapter {
  return {
    provider: 'console',
    async send(msg: MailMessage) {
      log.info('mail (console)', { to: msg.to, subject: msg.subject, text: msg.text });
      return true;
    },
    async test() {
      return { ok: true, message: 'Viestit kirjoitetaan palvelimen lokiin (kehityskäyttö)' };
    },
  };
}

/** Resend HTTP API. SendGrid/Postmark/SMTP can be added as further adapters. */
export function resendMail(opts: { apiKey: string; from: string; fetch?: typeof fetch }): MailAdapter {
  const f = opts.fetch ?? fetch;
  return {
    provider: 'resend',
    async send(msg) {
      const res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: opts.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
      });
      if (!res.ok) throw new Error(`Resend: HTTP ${res.status} ${await res.text()}`);
      return true;
    },
    async test() {
      const res = await f('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${opts.apiKey}` },
      });
      return res.ok
        ? { ok: true, message: 'Resend-avain toimii' }
        : { ok: false, message: `Resend: HTTP ${res.status}` };
    },
  };
}

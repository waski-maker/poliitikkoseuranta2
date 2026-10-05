import { sleep } from '../util/time.ts';

export interface HttpClientOptions {
  baseUrl?: string;
  userAgent: string;
  /** Minimum delay between requests (simple rate limiting). */
  minIntervalMs?: number;
  /** Optional sliding-window limit, e.g. { max: 430, perMs: 3_000_000 }. */
  window?: { max: number; perMs: number };
  retries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  onWarning?: (message: string) => void;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 300)}`);
  }
}

/**
 * Polite HTTP client for external data sources: rate limiting, retries with
 * exponential backoff (429/5xx/network), Retry-After support and detection of
 * deprecation headers (Deprecation / Sunset / Warning).
 */
export class HttpClient {
  private last = 0;
  private calls: number[] = [];
  private readonly f: typeof fetch;

  constructor(private readonly opts: HttpClientOptions) {
    this.f = opts.fetch ?? fetch;
  }

  url(path: string): string {
    return this.opts.baseUrl ? new URL(path, this.opts.baseUrl).href : path;
  }

  private async throttle(): Promise<void> {
    const min = this.opts.minIntervalMs ?? 0;
    const wait = this.last + min - Date.now();
    if (wait > 0) await sleep(wait);
    if (this.opts.window) {
      const { max, perMs } = this.opts.window;
      const now = Date.now();
      this.calls = this.calls.filter((t) => now - t < perMs);
      if (this.calls.length >= max) await sleep(perMs - (now - this.calls[0]!) + 50);
      this.calls.push(Date.now());
    }
    this.last = Date.now();
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = this.url(path);
    const retries = this.opts.retries ?? 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.throttle();
      let res: Response;
      try {
        res = await this.f(url, {
          ...init,
          headers: {
            'User-Agent': this.opts.userAgent,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers as Record<string, string> | undefined),
          },
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
        });
      } catch (err) {
        lastErr = err;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      this.checkDeprecation(res, url);
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await res.body?.cancel();
        lastErr = new HttpError(res.status, url, '');
        if (attempt < retries) {
          await sleep(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 120_000)
              : 1000 * 2 ** attempt,
          );
          continue;
        }
      }
      return res;
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async json<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(path, init);
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, this.url(path), text);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON from ${this.url(path)}`);
    }
  }

  postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.json<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private checkDeprecation(res: Response, url: string): void {
    const dep = res.headers.get('deprecation') ?? res.headers.get('sunset');
    const warn = res.headers.get('warning');
    if (dep || (warn && /deprecat/i.test(warn))) {
      this.opts.onWarning?.(`Rajapinta ilmoittaa vanhentumisesta (${url}): ${dep ?? warn}`);
    }
  }
}

import type { Dirent } from 'node:fs';
import { AwsClient } from 'aws4fetch';
import type { StorageAdapter, TestResult } from '../types.ts';
import { hmacSha256, toBase64Url } from '../../util/crypto.ts';

const enc = new TextEncoder();

function safeKey(key: string): string {
  if (key.includes('..') || key.startsWith('/')) throw new Error(`Invalid storage key ${key}`);
  return key;
}

async function roundTrip(a: StorageAdapter): Promise<TestResult> {
  const key = `_healthcheck/${Date.now()}.txt`;
  try {
    await a.put(key, enc.encode('ok'), 'text/plain');
    const back = await a.get(key);
    await a.delete(key);
    if (!back || new TextDecoder().decode(back) !== 'ok')
      return { ok: false, message: 'Luettu sisältö ei vastannut kirjoitettua' };
    return { ok: true, message: 'Kirjoitus, luku ja poisto onnistuivat' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** In-memory storage for tests. */
export function memoryStorage(): StorageAdapter {
  const files = new Map<string, { bytes: Uint8Array; at: string }>();
  const a: StorageAdapter = {
    provider: 'memory',
    async put(key, bytes) {
      files.set(safeKey(key), { bytes, at: new Date().toISOString() });
    },
    async get(key) {
      return files.get(key)?.bytes ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
    async list(prefix) {
      return [...files.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, v]) => ({ key, size: v.bytes.length, updatedAt: v.at }));
    },
    async signedUrl() {
      return null;
    },
    test: () => roundTrip(a),
  };
  return a;
}

/**
 * Local disk storage (self-hosted servers, development). Downloads go through
 * the API with an HMAC-signed, expiring token (see /api/v1/files/{token}).
 */
export function diskStorage(opts: { dir: string; signingKey: string; publicApiUrl: string }): StorageAdapter {
  const fs = () => import('node:fs/promises');
  const path = () => import('node:path');
  const full = async (key: string) => (await path()).join(opts.dir, safeKey(key));
  const a: StorageAdapter = {
    provider: 'local',
    async put(key, bytes) {
      const f = await full(key);
      await (await fs()).mkdir((await path()).dirname(f), { recursive: true });
      await (await fs()).writeFile(f, bytes);
    },
    async get(key) {
      try {
        return new Uint8Array(await (await fs()).readFile(await full(key)));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await (await fs()).rm(await full(key), { force: true });
    },
    async list(prefix) {
      const p = await path();
      const root = opts.dir;
      const out: { key: string; size: number; updatedAt: string | null }[] = [];
      const walk = async (dir: string) => {
        let entries: Dirent[] = [];
        try {
          entries = await (await fs()).readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const f = p.join(dir, e.name);
          if (e.isDirectory()) await walk(f);
          else {
            const key = p.relative(root, f).split(p.sep).join('/');
            if (key.startsWith(prefix)) {
              const st = await (await fs()).stat(f);
              out.push({ key, size: st.size, updatedAt: st.mtime.toISOString() });
            }
          }
        }
      };
      await walk(root);
      return out;
    },
    async signedUrl(key, expiresInSec) {
      const exp = Math.floor(Date.now() / 1000) + expiresInSec;
      const payload = `${key}|${exp}`;
      const sig = toBase64Url(await hmacSha256(opts.signingKey, payload));
      const token = `${toBase64Url(enc.encode(payload))}.${sig}`;
      return `${opts.publicApiUrl.replace(/\/$/, '')}/api/v1/files/${token}`;
    },
    test: () => roundTrip(a),
  };
  return a;
}

/** Verifies a token produced by diskStorage().signedUrl. Returns the key or null. */
export async function verifyFileToken(token: string, signingKey: string): Promise<string | null> {
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const { fromBase64Url } = await import('../../util/crypto.ts');
  const payload = new TextDecoder().decode(fromBase64Url(p));
  const expected = toBase64Url(await hmacSha256(signingKey, payload));
  if (expected !== sig) return null;
  const [key, exp] = payload.split('|');
  if (!key || Number(exp) < Date.now() / 1000) return null;
  return key;
}

/** Supabase Storage through its REST API (no SDK, works on any runtime). */
export function supabaseStorage(opts: {
  url: string;
  serviceKey: string;
  bucket: string;
  fetch?: typeof fetch;
}): StorageAdapter {
  const f = opts.fetch ?? fetch;
  const base = `${opts.url.replace(/\/$/, '')}/storage/v1`;
  const headers = { Authorization: `Bearer ${opts.serviceKey}`, apikey: opts.serviceKey };
  const obj = (key: string) =>
    `${base}/object/${opts.bucket}/${safeKey(key).split('/').map(encodeURIComponent).join('/')}`;
  const a: StorageAdapter = {
    provider: 'supabase',
    async put(key, bytes, contentType) {
      const res = await f(obj(key), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true' },
        body: bytes as BodyInit,
      });
      if (!res.ok) throw new Error(`Supabase Storage: HTTP ${res.status} ${await res.text()}`);
    },
    async get(key) {
      const res = await f(obj(key), { headers });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Supabase Storage: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      await f(`${base}/object/${opts.bucket}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [key] }),
      });
    },
    async list(prefix) {
      const dir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
      const res = await f(`${base}/object/list/${opts.bucket}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: dir, limit: 1000 }),
      });
      if (!res.ok) throw new Error(`Supabase Storage: HTTP ${res.status}`);
      const items = (await res.json()) as {
        name: string;
        updated_at?: string;
        metadata?: { size?: number };
      }[];
      return items
        .map((i) => ({
          key: dir ? `${dir}/${i.name}` : i.name,
          size: i.metadata?.size ?? 0,
          updatedAt: i.updated_at ?? null,
        }))
        .filter((i) => i.key.startsWith(prefix));
    },
    async signedUrl(key, expiresInSec) {
      const res = await f(`${base}/object/sign/${opts.bucket}/${safeKey(key)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSec }),
      });
      if (!res.ok) return null;
      const { signedURL } = (await res.json()) as { signedURL: string };
      return `${opts.url.replace(/\/$/, '')}/storage/v1${signedURL}`;
    },
    test: () => roundTrip(a),
  };
  return a;
}

/** Any S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Hetzner, …). */
export function s3Storage(opts: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  provider?: string;
}): StorageAdapter {
  const aws = new AwsClient({
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    region: opts.region,
    service: 's3',
  });
  const url = (key: string) =>
    `${opts.endpoint.replace(/\/$/, '')}/${opts.bucket}/${safeKey(key).split('/').map(encodeURIComponent).join('/')}`;
  const a: StorageAdapter = {
    provider: opts.provider ?? 's3',
    async put(key, bytes, contentType) {
      const res = await aws.fetch(url(key), {
        method: 'PUT',
        body: bytes as BodyInit,
        headers: { 'Content-Type': contentType },
      });
      if (!res.ok) throw new Error(`S3: HTTP ${res.status} ${await res.text()}`);
    },
    async get(key) {
      const res = await aws.fetch(url(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      await aws.fetch(url(key), { method: 'DELETE' });
    },
    async list(prefix) {
      const res = await aws.fetch(
        `${opts.endpoint.replace(/\/$/, '')}/${opts.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`,
      );
      if (!res.ok) throw new Error(`S3: HTTP ${res.status}`);
      const xml = await res.text();
      return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
        key: /<Key>([^<]*)<\/Key>/.exec(m[1]!)?.[1] ?? '',
        size: Number(/<Size>(\d+)<\/Size>/.exec(m[1]!)?.[1] ?? 0),
        updatedAt: /<LastModified>([^<]*)<\/LastModified>/.exec(m[1]!)?.[1] ?? null,
      }));
    },
    async signedUrl(key, expiresInSec) {
      const u = new URL(url(key));
      u.searchParams.set('X-Amz-Expires', String(expiresInSec));
      const signed = await aws.sign(u.toString(), { method: 'GET', aws: { signQuery: true } });
      return signed.url;
    },
    test: () => roundTrip(a),
  };
  return a;
}

// Portable crypto helpers on top of WebCrypto (Node 20+, Deno, Bun, browsers).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return fromBase64(b64);
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function importAesKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyB64);
  if (raw.length !== 32) throw new Error('Encryption key must be 32 bytes (base64-encoded)');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Envelope: "PSB1" magic | 12-byte IV | ciphertext+tag. Same format as the Node streaming encryptor. */
export const ENVELOPE_MAGIC = new Uint8Array([0x50, 0x53, 0x42, 0x31]);

export async function encryptBytes(plain: Uint8Array, keyB64: string): Promise<Uint8Array> {
  const key = await importAesKey(keyB64);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource),
  );
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(ENVELOPE_MAGIC, 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

export async function decryptBytes(envelope: Uint8Array, keyB64: string): Promise<Uint8Array> {
  for (let i = 0; i < 4; i++) {
    if (envelope[i] !== ENVELOPE_MAGIC[i]) throw new Error('Not an encrypted Poliitikkoseuranta envelope');
  }
  const key = await importAesKey(keyB64);
  const iv = envelope.slice(4, 16);
  const ct = envelope.slice(16);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource),
  );
}

export async function encryptString(plain: string, keyB64: string): Promise<string> {
  return toBase64(await encryptBytes(enc.encode(plain), keyB64));
}

export async function decryptString(cipherB64: string, keyB64: string): Promise<string> {
  return dec.decode(await decryptBytes(fromBase64(cipherB64), keyB64));
}

export async function hmacSha256(keyB64OrText: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyB64OrText) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data) as BufferSource));
}

export function generateKeyB64(): string {
  return toBase64(randomBytes(32));
}

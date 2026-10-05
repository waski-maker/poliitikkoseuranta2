import type { Db } from '../db/client.ts';
import { decryptString, encryptString } from '../util/crypto.ts';

/**
 * Module- and core-level settings (JSON) plus encrypted secrets. Secrets are
 * encrypted with SETTINGS_ENCRYPTION_KEY (AES-256-GCM) before they reach the
 * database and are never returned to the browser — only "is set" flags.
 */
export class SettingsStore {
  constructor(
    private readonly db: Db,
    private readonly encryptionKey: string | undefined,
  ) {}

  async get<T>(scope: string, key: string, fallback: T): Promise<T> {
    const [row] = await this.db<{ value: T }[]>`
      select value from core.settings where scope = ${scope} and key = ${key}`;
    return row ? row.value : fallback;
  }

  async getAll(scope: string): Promise<Record<string, unknown>> {
    const rows = await this.db<{ key: string; value: unknown }[]>`
      select key, value from core.settings where scope = ${scope}`;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async set(scope: string, key: string, value: unknown, userId?: string | null): Promise<void> {
    await this.db`
      insert into core.settings (scope, key, value, updated_by)
      values (${scope}, ${key}, ${this.db.json(value as never)}, ${userId ?? null})
      on conflict (scope, key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
  }

  async delete(scope: string, key: string): Promise<void> {
    await this.db`delete from core.settings where scope = ${scope} and key = ${key}`;
  }

  async setSecret(scope: string, key: string, value: string, userId?: string | null): Promise<void> {
    if (!this.encryptionKey)
      throw new Error('SETTINGS_ENCRYPTION_KEY puuttuu: salaisuuksia ei voi tallentaa');
    const ciphertext = await encryptString(value, this.encryptionKey);
    await this.db`
      insert into core.secrets (scope, key, ciphertext, updated_by)
      values (${scope}, ${key}, ${ciphertext}, ${userId ?? null})
      on conflict (scope, key) do update set ciphertext = excluded.ciphertext, updated_at = now(), updated_by = excluded.updated_by`;
  }

  async getSecret(scope: string, key: string): Promise<string | null> {
    const [row] = await this.db<{ ciphertext: string }[]>`
      select ciphertext from core.secrets where scope = ${scope} and key = ${key}`;
    if (!row) return null;
    if (!this.encryptionKey) throw new Error('SETTINGS_ENCRYPTION_KEY puuttuu: salaisuutta ei voi lukea');
    return decryptString(row.ciphertext, this.encryptionKey);
  }

  async deleteSecret(scope: string, key: string): Promise<void> {
    await this.db`delete from core.secrets where scope = ${scope} and key = ${key}`;
  }

  async secretKeys(scope: string): Promise<string[]> {
    const rows = await this.db<{ key: string }[]>`select key from core.secrets where scope = ${scope}`;
    return rows.map((r) => r.key);
  }
}

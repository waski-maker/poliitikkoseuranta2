import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRuntime, syncPermissions, type Runtime, type Sql } from '@ps/core';
import { databaseAvailable, resetDatabase, testConfig } from '@ps/core/testing';
import { createApp } from '../src/app.ts';
import { serverModules } from '../src/modules.ts';
import { buildOpenApiDocument } from '../src/openapi.ts';

const available = await databaseAvailable();

describe('OpenAPI document', () => {
  it('describes core and module endpoints without a database', async () => {
    const doc = (await buildOpenApiDocument()) as { paths: Record<string, unknown>; openapi: string };
    expect(doc.openapi).toBe('3.1.0');
    for (const p of [
      '/health',
      '/search',
      '/jobs',
      '/services',
      '/ai/settings',
      '/backups',
      '/registries/parties',
      '/registries/parties/{id}',
    ]) {
      expect(doc.paths, p).toHaveProperty(p);
    }
  });
});

describe.skipIf(!available)('REST API', () => {
  let sql: Sql;
  let rt: Runtime;
  let app: ReturnType<typeof createApp>;
  let adminToken = '';
  let readerToken = '';

  const call = (path: string, init: RequestInit & { token?: string } = {}) =>
    app.request(`/api/v1${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
    });

  beforeAll(async () => {
    sql = await resetDatabase();
    rt = await createRuntime({
      config: testConfig({ AI_PROVIDER: 'mock' }),
      sql,
      modules: serverModules,
      host: 'test',
      forceMemoryStorage: true,
    });
    await syncPermissions(sql, rt.registry.manifests());
    for (const m of rt.registry.list()) await m.seed?.(rt);
    app = createApp(rt);
    const login = async (email: string) => {
      const r = await call('/auth/dev-login', { method: 'POST', body: JSON.stringify({ email }) });
      expect(r.status).toBe(200);
      return ((await r.json()) as { token: string }).token;
    };
    adminToken = await login('admin@example.com');
    readerToken = await login('reader@example.com');
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('returns no data without a valid login', async () => {
    for (const p of [
      '/registries/parties',
      '/search?q=kokoomus',
      '/jobs',
      '/services',
      '/backups',
      '/me',
      '/modules',
      '/events',
    ]) {
      expect((await call(p)).status, p).toBe(401);
      expect((await call(p, { token: 'garbage.token.value' })).status, p).toBe(401);
    }
    const r = await call('/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email: 'outsider@example.com' }),
    });
    expect(r.status).toBe(403);
  });

  it('public endpoints expose no data', async () => {
    const h = await call('/health');
    expect(h.status).toBe(200);
    const c = (await (await call('/config')).json()) as Record<string, unknown>;
    expect(Object.keys(c).sort()).toEqual(['auth', 'realtime', 'version']);
  });

  it('first user is admin; second is reader', async () => {
    const me = (await (await call('/me', { token: adminToken })).json()) as { isAdmin: boolean };
    expect(me.isAdmin).toBe(true);
    const r = (await (await call('/me', { token: readerToken })).json()) as { roles: string[] };
    expect(r.roles).toEqual(['reader']);
  });

  it('CRUD on parties with permission checks and soft delete', async () => {
    const list = (await (await call('/registries/parties', { token: readerToken })).json()) as {
      items: { abbreviation: string }[];
    };
    expect(list.items.map((p) => p.abbreviation)).toContain('VIHR');
    const denied = await call('/registries/parties', {
      method: 'POST',
      token: readerToken,
      body: JSON.stringify({ abbreviation: 'X', nameFi: 'X' }),
    });
    expect(denied.status).toBe(403);
    const bad = await call('/registries/parties', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ abbreviation: 'X', nameFi: 'X', color: 'red' }),
    });
    expect(bad.status).toBe(400);
    const created = await call('/registries/parties', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        abbreviation: 'UUSI',
        nameFi: 'Uusi puolue',
        status: 'active',
        color: '#AABBCC',
      }),
    });
    expect(created.status).toBe(201);
    const party = (await created.json()) as { id: string; source: string };
    expect(party.source).toBe('manual');
    const dup = await call('/registries/parties', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ abbreviation: 'uusi', nameFi: 'Kopio' }),
    });
    expect(dup.status).toBe(409);
    const patched = await call(`/registries/parties/${party.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ notes: 'muistiinpano' }),
    });
    expect(((await patched.json()) as { notes: string }).notes).toBe('muistiinpano');
    const since = new Date(Date.now() - 1000).toISOString();
    expect(
      (await call(`/registries/parties/${party.id}`, { method: 'DELETE', token: adminToken })).status,
    ).toBe(204);
    expect((await call(`/registries/parties/${party.id}`, { token: readerToken })).status).toBe(404);
    // updated_since returns deletions too, so offline clients can sync them.
    const changes = (await (
      await call(`/registries/parties?updated_since=${encodeURIComponent(since)}`, { token: adminToken })
    ).json()) as {
      items: { id: string; deletedAt: string | null }[];
    };
    expect(changes.items.find((i) => i.id === party.id)?.deletedAt).toBeTruthy();
    expect(
      (await call(`/registries/parties/${party.id}/restore`, { method: 'POST', token: adminToken })).status,
    ).toBe(204);
    const hist = (await (
      await call(`/audit?table=m0001_registries.parties&recordId=${party.id}`, { token: adminToken })
    ).json()) as {
      items: { action: string }[];
    };
    expect(hist.items.map((h) => h.action)).toEqual(
      expect.arrayContaining(['insert', 'update', 'soft_delete', 'restore']),
    );
  });

  it('global search finds inflected Finnish forms', async () => {
    const r = (await (await call('/search?q=kristillisdemokraatteja', { token: readerToken })).json()) as {
      hits: { title: string }[];
    };
    expect(r.hits.some((h) => h.title.includes('Kristillisdemokraatit'))).toBe(true);
  });

  it('AI settings, connection test and usage tracking work with the mock provider', async () => {
    const s = (await (await call('/ai/settings', { token: adminToken })).json()) as {
      settings: { tasks: { default: { provider: string } } };
    };
    expect(s.settings.tasks.default.provider).toBe('mock');
    const t = (await (
      await call('/ai/providers/mock/test', { method: 'POST', token: adminToken, body: '{}' })
    ).json()) as { ok: boolean };
    expect(t.ok).toBe(true);
    const c = await call('/ai/complete', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ prompt: 'Tiivistä [#x1]' }),
    });
    expect(((await c.json()) as { text: string }).text).toContain('[#x1]');
    const u = (await (await call('/ai/usage', { token: adminToken })).json()) as {
      items: { provider: string; calls: number }[];
    };
    expect(u.items.find((i) => i.provider === 'mock')?.calls).toBeGreaterThan(0);
    expect((await call('/ai/settings', { token: readerToken })).status).toBe(403);
  });

  it('switching the AI provider in settings is used immediately', async () => {
    const s = (await (await call('/ai/settings', { token: adminToken })).json()) as {
      settings: Record<string, unknown>;
    };
    const settings = s.settings as {
      tasks: { default: { provider: string; model: string } };
      providers: unknown[];
    };
    settings.providers.push({ name: 'toinen', kind: 'mock', defaultModel: 'mock-2', internal: true });
    settings.tasks.default = { provider: 'toinen', model: 'mock-2' };
    expect(
      (await call('/ai/settings', { method: 'PUT', token: adminToken, body: JSON.stringify(settings) }))
        .status,
    ).toBe(204);
    const c = (await (
      await call('/ai/complete', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ prompt: 'Hei' }),
      })
    ).json()) as {
      provider: string;
      model: string;
    };
    expect(c).toMatchObject({ provider: 'toinen', model: 'mock-2' });
  });

  it('services page lists every service type with providers and tests connections', async () => {
    const r = (await (await call('/services', { token: adminToken })).json()) as {
      items: { type: string; options: unknown[] }[];
    };
    expect(r.items.map((i) => i.type)).toEqual(
      expect.arrayContaining([
        'database',
        'auth',
        'storage',
        'mail',
        'realtime',
        'jobs',
        'ai',
        'embeddings',
        'backup',
      ]),
    );
    expect(r.items.find((i) => i.type === 'storage')!.options.length).toBeGreaterThanOrEqual(2);
    const t = (await (
      await call('/services/database/test', { method: 'POST', token: adminToken })
    ).json()) as { ok: boolean };
    expect(t.ok).toBe(true);
  });

  it('starts jobs and reports progress; module backup and restore need confirmation', async () => {
    const b = await call('/backups/run', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ kind: 'module', moduleId: '0.001' }),
    });
    expect(b.status).toBe(202);
    const { jobId } = (await b.json()) as { jobId: string };
    let status = '';
    for (let i = 0; i < 50 && !['succeeded', 'failed'].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = ((await (await call(`/jobs/${jobId}`, { token: adminToken })).json()) as { status: string })
        .status;
    }
    expect(status).toBe('succeeded');
    const exp = await call('/backups/modules/0.001/export', { token: adminToken });
    expect(exp.status, await exp.clone().text()).toBe(200);
    const backup = await exp.json();
    const noConfirm = await call('/backups/modules/0.001/import', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ confirm: 'ok', backup }),
    });
    expect(noConfirm.status).toBe(400);
    const ok = await call('/backups/modules/0.001/import', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ confirm: 'PALAUTA', backup }),
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
  });
});

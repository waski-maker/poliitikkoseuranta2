import { describe, expect, it } from 'vitest';
import {
  applyRetention,
  chunkDocuments,
  createMockProvider,
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  generateKeyB64,
  HttpClient,
  renderExport,
  renderCsv,
  renderMarkdown,
  topoSort,
  validateManifest,
  zipFiles,
  type ExportDocument,
  type ModuleManifest,
} from '../src/index.ts';
import { registriesModule } from '@ps/m0001-registries';
import { unzipSync, strFromU8 } from 'fflate';

const doc: ExportDocument = {
  title: 'Testivienti – äöå',
  subtitle: 'Alaotsikko',
  generatedAt: new Date('2026-10-05T10:00:00Z'),
  sources: [{ name: 'Eduskunnan avoin data', license: 'CC BY 4.0', url: 'https://api.eduskunta.fi' }],
  criteria: [{ label: 'Puolue', value: 'Vihreät' }],
  items: [
    {
      id: '1',
      heading: 'Ensimmäinen',
      meta: [{ label: 'Päivä', value: '1.1.2026' }],
      body: 'Teksti, jossa "lainaus".\n\nToinen kappale ≥ 2.',
      link: 'https://example.com/1',
      data: { id: '1', name: 'Eka, toka' },
    },
    { id: '2', heading: 'Toinen', meta: [], body: 'x'.repeat(5000), data: { id: '2', name: 'Toka' } },
  ],
};

describe('crypto', () => {
  it('encrypts and decrypts with AES-GCM envelopes', async () => {
    const key = generateKeyB64();
    const c = await encryptString('salainen äö', key);
    expect(c).not.toContain('salainen');
    expect(await decryptString(c, key)).toBe('salainen äö');
    const bytes = await encryptBytes(new Uint8Array([1, 2, 3]), key);
    expect([...(await decryptBytes(bytes, key))]).toEqual([1, 2, 3]);
    await expect(decryptString(c, generateKeyB64())).rejects.toThrow();
  });
});

describe('backup retention', () => {
  it('keeps 7 daily, 4 weekly and 12 monthly backups', () => {
    const backups = Array.from({ length: 400 }, (_, i) => ({
      id: String(i),
      startedAt: new Date(Date.UTC(2026, 9, 5) - i * 86400000),
    }));
    const { keep, remove } = applyRetention(backups, { daily: 7, weekly: 4, monthly: 12 });
    expect([...keep.values()].filter((c) => c === 'daily')).toHaveLength(7);
    expect(keep.size).toBeGreaterThanOrEqual(7 + 2 + 10);
    expect(keep.size).toBeLessThanOrEqual(7 + 4 + 12);
    expect(keep.has('0')).toBe(true);
    expect(remove.length + keep.size).toBe(400);
  });
});

describe('export service', () => {
  it('renders all formats with provenance', async () => {
    for (const f of ['txt', 'md', 'csv', 'json', 'pdf', 'docx'] as const) {
      const r = await renderExport(doc, f);
      expect(r.bytes.length).toBeGreaterThan(100);
      expect(r.filename).toMatch(new RegExp(`\\.${f}$`));
    }
    expect(renderMarkdown(doc)).toContain('Lähde: Eduskunnan avoin data (CC BY 4.0)');
    const csv = renderCsv(doc);
    expect(csv).toContain('"Eka, toka"');
    expect(csv).toContain('Viety:');
    const pdf = await renderExport(doc, 'pdf');
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    const zip = zipFiles([await renderExport(doc, 'md'), await renderExport(doc, 'json')], 'paketti');
    const entries = unzipSync(zip.bytes);
    expect(Object.keys(entries)).toHaveLength(2);
    expect(strFromU8(entries['testivienti-aoa.json']!)).toContain('"exportedAt"');
  });
});

describe('ai chunking and mock provider', () => {
  it('splits large inputs into batches that fit the context', () => {
    const docs = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, text: 'sana '.repeat(2000) }));
    const batches = chunkDocuments(docs, 16_000, 2_000);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().length).toBe(30);
  });

  it('mock provider keeps citations and produces normalised embeddings', async () => {
    const p = createMockProvider();
    const r = await p.complete({
      model: 'mock-1',
      messages: [{ role: 'user', content: 'Aineisto [#a1] ja [#b2]' }],
    });
    expect(r.text).toContain('[#a1]');
    const e = await p.embed!(['verotus ja verot', 'verotuksen kiristys', 'jalkapallo'], 'mock');
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
    expect(dot(e.vectors[0]!, e.vectors[1]!)).toBeGreaterThan(dot(e.vectors[0]!, e.vectors[2]!));
  });
});

describe('module registry rules', () => {
  it('validates the registries manifest', () => {
    expect(validateManifest(registriesModule.manifest)).toEqual([]);
  });

  it('orders by dependency and rejects cycles and missing modules', () => {
    const m = (id: string, dependsOn: string[]) =>
      ({ ...registriesModule.manifest, id, dependsOn }) as ModuleManifest;
    expect(topoSort([m('1.002', ['1.001']), m('1.001', ['0.001']), m('0.001', [])])).toEqual([
      '0.001',
      '1.001',
      '1.002',
    ]);
    expect(() => topoSort([m('1.001', ['1.002']), m('1.002', ['1.001'])])).toThrow(/Cyclic/);
    expect(() => topoSort([m('1.001', ['9.999'])])).toThrow(/missing/);
  });
});

describe('http client', () => {
  it('retries 429/5xx and reports deprecation headers', async () => {
    let calls = 0;
    const warnings: string[] = [];
    const fake: typeof fetch = async () => {
      calls++;
      if (calls < 3)
        return new Response('busy', { status: calls === 1 ? 429 : 503, headers: { 'retry-after': '0' } });
      return new Response('{"ok":true}', { status: 200, headers: { deprecation: 'true' } });
    };
    const http = new HttpClient({
      userAgent: 'test',
      fetch: fake,
      retries: 3,
      onWarning: (w) => warnings.push(w),
    });
    expect(await http.json('https://example.invalid/x')).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(warnings[0]).toMatch(/vanhentumisesta/);
  });
});

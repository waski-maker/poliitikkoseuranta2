import { zipSync, strToU8 } from 'fflate';
import { renderPdf } from './pdf.ts';
import { renderDocx } from './docx.ts';

export type ExportFormat = 'txt' | 'md' | 'csv' | 'json' | 'pdf' | 'docx';
export const EXPORT_FORMATS: ExportFormat[] = ['txt', 'md', 'csv', 'json', 'pdf', 'docx'];

export interface ExportSource {
  name: string;
  url?: string;
  license?: string;
}

export interface ExportItem {
  id: string;
  heading: string;
  meta: { label: string; value: string }[];
  body?: string;
  link?: string;
  /** Flat values for CSV/JSON. */
  data: Record<string, unknown>;
}

/** A provider-neutral export document. Modules build one; the service renders any format. */
export interface ExportDocument {
  title: string;
  subtitle?: string;
  generatedAt: Date;
  sources: ExportSource[];
  /** Search criteria or other context shown on the cover page. */
  criteria?: { label: string; value: string }[];
  items: ExportItem[];
  /** Column order for CSV (defaults to keys of the first item). */
  columns?: { key: string; label: string }[];
}

export interface RenderedFile {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

const MIME: Record<ExportFormat | 'zip', string> = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
};

export function formatTimestamp(d: Date): string {
  return new Intl.DateTimeFormat('fi-FI', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Helsinki',
  }).format(d);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'vienti'
  );
}

export function sourceLines(doc: ExportDocument): string[] {
  return [
    `Viety: ${formatTimestamp(doc.generatedAt)}`,
    ...doc.sources.map(
      (s) => `Lähde: ${s.name}${s.license ? ` (${s.license})` : ''}${s.url ? ` – ${s.url}` : ''}`,
    ),
  ];
}

export function renderTxt(doc: ExportDocument): string {
  const out: string[] = [
    doc.title.toUpperCase(),
    ...(doc.subtitle ? [doc.subtitle] : []),
    '',
    ...sourceLines(doc),
    '',
  ];
  if (doc.criteria?.length) {
    out.push('Rajaukset:', ...doc.criteria.map((c) => `  ${c.label}: ${c.value}`), '');
  }
  for (const item of doc.items) {
    out.push('='.repeat(72), item.heading, ...item.meta.map((m) => `${m.label}: ${m.value}`));
    if (item.link) out.push(`Linkki: ${item.link}`);
    if (item.body) out.push('', item.body);
    out.push('');
  }
  return out.join('\n');
}

export function renderMarkdown(doc: ExportDocument): string {
  const esc = (s: string) => s.replace(/([*_`[\]])/g, '\\$1');
  const out: string[] = [`# ${esc(doc.title)}`, ...(doc.subtitle ? ['', `_${esc(doc.subtitle)}_`] : []), ''];
  out.push(...sourceLines(doc).map((l) => `> ${l}  `), '');
  if (doc.criteria?.length) {
    out.push('## Rajaukset', '', ...doc.criteria.map((c) => `- **${esc(c.label)}:** ${esc(c.value)}`), '');
  }
  if (doc.items.length > 1) {
    out.push('## Sisällys', '', ...doc.items.map((i, n) => `${n + 1}. ${esc(i.heading)}`), '');
  }
  for (const item of doc.items) {
    out.push(`## ${esc(item.heading)}`, '');
    out.push(...item.meta.map((m) => `- **${esc(m.label)}:** ${esc(m.value)}`));
    if (item.link) out.push(`- **Lähde:** <${item.link}>`);
    if (item.body) out.push('', item.body);
    out.push('');
  }
  return out.join('\n');
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderCsv(doc: ExportDocument): string {
  const columns = doc.columns ?? Object.keys(doc.items[0]?.data ?? {}).map((k) => ({ key: k, label: k }));
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const item of doc.items) lines.push(columns.map((c) => csvCell(item.data[c.key])).join(','));
  // Provenance as trailing comment rows keeps the file importable but attributed.
  lines.push('', ...sourceLines(doc).map((l) => csvCell(`# ${l}`)));
  return '﻿' + lines.join('\r\n');
}

export function renderJson(doc: ExportDocument): string {
  return JSON.stringify(
    {
      title: doc.title,
      subtitle: doc.subtitle ?? null,
      exportedAt: doc.generatedAt.toISOString(),
      sources: doc.sources,
      criteria: doc.criteria ?? [],
      items: doc.items.map((i) => ({ id: i.id, ...i.data, link: i.link ?? null })),
    },
    null,
    2,
  );
}

export async function renderExport(doc: ExportDocument, format: ExportFormat): Promise<RenderedFile> {
  const base = slugify(doc.title);
  const filename = `${base}.${format}`;
  let bytes: Uint8Array;
  switch (format) {
    case 'txt':
      bytes = strToU8(renderTxt(doc));
      break;
    case 'md':
      bytes = strToU8(renderMarkdown(doc));
      break;
    case 'csv':
      bytes = strToU8(renderCsv(doc));
      break;
    case 'json':
      bytes = strToU8(renderJson(doc));
      break;
    case 'pdf':
      bytes = await renderPdf(doc);
      break;
    case 'docx':
      bytes = await renderDocx(doc);
      break;
    default:
      throw new Error(`Unsupported format ${format as string}`);
  }
  return { filename, mime: MIME[format], bytes };
}

/** Bundles several files into one ZIP package. */
export function zipFiles(files: { filename: string; bytes: Uint8Array }[], name = 'vienti'): RenderedFile {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    let n = f.filename;
    let i = 2;
    while (entries[n]) n = f.filename.replace(/(\.\w+)$/, `-${i++}$1`);
    entries[n] = f.bytes;
  }
  return { filename: `${slugify(name)}.zip`, mime: MIME.zip, bytes: zipSync(entries, { level: 6 }) };
}

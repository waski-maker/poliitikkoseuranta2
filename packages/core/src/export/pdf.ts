import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ExportDocument } from './index.ts';
import { formatTimestamp, sourceLines } from './index.ts';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.11, 0.12, 0.14);
const MUTED = rgb(0.42, 0.45, 0.5);
const ACCENT = rgb(0.16, 0.33, 0.73);

// Standard PDF fonts use WinAnsi encoding (covers Finnish and Swedish letters).
// Characters outside it are replaced so rendering never fails.
const REPLACEMENTS: Record<string, string> = {
  '−': '-',
  '‐': '-',
  '‑': '-',
  '≤': '<=',
  '≥': '>=',
  '→': '->',
  ' ': ' ',
  ' ': ' ',
};

function sanitize(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s.replace(/\r/g, '')) {
    const r = REPLACEMENTS[ch];
    if (r !== undefined) {
      out += r;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Hard-break very long words (binary search for the longest fitting prefix).
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let lo = 1;
        let hi = w.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (font.widthOfTextAtSize(w.slice(0, mid), size) <= width) lo = mid;
          else hi = mid - 1;
        }
        lines.push(w.slice(0, lo));
        w = w.slice(lo);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.pdf.addPage(A4);
    this.y = A4[1] - MARGIN;
  }
  ensure(h: number) {
    if (this.y - h < MARGIN + 20) this.newPage();
  }
  text(
    s: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.regular;
    const lh = size * 1.45;
    for (const line of wrap(font, sanitize(font, s), size, A4[0] - 2 * MARGIN)) {
      this.ensure(lh);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= lh;
    }
    this.y -= opts.gap ?? 0;
  }
}

/** Typeset PDF: cover page with criteria and provenance, table of contents, items with metadata. */
export async function renderPdf(doc: ExportDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setCreator('Poliitikkoseuranta 2.0');
  pdf.setProducer('Poliitikkoseuranta 2.0');
  pdf.setCreationDate(doc.generatedAt);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(pdf, regular, bold);

  // Cover
  w.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: ACCENT });
  w.y = A4[1] - 200;
  w.text('POLIITIKKOSEURANTA', { size: 9, bold: true, color: ACCENT, gap: 8 });
  w.text(doc.title, { size: 26, bold: true, gap: 6 });
  if (doc.subtitle) w.text(doc.subtitle, { size: 13, color: MUTED, gap: 18 });
  if (doc.criteria?.length) {
    w.text('Rajaukset', { size: 11, bold: true, gap: 2 });
    for (const c of doc.criteria) w.text(`${c.label}: ${c.value}`, { size: 10, color: MUTED });
    w.y -= 14;
  }
  w.text(`${doc.items.length} kohdetta`, { size: 10, color: MUTED, gap: 14 });
  for (const l of sourceLines(doc)) w.text(l, { size: 9, color: MUTED });

  // Table of contents
  if (doc.items.length > 1) {
    w.newPage();
    w.text('Sisällys', { size: 16, bold: true, gap: 8 });
    doc.items.forEach((item, i) => w.text(`${i + 1}. ${item.heading}`, { size: 10 }));
  }

  // Items
  for (const item of doc.items) {
    w.newPage();
    w.text(item.heading, { size: 15, bold: true, gap: 4 });
    for (const m of item.meta) w.text(`${m.label}: ${m.value}`, { size: 9, color: MUTED });
    if (item.link) w.text(`Lähde: ${item.link}`, { size: 9, color: ACCENT });
    w.y -= 10;
    if (item.body) w.text(item.body, { size: 10.5 });
  }

  // Footer with page numbers and provenance on every page
  const pages = pdf.getPages();
  const footer = sanitize(
    regular,
    `${doc.sources.map((s) => s.name).join(', ')} · viety ${formatTimestamp(doc.generatedAt)}`,
  );
  pages.forEach((p, i) => {
    p.drawText(footer, { x: MARGIN, y: 28, size: 7.5, font: regular, color: MUTED });
    const num = `${i + 1} / ${pages.length}`;
    p.drawText(num, {
      x: A4[0] - MARGIN - regular.widthOfTextAtSize(num, 7.5),
      y: 28,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  });
  return pdf.save();
}

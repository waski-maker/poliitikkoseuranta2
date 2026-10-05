import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { ExportDocument } from './index.ts';
import { sourceLines } from './index.ts';

/** Word document with title, criteria, provenance and one section per item. */
export async function renderDocx(doc: ExportDocument): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
    ...(doc.subtitle
      ? [new Paragraph({ children: [new TextRun({ text: doc.subtitle, italics: true })] })]
      : []),
    ...sourceLines(doc).map(
      (l) => new Paragraph({ children: [new TextRun({ text: l, size: 18, color: '6B7280' })] }),
    ),
  ];
  if (doc.criteria?.length) {
    children.push(new Paragraph({ text: 'Rajaukset', heading: HeadingLevel.HEADING_2 }));
    for (const c of doc.criteria) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${c.label}: `, bold: true }), new TextRun(c.value)],
          bullet: { level: 0 },
        }),
      );
    }
  }
  for (const item of doc.items) {
    children.push(
      new Paragraph({
        text: item.heading,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: doc.items.length > 1,
      }),
    );
    for (const m of item.meta) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${m.label}: `, bold: true, size: 18 }),
            new TextRun({ text: m.value, size: 18 }),
          ],
        }),
      );
    }
    if (item.link) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Lähde: ', bold: true, size: 18 }),
            new ExternalHyperlink({
              link: item.link,
              children: [new TextRun({ text: item.link, style: 'Hyperlink', size: 18 })],
            }),
          ],
        }),
      );
    }
    for (const para of (item.body ?? '').split(/\n{2,}/)) {
      if (para.trim()) children.push(new Paragraph({ text: para.trim(), spacing: { before: 120 } }));
    }
  }
  const document = new Document({
    creator: 'Poliitikkoseuranta 2.0',
    title: doc.title,
    description: sourceLines(doc).join(' | '),
    sections: [{ children }],
  });
  const buf = await Packer.toArrayBuffer(document);
  return new Uint8Array(buf);
}

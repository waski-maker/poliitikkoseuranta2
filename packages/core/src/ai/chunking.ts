import { estimateTokens } from './pricing.ts';

export interface SourceDocument {
  id: string;
  text: string;
  /** Short header shown to the model, e.g. speaker and date. */
  header?: string;
}

/** Formats one document so the model can cite it as [#id]. */
export function formatDocument(doc: SourceDocument): string {
  return `<lähde id="${doc.id}">\n[#${doc.id}]${doc.header ? ` ${doc.header}` : ''}\n${doc.text}\n</lähde>`;
}

/**
 * Splits documents into batches that fit the model's context window, leaving
 * room for instructions and the answer. Very long single documents are split
 * into parts that keep the same citation id.
 */
export function chunkDocuments(
  docs: SourceDocument[],
  contextTokens: number,
  reserveTokens: number,
): SourceDocument[][] {
  const budget = Math.max(1_000, Math.floor((contextTokens - reserveTokens) * 0.8));
  const batches: SourceDocument[][] = [];
  let current: SourceDocument[] = [];
  let used = 0;
  const pieces: SourceDocument[] = [];
  for (const d of docs) {
    const t = estimateTokens(formatDocument(d));
    if (t <= budget) {
      pieces.push(d);
      continue;
    }
    const charsPerPart = budget * 4 - 200;
    for (let i = 0, part = 1; i < d.text.length; i += charsPerPart, part++) {
      pieces.push({
        ...d,
        header: `${d.header ?? ''} (osa ${part})`.trim(),
        text: d.text.slice(i, i + charsPerPart),
      });
    }
  }
  for (const p of pieces) {
    const t = estimateTokens(formatDocument(p));
    if (used + t > budget && current.length) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(p);
    used += t;
  }
  if (current.length) batches.push(current);
  return batches;
}

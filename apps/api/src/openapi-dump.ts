/**
 * Writes the OpenAPI document to packages/sdk/openapi.json without a
 * database (the document is generated from route definitions only).
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildOpenApiDocument } from './openapi.ts';

const doc = await buildOpenApiDocument();
const out = resolve(import.meta.dirname, '../../../packages/sdk/openapi.json');
await writeFile(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`OpenAPI-kuvaus kirjoitettu: ${out} (${Object.keys(doc.paths ?? {}).length} polkua)`);
process.exit(0);

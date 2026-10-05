// Decrypts an application backup ("PSB1" | iv | ciphertext | tag, AES-256-GCM)
// without the application. Usage: BACKUP_ENCRYPTION_KEY=... node decrypt-backup.mjs in.enc out
import { createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output || !process.env.BACKUP_ENCRYPTION_KEY) {
  console.error('Käyttö: BACKUP_ENCRYPTION_KEY=... node decrypt-backup.mjs <in.enc> <out>');
  process.exit(1);
}
const buf = readFileSync(input);
if (buf.subarray(0, 4).toString() !== 'PSB1')
  throw new Error('Tiedosto ei ole sovelluksen salattu varmuuskopio');
const d = createDecipheriv(
  'aes-256-gcm',
  Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, 'base64'),
  buf.subarray(4, 16),
);
d.setAuthTag(buf.subarray(buf.length - 16));
writeFileSync(output, Buffer.concat([d.update(buf.subarray(16, buf.length - 16)), d.final()]));
console.log(`Purettu: ${output}`);

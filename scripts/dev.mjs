// `pnpm dev`: API (http://localhost:8787) and web UI (http://localhost:5173) together.
import { background, c } from './lib.mjs';

c.info('Käynnistetään API ja käyttöliittymä… (Ctrl+C lopettaa)');
const procs = [
  background('pnpm', ['--filter', '@ps/api', 'dev'], 'api'),
  background('pnpm', ['--filter', '@ps/web', 'dev'], 'web'),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

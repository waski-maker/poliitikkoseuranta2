// Small helpers shared by the setup scripts (no dependencies).
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const c = {
  ok: (s) => console.log(`\x1b[32m✓\x1b[0m ${s}`),
  info: (s) => console.log(`\x1b[36m›\x1b[0m ${s}`),
  warn: (s) => console.log(`\x1b[33m!\x1b[0m ${s}`),
  fail: (s) => console.error(`\x1b[31m✗\x1b[0m ${s}`),
  title: (s) => console.log(`\n\x1b[1m${s}\x1b[0m`),
};

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: opts.silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    input: opts.input,
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} epäonnistui${r.stderr ? `: ${r.stderr}` : ''}`);
  }
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

export function has(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}

export function key32() {
  return randomBytes(32).toString('base64');
}

export function parseEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Sets KEY=value lines in an env file, keeping comments and order. */
export function setEnv(file, values) {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\n?$/, '\n')}${k}=${v}\n`;
  }
  writeFileSync(file, text);
}

export function background(cmd, args, name) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (d) =>
    d
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((l) => `[${name}] ${l}`)
      .join('\n');
  p.stdout.on('data', (d) => console.log(prefix(d)));
  p.stderr.on('data', (d) => console.error(prefix(d)));
  return p;
}

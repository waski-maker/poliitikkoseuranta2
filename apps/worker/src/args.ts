export function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const next = argv[i + 1];
      if (v !== undefined) flags[k!] = v;
      else if (next !== undefined && !next.startsWith('--')) {
        flags[k!] = next;
        i++;
      } else flags[k!] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

/** Converts CLI flags to a job payload: --from 2019-04-17 → { from: "2019-04-17" }, --payload '{...}' merges JSON. */
export function flagsToPayload(flags: Record<string, string | boolean>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flags)) {
    if (k === 'payload' && typeof v === 'string') Object.assign(payload, JSON.parse(v));
    else payload[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return payload;
}

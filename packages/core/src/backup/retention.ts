export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { daily: 7, weekly: 4, monthly: 12 };

export interface BackupRef {
  id: string;
  startedAt: Date;
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
}

/**
 * Grandfather-father-son retention: keep the newest backup of each of the
 * last N days, N ISO weeks and N months. Returns ids to keep (with the class
 * that kept them) and ids to delete.
 */
export function applyRetention(
  backups: BackupRef[],
  policy: RetentionPolicy = DEFAULT_RETENTION,
): { keep: Map<string, 'daily' | 'weekly' | 'monthly'>; remove: string[] } {
  const sorted = [...backups].sort((a, b) => +b.startedAt - +a.startedAt);
  const keep = new Map<string, 'daily' | 'weekly' | 'monthly'>();
  const pick = (cls: 'daily' | 'weekly' | 'monthly', keyOf: (d: Date) => string, n: number) => {
    const seen = new Set<string>();
    for (const b of sorted) {
      const k = keyOf(b.startedAt);
      if (seen.has(k)) continue;
      if (seen.size >= n) break;
      seen.add(k);
      if (!keep.has(b.id)) keep.set(b.id, cls);
    }
  };
  pick('daily', (d) => d.toISOString().slice(0, 10), policy.daily);
  pick('weekly', isoWeek, policy.weekly);
  pick('monthly', (d) => d.toISOString().slice(0, 7), policy.monthly);
  return { keep, remove: sorted.filter((b) => !keep.has(b.id)).map((b) => b.id) };
}

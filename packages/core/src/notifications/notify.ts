import type { Db } from '../db/client.ts';

export interface NotificationInput {
  userId?: string | null;
  audience?: 'user' | 'admins';
  kind?: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body?: string | null;
  link?: string | null;
}

/** In-app notification. Delivered to the browser via Realtime or polling. */
export async function notify(db: Db, n: NotificationInput): Promise<void> {
  await db`
    insert into core.notifications (user_id, audience, kind, title, body, link)
    values (${n.userId ?? null}, ${n.audience ?? (n.userId ? 'user' : 'admins')}, ${n.kind ?? 'info'},
            ${n.title}, ${n.body ?? null}, ${n.link ?? null})`;
}

export function notifyAdmins(db: Db, n: Omit<NotificationInput, 'audience' | 'userId'>): Promise<void> {
  return notify(db, { ...n, audience: 'admins' });
}

import type { Db, Sql } from '../db/client.ts';
import type { Logger } from '../util/log.ts';
import { errorMessage } from '../util/errors.ts';

export interface DomainEvent<P = Record<string, unknown>> {
  id: number;
  eventId: string;
  type: string;
  version: number;
  occurredAt: Date;
  sourceModule: string;
  actorId: string | null;
  payload: P;
}

export interface PublishInput<P = Record<string, unknown>> {
  type: string;
  source: string;
  payload: P;
  version?: number;
}

/**
 * Publishes a domain event into the outbox inside the caller's transaction, so
 * the event is stored if and only if the data change commits.
 */
export async function publishEvent<P extends object>(db: Db, input: PublishInput<P>): Promise<string> {
  const [row] = await db<{ publishEvent: string }[]>`
    select core.publish_event(${input.type}, ${input.source}, ${db.json(input.payload as never)}, ${input.version ?? 1})
  `;
  return row!.publishEvent;
}

export type EventHandler = (event: DomainEvent, ctx: { sql: Sql; log: Logger }) => Promise<void>;

export interface Subscription {
  /** Unique consumer name, e.g. "1.002:person-updated". Cursor is stored per consumer. */
  consumer: string;
  types: string[];
  handler: EventHandler;
}

const MAX_FAILURES_PER_EVENT = 3;

/**
 * Pull-based event bus on top of the outbox table. Each consumer keeps a
 * cursor; events are delivered at-least-once, in order. Replaying is
 * resetting a cursor (see replay()).
 */
export class EventBus {
  private subs: Subscription[] = [];

  subscribe(sub: Subscription): void {
    if (this.subs.some((s) => s.consumer === sub.consumer)) {
      throw new Error(`Duplicate event consumer ${sub.consumer}`);
    }
    this.subs.push(sub);
  }

  subscriptions(): readonly Subscription[] {
    return this.subs;
  }

  /** Delivers pending events to all consumers. Returns number of delivered events. */
  async dispatch(sql: Sql, log: Logger, batchSize = 100): Promise<number> {
    let delivered = 0;
    for (const sub of this.subs) {
      await sql`insert into core.event_consumers (consumer) values (${sub.consumer}) on conflict do nothing`;
      const [cursor] = await sql<{ lastEventId: string }[]>`
        select last_event_id from core.event_consumers where consumer = ${sub.consumer}`;
      const events = await sql<DomainEvent[]>`
        select id, event_id, type, version, occurred_at, source_module, actor_id, payload
        from core.outbox
        where id > ${cursor!.lastEventId} and type = any(${sub.types})
        order by id
        limit ${batchSize}`;
      for (const ev of events) {
        ev.id = Number(ev.id);
        try {
          await sub.handler(ev, { sql, log });
          delivered++;
        } catch (err) {
          await sql`insert into core.event_failures (consumer, event_id, error)
                    values (${sub.consumer}, ${ev.id}, ${errorMessage(err)})`;
          const [failRow] = await sql<{ count: number }[]>`
            select count(*)::int as count from core.event_failures
            where consumer = ${sub.consumer} and event_id = ${ev.id}`;
          const count = failRow!.count;
          log.warn('event handler failed', {
            consumer: sub.consumer,
            eventId: ev.id,
            error: errorMessage(err),
          });
          if (count < MAX_FAILURES_PER_EVENT) break; // retry later, keep ordering
        }
        await sql`update core.event_consumers set last_event_id = ${ev.id}, updated_at = now()
                  where consumer = ${sub.consumer}`;
      }
    }
    return delivered;
  }

  /** Re-delivers events from the given outbox id (exclusive) to a consumer. */
  async replay(sql: Sql, consumer: string, fromEventId = 0): Promise<void> {
    await sql`insert into core.event_consumers (consumer, last_event_id) values (${consumer}, ${fromEventId})
              on conflict (consumer) do update set last_event_id = excluded.last_event_id, updated_at = now()`;
  }
}

export async function listEvents(
  db: Db,
  opts: { afterId?: number; types?: string[]; limit?: number },
): Promise<DomainEvent[]> {
  const rows = await db<DomainEvent[]>`
    select id, event_id, type, version, occurred_at, source_module, actor_id, payload
    from core.outbox
    where id > ${opts.afterId ?? 0}
      ${opts.types?.length ? db`and type = any(${opts.types})` : db``}
    order by id
    limit ${Math.min(opts.limit ?? 100, 500)}`;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

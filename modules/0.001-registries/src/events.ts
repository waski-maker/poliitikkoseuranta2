import type { Db } from '@ps/core';
import { publishEvent } from '@ps/core';
import { manifest } from './manifest.ts';

/** Event payloads published by module 0.001. */
export interface PartyEventPayload {
  partyId: string;
  abbreviation: string;
  changedFields?: string[];
}

export interface RegistryUpdatedPayload {
  entity: string;
  id: string;
  action: 'created' | 'updated' | 'deleted' | 'restored';
}

export const EVENTS = {
  partyCreated: 'party.created',
  partyUpdated: 'party.updated',
  partyChanged: 'party.changed',
  registryUpdated: 'registry.updated',
} as const;

/** Fields whose change is significant enough for a party.changed event. */
const SIGNIFICANT = new Set(['nameFi', 'abbreviation', 'status', 'parliamentaryGroupName', 'color']);

export async function publishPartyEvents(
  db: Db,
  partyId: string,
  abbreviation: string,
  changed: string[] | null,
) {
  if (changed === null) {
    await publishEvent<PartyEventPayload>(db, {
      type: EVENTS.partyCreated,
      source: manifest.id,
      payload: { partyId, abbreviation },
    });
    return;
  }
  if (!changed.length) return;
  await publishEvent<PartyEventPayload>(db, {
    type: EVENTS.partyUpdated,
    source: manifest.id,
    payload: { partyId, abbreviation, changedFields: changed },
  });
  if (changed.some((f) => SIGNIFICANT.has(f))) {
    await publishEvent<PartyEventPayload>(db, {
      type: EVENTS.partyChanged,
      source: manifest.id,
      payload: { partyId, abbreviation, changedFields: changed.filter((f) => SIGNIFICANT.has(f)) },
    });
  }
}

export function publishRegistryUpdated(db: Db, payload: RegistryUpdatedPayload) {
  return publishEvent<RegistryUpdatedPayload>(db, {
    type: EVENTS.registryUpdated,
    source: manifest.id,
    payload,
  });
}

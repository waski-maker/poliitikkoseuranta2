/**
 * Tables of module 0.001 (schema m0001_registries). The SQL lives in
 * supabase/migrations/20261005001000_m0001_registries.sql; these are the row
 * types as returned by the API (camelCase). Other modules must not read these
 * tables directly — they use the module API (api.ts).
 */

export const SCHEMA = 'm0001_registries';

export const TABLES = {
  parties: `${SCHEMA}.parties`,
  partyRelations: `${SCHEMA}.party_relations`,
  parliamentaryGroups: `${SCHEMA}.parliamentary_groups`,
  electoralDistricts: `${SCHEMA}.electoral_districts`,
  electoralTerms: `${SCHEMA}.electoral_terms`,
  governments: `${SCHEMA}.governments`,
  governmentParties: `${SCHEMA}.government_parties`,
  bodies: `${SCHEMA}.bodies`,
  positionTypes: `${SCHEMA}.position_types`,
} as const;

export interface RecordMeta {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  visibility: 'public' | 'internal' | 'private';
  source: 'eduskunta' | 'manual' | 'seed' | 'other';
  sourceUrl: string | null;
  fetchedAt: Date | null;
  manualFields: string[];
}

export interface Party extends RecordMeta {
  abbreviation: string;
  nameFi: string;
  nameSv: string | null;
  nameEn: string | null;
  officialName: string | null;
  registeredAt: string | null;
  deregisteredAt: string | null;
  parliamentaryGroupName: string | null;
  color: string | null;
  logoPath: string | null;
  website: string | null;
  chairPersonId: string | null;
  status: 'active' | 'dissolved';
  notes: string | null;
}

export interface PartyRelation extends RecordMeta {
  partyId: string;
  relatedPartyId: string;
  relation: 'predecessor' | 'successor';
  relationDate: string | null;
  note: string | null;
}

export interface ParliamentaryGroup extends RecordMeta {
  code: string;
  nameFi: string;
  nameSv: string | null;
  nameEn: string | null;
  partyId: string | null;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
}

export interface ElectoralDistrict extends RecordMeta {
  code: string;
  nameFi: string;
  nameSv: string | null;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
}

export interface ElectoralTerm extends RecordMeta {
  code: string;
  name: string;
  startDate: string;
  endDate: string | null;
}

export interface Government extends RecordMeta {
  code: string;
  name: string;
  nameSv: string | null;
  ordinal: number | null;
  primeMinisterName: string | null;
  startDate: string;
  endDate: string | null;
}

export interface GovernmentParty extends RecordMeta {
  governmentId: string;
  partyId: string;
  joinedAt: string | null;
  leftAt: string | null;
}

export interface Body extends RecordMeta {
  code: string;
  abbreviation: string | null;
  nameFi: string;
  nameSv: string | null;
  type: 'committee' | 'body' | 'other';
  validFrom: string | null;
  validTo: string | null;
}

export interface PositionType extends RecordMeta {
  code: string;
  nameFi: string;
  nameSv: string | null;
  level: 'municipal' | 'regional' | 'state' | 'eu' | 'party' | 'other';
  isSystem: boolean;
  sortOrder: number;
}

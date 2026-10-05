-- Module 0.001 Perusrekisterit (registries): parties, parliamentary groups,
-- electoral districts, electoral terms, governments, committees/bodies and
-- position types. Other modules reference these by UUID through the module API.

create schema if not exists m0001_registries;
grant usage on schema m0001_registries to anon, authenticated;

create table m0001_registries.parties (
  id uuid primary key default gen_random_uuid(),
  abbreviation text not null,
  name_fi text not null,
  name_sv text,
  name_en text,
  official_name text,
  registered_at date,
  deregistered_at date,
  parliamentary_group_name text,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path text,
  website text,
  chair_person_id uuid,
  status text not null default 'active' check (status in ('active', 'dissolved')),
  notes text
);
select core.setup_table('m0001_registries.parties', 'registries.read', 'registries.edit');
create unique index parties_abbreviation_key on m0001_registries.parties (upper(abbreviation)) where deleted_at is null;

create table m0001_registries.party_relations (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references m0001_registries.parties (id) on delete cascade,
  related_party_id uuid not null references m0001_registries.parties (id) on delete cascade,
  relation text not null check (relation in ('predecessor', 'successor')),
  relation_date date,
  note text,
  unique (party_id, related_party_id, relation)
);
select core.setup_table('m0001_registries.party_relations', 'registries.read', 'registries.edit');

create table m0001_registries.parliamentary_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_fi text not null,
  name_sv text,
  name_en text,
  party_id uuid references m0001_registries.parties (id) on delete set null,
  active boolean not null default true,
  valid_from date,
  valid_to date
);
select core.setup_table('m0001_registries.parliamentary_groups', 'registries.read', 'registries.edit');

create table m0001_registries.electoral_districts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_fi text not null,
  name_sv text,
  valid_from date,
  valid_to date,
  notes text
);
select core.setup_table('m0001_registries.electoral_districts', 'registries.read', 'registries.edit');

create table m0001_registries.electoral_terms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  start_date date not null,
  end_date date,
  check (end_date is null or end_date >= start_date)
);
select core.setup_table('m0001_registries.electoral_terms', 'registries.read', 'registries.edit');

create table m0001_registries.governments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_sv text,
  ordinal int,
  prime_minister_name text,
  start_date date not null,
  end_date date,
  check (end_date is null or end_date >= start_date)
);
select core.setup_table('m0001_registries.governments', 'registries.read', 'registries.edit');

create table m0001_registries.government_parties (
  id uuid primary key default gen_random_uuid(),
  government_id uuid not null references m0001_registries.governments (id) on delete cascade,
  party_id uuid not null references m0001_registries.parties (id) on delete cascade,
  joined_at date,
  left_at date,
  unique (government_id, party_id)
);
select core.setup_table('m0001_registries.government_parties', 'registries.read', 'registries.edit');

create table m0001_registries.bodies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  abbreviation text,
  name_fi text not null,
  name_sv text,
  type text not null default 'committee' check (type in ('committee', 'body', 'other')),
  valid_from date,
  valid_to date
);
select core.setup_table('m0001_registries.bodies', 'registries.read', 'registries.edit');

create table m0001_registries.position_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_fi text not null,
  name_sv text,
  level text not null check (level in ('municipal', 'regional', 'state', 'eu', 'party', 'other')),
  is_system boolean not null default false,
  sort_order int not null default 100
);
select core.setup_table('m0001_registries.position_types', 'registries.read', 'registries.edit');

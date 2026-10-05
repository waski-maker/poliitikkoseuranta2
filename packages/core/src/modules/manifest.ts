/**
 * Module manifest: pure data, no runtime dependencies. Imported by the API,
 * the worker and the web UI (menu, permissions, settings), so it must stay
 * free of React, database or Node imports.
 */

export type RoleId = 'admin' | 'editor' | 'analyst' | 'reader' | 'public';

export type ServiceType =
  | 'database'
  | 'auth'
  | 'storage'
  | 'mail'
  | 'realtime'
  | 'jobs'
  | 'ai'
  | 'embeddings'
  | 'backup'
  | 'hosting'
  | 'api-runtime';

export interface PermissionSpec {
  /** e.g. "mps.read". Prefix must be the module slug. */
  id: string;
  description: string;
  /** Roles that get this permission by default (admin always has everything). */
  roles: RoleId[];
}

export interface MenuItem {
  label: string;
  path: string;
  /** lucide-react icon name, e.g. "Landmark". */
  icon: string;
  permission: string;
  order: number;
  section?: 'main' | 'admin';
}

export interface EventSpec {
  type: string;
  version: number;
  description: string;
}

export interface SettingSpec {
  key: string;
  label: string;
  description?: string;
  type: 'boolean' | 'string' | 'number' | 'select' | 'json';
  default: unknown;
  options?: { value: string; label: string }[];
}

export interface DataSourceSpec {
  id: string;
  name: string;
  url: string;
  license?: string;
  description?: string;
}

export interface BackupTableSpec {
  /** schema-qualified table name */
  table: string;
  description?: string;
}

export interface BackupSpec {
  /** Bump when the module's backup JSON format changes; see ServerModule.upgradeBackup. */
  schemaVersion: number;
  /** Always included in backups: manual data, edits, analyses. */
  irreplaceable: BackupTableSpec[];
  /** Can be rebuilt (open data, indexes, embeddings); optional in backups. */
  reproducible: BackupTableSpec[];
  files?: { irreplaceable: string[]; reproducible: string[] };
}

export interface SearchTypeSpec {
  type: string;
  label: string;
  readPermission: string;
}

export interface DashboardCardSpec {
  id: string;
  title: string;
  permission: string;
}

export interface ModuleManifest {
  /** Module number, e.g. "0.001". 0.x = core, 1.x = Eduskunta, 2.x+ reserved. */
  id: string;
  /** Short machine name used for permissions, routes and DB schema. */
  slug: string;
  name: string;
  description: string;
  version: string;
  dependsOn: string[];
  /** PostgreSQL schema owned by the module, e.g. m0001_registries. */
  dbSchema: string;
  /** Migration files (in supabase/migrations) owned by this module. */
  migrations: string[];
  /** Base path of the module's REST routes, e.g. /registries. */
  apiBasePath: string;
  provides: string[];
  events: { publishes: EventSpec[]; subscribes: string[] };
  menu: MenuItem[];
  permissions: PermissionSpec[];
  settings: SettingSpec[];
  services: ServiceType[];
  dataSources: DataSourceSpec[];
  backup: BackupSpec;
  searchTypes: SearchTypeSpec[];
  dashboardCards: DashboardCardSpec[];
}

export function defineManifest(m: ModuleManifest): ModuleManifest {
  return m;
}

/** Validation used by the registry and by the module template test. */
export function validateManifest(m: ModuleManifest): string[] {
  const errors: string[] = [];
  if (!/^\d+\.\d{3}$/.test(m.id)) errors.push(`invalid module id "${m.id}" (expected e.g. 1.001)`);
  if (!/^[a-z][a-z0-9-]*$/.test(m.slug)) errors.push(`invalid slug "${m.slug}"`);
  if (!/^m\d{4}_[a-z0-9_]+$/.test(m.dbSchema) && m.dbSchema !== 'core')
    errors.push(`dbSchema "${m.dbSchema}" must look like m1002_speeches`);
  if (!m.apiBasePath.startsWith('/')) errors.push('apiBasePath must start with /');
  for (const p of m.permissions) {
    if (!p.id.startsWith(`${m.slug}.`) && !(m.slug === 'core' && p.id.startsWith('core.')))
      errors.push(`permission ${p.id} must start with "${m.slug}."`);
  }
  for (const item of m.menu) {
    if (!m.permissions.some((p) => p.id === item.permission) && !item.permission.startsWith('core.'))
      errors.push(`menu item ${item.path} references unknown permission ${item.permission}`);
  }
  const tables = [...m.backup.irreplaceable, ...m.backup.reproducible].map((t) => t.table);
  for (const t of tables) {
    if (!t.startsWith(`${m.dbSchema}.`) && m.dbSchema !== 'core')
      errors.push(`backup table ${t} is outside module schema ${m.dbSchema}`);
  }
  if (new Set(tables).size !== tables.length) errors.push('backup tables listed twice');
  return errors;
}

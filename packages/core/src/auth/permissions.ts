import type { Db } from '../db/client.ts';
import type { ModuleManifest, PermissionSpec } from '../modules/manifest.ts';
import { ForbiddenError, UnauthorizedError } from '../util/errors.ts';
import type { CurrentUser } from './users.ts';

/**
 * The one permission check used by all API code. Mirrors the database
 * function core.has_permission(), which RLS policies use as a second layer.
 */
export function can(user: CurrentUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  return user.isAdmin || user.permissions.includes(permission);
}

export function requirePermission(user: CurrentUser | null | undefined, permission: string): CurrentUser {
  if (!user) throw new UnauthorizedError();
  if (!can(user, permission)) throw new ForbiddenError(`Puuttuva oikeus: ${permission}`);
  return user;
}

/** Core permissions (module "0.000" = core). */
export const CORE_PERMISSIONS: PermissionSpec[] = [
  { id: 'core.admin', description: 'Ylläpito: käyttäjät, roolit ja kaikki asetukset', roles: [] },
  { id: 'core.settings', description: 'Asetusten luku ja muutos', roles: [] },
  { id: 'core.services', description: 'Palvelut-sivu ja palveluiden vaihto', roles: [] },
  { id: 'core.ai', description: 'Tekoälyasetukset ja käyttöseuranta', roles: [] },
  { id: 'core.sync', description: 'Synkronointien tila ja käynnistys', roles: ['editor'] },
  { id: 'core.jobs', description: 'Kaikkien taustatöiden näkeminen', roles: ['editor'] },
  { id: 'core.audit', description: 'Muutoshistorian luku ja palautus aiempaan versioon', roles: ['editor'] },
  {
    id: 'core.trash',
    description: 'Roskakori: poistettujen tietojen näkeminen ja palautus',
    roles: ['editor'],
  },
  { id: 'core.backup', description: 'Varmuuskopiot ja palautus', roles: [] },
  { id: 'core.search', description: 'Yleishaku', roles: ['editor', 'analyst', 'reader'] },
  { id: 'core.export', description: 'Vienti tiedostoiksi', roles: ['editor', 'analyst'] },
];

/** Writes module permissions and default role mappings to the database (idempotent). */
export async function syncPermissions(db: Db, manifests: ModuleManifest[]): Promise<void> {
  const all: { moduleId: string; spec: PermissionSpec }[] = [
    ...CORE_PERMISSIONS.map((spec) => ({ moduleId: '0.000', spec })),
    ...manifests.flatMap((m) => m.permissions.map((spec) => ({ moduleId: m.id, spec }))),
  ];
  for (const { moduleId, spec } of all) {
    await db`insert into core.permissions (id, module_id, description) values (${spec.id}, ${moduleId}, ${spec.description})
             on conflict (id) do update set module_id = excluded.module_id, description = excluded.description`;
    for (const role of spec.roles) {
      await db`insert into core.role_permissions (role_id, permission_id) values (${role}, ${spec.id}) on conflict do nothing`;
    }
  }
}

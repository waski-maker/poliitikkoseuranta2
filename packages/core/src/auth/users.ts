import type { Db, Sql } from '../db/client.ts';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
  isAdmin: boolean;
}

export async function isEmailAllowed(db: Db, email: string, envList: string[]): Promise<boolean> {
  const e = email.toLowerCase();
  if (envList.map((x) => x.toLowerCase()).includes(e)) return true;
  const rows = await db`select 1 from core.allowed_emails where lower(email) = ${e}`;
  return rows.length > 0;
}

/**
 * Called on every authenticated request (cheap) and on sign-in. Users must be
 * on the allow-list (ALLOWED_EMAILS or core.allowed_emails); otherwise they
 * are deactivated and get nothing. The very first user becomes admin; later
 * users get the reader role.
 */
export async function ensureUser(
  sql: Sql,
  identity: { sub: string; email: string },
  allowList: string[],
): Promise<CurrentUser | null> {
  const email = identity.email.toLowerCase();
  if (!(await isEmailAllowed(sql, email, allowList))) {
    await sql`update core.users set is_active = false, updated_at = now() where id = ${identity.sub} and is_active`;
    return null;
  }
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(424242)`;
    const [existing] = await tx<{ id: string; isActive: boolean }[]>`
      select id, is_active from core.users where id = ${identity.sub}`;
    if (!existing) {
      // Same email from another identity provider (provider switch): keep the
      // user, roles and history by moving the row to the new subject id.
      const moved =
        await tx`update core.users set id = ${identity.sub}, is_active = true, last_login_at = now(),
                               updated_at = now() where lower(email) = ${email} returning id`;
      if (!moved.length) {
        await tx`insert into core.users (id, email, last_login_at) values (${identity.sub}, ${email}, now())`;
      }
    } else {
      await tx`update core.users set email = ${email}, is_active = true, last_login_at = now(), updated_at = now()
               where id = ${identity.sub}`;
    }
    const [adminRow] = await tx<{ admins: number }[]>`
      select count(*)::int as admins from core.user_roles ur join core.users u on u.id = ur.user_id
      where ur.role_id = 'admin' and u.is_active`;
    const [ownRow] = await tx<{ own: number }[]>`
      select count(*)::int as own from core.user_roles where user_id = ${identity.sub}`;
    const admins = adminRow!.admins;
    const own = ownRow!.own;
    if (admins === 0) {
      await tx`insert into core.user_roles (user_id, role_id) values (${identity.sub}, 'admin') on conflict do nothing`;
    } else if (own === 0) {
      await tx`insert into core.user_roles (user_id, role_id) values (${identity.sub}, 'reader') on conflict do nothing`;
    }
    return loadUser(tx, identity.sub);
  });
}

export async function loadUser(db: Db, userId: string): Promise<CurrentUser | null> {
  const [u] = await db<{ id: string; email: string; displayName: string | null; isActive: boolean }[]>`
    select id, email, display_name, is_active from core.users where id = ${userId}`;
  if (!u || !u.isActive) return null;
  const roles = (
    await db<{ roleId: string }[]>`select role_id from core.user_roles where user_id = ${userId}`
  ).map((r) => r.roleId);
  const isAdmin = roles.includes('admin');
  const permissions = isAdmin
    ? (await db<{ id: string }[]>`select id from core.permissions order by id`).map((p) => p.id)
    : (
        await db<{ permissionId: string }[]>`
          select distinct permission_id from core.role_permissions where role_id = any(${roles}) order by permission_id`
      ).map((p) => p.permissionId);
  return { id: u.id, email: u.email, displayName: u.displayName, roles, permissions, isAdmin };
}

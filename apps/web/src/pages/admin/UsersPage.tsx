import { unwrap } from '@ps/sdk';
import { useApi, useQuery } from '@ps/sdk/react';
import { Badge, Card, ErrorState, PageHeader, Skeleton, Table, Td, Th, formatRelative } from '@ps/ui';

/** Read-only for now; invitations and role editing come with the user management page. */
export function UsersPage() {
  const api = useApi();
  const q = useQuery({ queryKey: ['users'], queryFn: () => unwrap(api.GET('/users')) });
  return (
    <>
      <PageHeader
        title="Käyttäjät"
        description="Pääsy määräytyy sallittujen sähköpostien listasta (ALLOWED_EMAILS). Ensimmäinen kirjautuja on ylläpitäjä."
        crumbs={[{ label: 'Ylläpito' }, { label: 'Käyttäjät' }]}
      />
      {q.error ? <ErrorState error={q.error} /> : null}
      {q.isLoading ? <Skeleton className="h-32" /> : null}
      {q.data ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Sähköposti</Th>
                <Th>Roolit</Th>
                <Th>Tila</Th>
                <Th>Viimeksi kirjautunut</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.email}</Td>
                  <Td className="flex gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r} tone={r === 'admin' ? 'accent' : 'neutral'}>
                        {q.data.roles.find((x) => x.id === r)?.name ?? r}
                      </Badge>
                    ))}
                  </Td>
                  <Td>
                    {u.isActive ? (
                      <Badge tone="success">Aktiivinen</Badge>
                    ) : (
                      <Badge tone="danger">Ei pääsyä</Badge>
                    )}
                  </Td>
                  <Td className="text-subtle">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : '–'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}

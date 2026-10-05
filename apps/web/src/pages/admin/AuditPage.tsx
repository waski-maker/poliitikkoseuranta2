import { unwrap } from '@ps/sdk';
import { useApi, useMutation, useQuery, useQueryClient } from '@ps/sdk/react';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  formatDate,
  toast,
} from '@ps/ui';

const actions: Record<string, string> = {
  insert: 'Lisäys',
  update: 'Muutos',
  delete: 'Poisto',
  soft_delete: 'Roskakoriin',
  restore: 'Palautus',
  export: 'Vienti',
  merge: 'Yhdistäminen',
  import: 'Tuonti',
};

export function AuditPage() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['audit'],
    queryFn: () => unwrap(api.GET('/audit', { params: { query: { limit: 100 } } })),
  });
  const restore = useMutation({
    mutationFn: (id: number) =>
      unwrap(api.POST('/audit/{id}/restore', { params: { path: { id } }, body: {} })),
    onSuccess: () => (toast.success('Tietue palautettu tähän versioon'), void qc.invalidateQueries()),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <PageHeader
        title="Muutoshistoria"
        description="Kuka muutti mitä ja milloin. Minkä tahansa tietueen voi palauttaa aiempaan versioon yhdellä klikkauksella."
        crumbs={[{ label: 'Ylläpito' }, { label: 'Muutoshistoria' }]}
      />
      {q.error ? <ErrorState error={q.error} /> : null}
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.data ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Aika</Th>
                <Th>Tekijä</Th>
                <Th>Toiminto</Th>
                <Th>Kohde</Th>
                <Th>Kentät</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap">
                    {formatDate(e.at, { dateStyle: 'short', timeStyle: 'medium' })}
                  </Td>
                  <Td className="text-xs">{e.actorLabel ?? e.actorId ?? 'järjestelmä'}</Td>
                  <Td>
                    <Badge>{actions[e.action] ?? e.action}</Badge>
                  </Td>
                  <Td className="text-xs">
                    <span className="text-subtle">{e.tableSchema}.</span>
                    {e.tableName}
                    <div className="text-subtle">
                      {String(e.newData?.nameFi ?? e.newData?.name ?? e.recordId ?? '')}
                    </div>
                  </Td>
                  <Td className="max-w-60 truncate text-xs text-subtle">{e.changedFields?.join(', ')}</Td>
                  <Td className="text-right">
                    {e.recordId && e.newData && e.tableSchema !== 'core' ? (
                      <Button size="sm" variant="ghost" onClick={() => restore.mutate(e.id)}>
                        Palauta tähän
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}

import { unwrap } from '@ps/sdk';
import { useApi, useMutation, useQuery, useQueryClient } from '@ps/sdk/react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  formatDate,
  toast,
} from '@ps/ui';

export function TrashPage() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['trash'], queryFn: () => unwrap(api.GET('/trash')) });
  const restore = useMutation({
    mutationFn: (b: { table: string; id: string }) => unwrap(api.POST('/trash/restore', { body: b })),
    onSuccess: () => (toast.success('Palautettu'), void qc.invalidateQueries()),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <PageHeader
        title="Roskakori"
        description="Poistetut tiedot säilyvät 30 päivää, minkä jälkeen ne poistetaan pysyvästi."
        crumbs={[{ label: 'Ylläpito' }, { label: 'Roskakori' }]}
      />
      {q.error ? <ErrorState error={q.error} /> : null}
      {q.isLoading ? <Skeleton className="h-32" /> : null}
      {q.data && !q.data.items.length ? <EmptyState title="Roskakori on tyhjä" /> : null}
      {q.data?.items.length ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Tieto</Th>
                <Th>Taulu</Th>
                <Th>Poistettu</Th>
                <Th>Poistuu pysyvästi</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((i) => (
                <tr key={`${i.table}:${i.id}`}>
                  <Td className="font-medium">{i.label}</Td>
                  <Td className="text-xs text-subtle">{i.table}</Td>
                  <Td>{formatDate(i.deletedAt, { dateStyle: 'short', timeStyle: 'short' })}</Td>
                  <Td>{formatDate(new Date(+new Date(i.deletedAt) + 30 * 86400000))}</Td>
                  <Td className="text-right">
                    <Button size="sm" onClick={() => restore.mutate({ table: i.table, id: i.id })}>
                      Palauta
                    </Button>
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

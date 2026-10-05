import { Link } from 'react-router';
import { unwrap } from '@ps/sdk';
import { useApi, useMutation, useQuery, useQueryClient } from '@ps/sdk/react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Switch,
  Table,
  Td,
  Th,
  formatDate,
  formatRelative,
  toast,
} from '@ps/ui';

const tone = { succeeded: 'success', partial: 'warning', failed: 'danger', running: 'accent' } as const;
const label = {
  succeeded: 'Onnistui',
  partial: 'Osittain',
  failed: 'Epäonnistui',
  running: 'Käynnissä',
} as const;

export function SyncPage() {
  const api = useApi();
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ['sync-sources'], queryFn: () => unwrap(api.GET('/sync/sources')) });
  const runs = useQuery({
    queryKey: ['sync-runs'],
    queryFn: () => unwrap(api.GET('/sync/runs', { params: { query: { limit: 30 } } })),
  });
  const run = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/sync/sources/{id}/run', { params: { path: { id } }, body: {} })),
    onSuccess: (job) => {
      toast.success('Päivitys käynnistetty', {
        description: 'Etenemistä voi seurata Taustatyöt-sivulla.',
        action: { label: 'Avaa', onClick: () => (window.location.hash = '') },
      });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void job;
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const toggle = useMutation({
    mutationFn: (p: { id: string; enabled: boolean }) =>
      unwrap(
        api.PATCH('/sync/sources/{id}', { params: { path: { id: p.id } }, body: { enabled: p.enabled } }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync-sources'] }),
  });
  return (
    <>
      <PageHeader
        title="Synkronoinnit"
        description="Tietolähteiden tila. Ajastetut päivitykset ajetaan GitHub Actionsissa (tai cronilla omalla palvelimella)."
        crumbs={[{ label: 'Ylläpito' }, { label: 'Synkronoinnit' }]}
      />
      {sources.error ? <ErrorState error={sources.error} /> : null}
      {sources.isLoading ? <Skeleton className="h-32" /> : null}
      <div className="grid gap-3">
        {sources.data?.items.map((s) => (
          <Card key={s.id}>
            <CardHeader
              title={s.name}
              description={s.description ?? undefined}
              actions={
                <>
                  <Switch
                    aria-label="Käytössä"
                    checked={s.enabled}
                    onCheckedChange={(v) => toggle.mutate({ id: s.id, enabled: v })}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => run.mutate(s.id)}
                    loading={run.isPending && run.variables === s.id}
                  >
                    Päivitä nyt
                  </Button>
                </>
              }
            />
            <CardBody className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              <span>Moduuli {s.moduleId}</span>
              <span>
                Ajastus: <code className="text-xs">{s.schedule ?? '–'}</code>
              </span>
              <span>Viimeisin onnistunut: {s.lastSuccessAt ? formatRelative(s.lastSuccessAt) : '–'}</span>
              {s.lastRun ? (
                <span>
                  Viimeisin ajo:{' '}
                  <Badge tone={tone[s.lastRun.status as keyof typeof tone] ?? 'neutral'}>
                    {label[s.lastRun.status as keyof typeof label] ?? s.lastRun.status}
                  </Badge>{' '}
                  {s.lastRun.rowsFetched} haettu · {s.lastRun.rowsInserted} uutta · {s.lastRun.rowsUpdated}{' '}
                  päivitetty
                </span>
              ) : null}
              {s.consecutiveFailures ? (
                <Badge tone="danger">{s.consecutiveFailures} peräkkäistä epäonnistumista</Badge>
              ) : null}
              {s.lastError ? <span className="w-full text-danger">{s.lastError}</span> : null}
            </CardBody>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader
          title="Ajoloki"
          description="Jokainen ajo valintoineen, rivimäärineen ja virheineen"
          actions={
            <Link className="text-[13px] text-accent hover:underline" to="/tyot">
              Taustatyöt
            </Link>
          }
        />
        {runs.data?.items.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Lähde</Th>
                <Th>Tila</Th>
                <Th>Alku</Th>
                <Th>Kesto</Th>
                <Th className="text-right">Haettu / uudet / päivitetyt / ohitetut</Th>
                <Th>Virheet</Th>
              </tr>
            </thead>
            <tbody>
              {runs.data.items.map((r) => (
                <tr key={r.id}>
                  <Td>{r.sourceId}</Td>
                  <Td>
                    <Badge tone={tone[r.status as keyof typeof tone] ?? 'neutral'}>
                      {label[r.status as keyof typeof label] ?? r.status}
                    </Badge>
                  </Td>
                  <Td>{formatDate(r.startedAt, { dateStyle: 'short', timeStyle: 'short' })}</Td>
                  <Td>
                    {r.finishedAt
                      ? `${Math.max(1, Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000))} s`
                      : '…'}
                  </Td>
                  <Td className="text-right">
                    {r.rowsFetched} / {r.rowsInserted} / {r.rowsUpdated} / {r.rowsSkipped}
                  </Td>
                  <Td
                    className="max-w-80 truncate text-xs text-danger"
                    title={r.errors.map((e) => e.message).join('\n')}
                  >
                    {r.errors[0]?.message ?? ''}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardBody>
            <EmptyState title="Ei ajoja vielä" description="Käynnistä päivitys yllä olevalla painikkeella." />
          </CardBody>
        )}
      </Card>
    </>
  );
}

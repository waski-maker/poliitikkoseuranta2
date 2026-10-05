import { Link, useParams } from 'react-router';
import { unwrap, type Schemas } from '@ps/sdk';
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
  Progress,
  Skeleton,
  Table,
  Td,
  Th,
  formatDate,
  formatRelative,
} from '@ps/ui';
import { usePollInterval } from '../realtime/live.ts';

type Job = Schemas['Job'];
const statusLabel: Record<Job['status'], string> = {
  queued: 'Jonossa',
  running: 'Käynnissä',
  succeeded: 'Valmis',
  failed: 'Epäonnistui',
  cancelled: 'Peruttu',
};
const statusTone = {
  queued: 'neutral',
  running: 'accent',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
} as const;

export function JobStatus({ job }: { job: Job }) {
  return <Badge tone={statusTone[job.status]}>{statusLabel[job.status]}</Badge>;
}

function JobDetail({ id }: { id: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['jobs', id],
    queryFn: () => unwrap(api.GET('/jobs/{id}', { params: { path: { id } } })),
  });
  const live = q.data && (q.data.status === 'queued' || q.data.status === 'running');
  const interval = usePollInterval(Boolean(live));
  useQuery({
    queryKey: ['jobs', id, 'poll'],
    enabled: Boolean(live),
    refetchInterval: interval,
    queryFn: async () => (await q.refetch()).data ?? null,
  });
  const cancel = useMutation({
    mutationFn: () => unwrap(api.POST('/jobs/{id}/cancel', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Skeleton className="h-40" />;
  const j = q.data;
  return (
    <Card>
      <CardHeader
        title={j.type}
        description={`Luotu ${formatDate(j.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} · ${j.runner}`}
        actions={
          <>
            <JobStatus job={j} />
            {live ? (
              <Button size="sm" onClick={() => cancel.mutate()}>
                Peru
              </Button>
            ) : null}
          </>
        }
      />
      <CardBody className="grid gap-4">
        <Progress
          value={j.progressDone}
          max={j.progressTotal}
          label={j.message ?? (live ? 'Käynnissä…' : undefined)}
        />
        {j.error ? <p className="rounded-md bg-danger-soft p-3 text-sm text-danger">{j.error}</p> : null}
        {j.result ? (
          <pre className="max-h-80 overflow-auto rounded-md bg-surface-2 p-3 text-xs">
            {JSON.stringify(j.result, null, 2)}
          </pre>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function JobsPage() {
  const { id } = useParams();
  const api = useApi();
  const list = useQuery({
    queryKey: ['jobs', 'list'],
    queryFn: () => unwrap(api.GET('/jobs', { params: { query: { limit: 100 } } })),
  });
  const anyLive = list.data?.items.some((j) => j.status === 'running' || j.status === 'queued');
  const interval = usePollInterval(Boolean(anyLive));
  useQuery({
    queryKey: ['jobs', 'list', 'poll'],
    enabled: Boolean(anyLive),
    refetchInterval: interval,
    queryFn: async () => (await list.refetch()).data ?? null,
  });
  return (
    <>
      <PageHeader
        title="Taustatyöt"
        description="Tuonnit, analyysit, viennit ja varmuuskopiot etenevät taustalla; saat ilmoituksen, kun työ valmistuu."
        crumbs={[{ label: 'Kojelauta' }, { label: 'Taustatyöt' }]}
      />
      <div className="grid gap-4">
        {id ? <JobDetail id={id} /> : null}
        <Card>
          {list.isLoading ? <Skeleton className="m-4 h-24" /> : null}
          {list.data && !list.data.items.length ? (
            <div className="p-4">
              <EmptyState title="Ei taustatöitä" />
            </div>
          ) : null}
          {list.data?.items.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Työ</Th>
                  <Th>Tila</Th>
                  <Th>Edistyminen</Th>
                  <Th>Luotu</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((j) => (
                  <tr key={j.id} className="hover:bg-surface-2">
                    <Td>
                      <Link to={`/tyot/${j.id}`} className="font-medium hover:text-accent">
                        {j.type}
                      </Link>
                      <div className="text-xs text-subtle">{j.message}</div>
                    </Td>
                    <Td>
                      <JobStatus job={j} />
                    </Td>
                    <Td className="w-48">
                      <Progress value={j.progressDone} max={j.progressTotal} />
                    </Td>
                    <Td className="text-subtle">{formatRelative(j.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card>
      </div>
    </>
  );
}

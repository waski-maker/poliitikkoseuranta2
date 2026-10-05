import { Link } from 'react-router';
import { unwrap } from '@ps/sdk';
import { useApi, useQuery } from '@ps/sdk/react';
import { Badge, Card, CardBody, CardHeader, PageHeader, Skeleton, formatRelative } from '@ps/ui';
import { useAuth } from '../auth/AuthProvider.tsx';
import { uiModules } from '../modules.ts';

function SyncCard() {
  const api = useApi();
  const q = useQuery({ queryKey: ['sync-sources'], queryFn: () => unwrap(api.GET('/sync/sources')) });
  return (
    <Card>
      <CardHeader
        title="Synkronointien tila"
        description="Tietolähteet ja viimeisimmät ajot"
        actions={
          <Link to="/yllapito/synkronoinnit" className="text-[13px] text-accent hover:underline">
            Kaikki
          </Link>
        }
      />
      <CardBody className="grid gap-3">
        {q.isLoading ? <Skeleton className="h-10" /> : null}
        {q.data?.items.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{s.name}</span>
            {s.lastRun ? (
              <Badge
                tone={
                  s.lastRun.status === 'failed'
                    ? 'danger'
                    : s.lastRun.status === 'partial'
                      ? 'warning'
                      : 'success'
                }
              >
                {formatRelative(s.lastRun.startedAt)}
              </Badge>
            ) : (
              <Badge>Ei ajettu</Badge>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function JobsCard() {
  const api = useApi();
  const q = useQuery({
    queryKey: ['jobs', 'recent'],
    queryFn: () => unwrap(api.GET('/jobs', { params: { query: { limit: 5 } } })),
  });
  return (
    <Card>
      <CardHeader
        title="Viimeisimmät taustatyöt"
        actions={
          <Link to="/tyot" className="text-[13px] text-accent hover:underline">
            Kaikki
          </Link>
        }
      />
      <CardBody className="grid gap-3">
        {q.isLoading ? <Skeleton className="h-10" /> : null}
        {q.data && !q.data.items.length ? <p className="text-sm text-subtle">Ei töitä vielä.</p> : null}
        {q.data?.items.map((j) => (
          <Link
            key={j.id}
            to={`/tyot/${j.id}`}
            className="flex items-center justify-between gap-3 text-sm hover:text-accent"
          >
            <span className="truncate">{j.type}</span>
            <span className="text-xs text-subtle">{formatRelative(j.createdAt)}</span>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

export function DashboardPage() {
  const auth = useAuth();
  const cards = uiModules.flatMap((m) => (m.ui.dashboardCards ?? []).filter((c) => auth.can(c.permission)));
  return (
    <>
      <PageHeader title="Kojelauta" description="Yleiskuva moduuleista, tietolähteistä ja taustatöistä." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ id, Component }) => (
          <Component key={id} />
        ))}
        {auth.can('core.sync') ? <SyncCard /> : null}
        <JobsCard />
      </div>
    </>
  );
}

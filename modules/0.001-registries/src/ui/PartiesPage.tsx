import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { LayoutGrid, Plus, Rows3, Search } from 'lucide-react';
import { usePermissions } from '@ps/sdk/react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  PartyDot,
  Skeleton,
  SourceMark,
  Table,
  Td,
  Th,
  cn,
  toast,
} from '@ps/ui';
import { useEntityList, useEntityMutations, type Party } from './hooks.ts';

export function PartiesPage() {
  const list = useEntityList<Party>('parties');
  const { create } = useEntityMutations('parties');
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const [view, setView] = React.useState<'table' | 'cards'>(
    () => (localStorage.getItem('ps-parties-view') as 'table' | 'cards') ?? 'table',
  );
  const [status, setStatus] = React.useState<'all' | 'active' | 'dissolved'>('active');
  React.useEffect(() => localStorage.setItem('ps-parties-view', view), [view]);

  const rows = (list.data ?? []).filter(
    (p) =>
      (status === 'all' || p.status === status) &&
      `${p.nameFi} ${p.abbreviation} ${p.nameSv ?? ''}`.toLowerCase().includes(q.toLowerCase()),
  );

  const add = async () => {
    const abbreviation = `UUSI${Math.floor(Math.random() * 900 + 100)}`;
    try {
      const p = (await create.mutateAsync({ abbreviation, nameFi: 'Uusi puolue', status: 'active' })) as {
        id: string;
      };
      navigate(`/rekisterit/puolueet/${p.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Puolueet"
        description="Puoluerekisteri: nimet, lyhenteet, tunnusvärit ja eduskuntaryhmät. Tunnusväriä käytetään koko sovelluksessa."
        crumbs={[{ label: 'Perusrekisterit' }, { label: 'Puolueet' }]}
        actions={
          can('registries.edit') ? (
            <Button variant="primary" onClick={() => void add()}>
              <Plus /> Lisää puolue
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Suodata nimellä tai lyhenteellä"
            className="pl-9"
            aria-label="Suodata puolueita"
          />
        </div>
        {(['active', 'dissolved', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              'cursor-pointer rounded-full border px-3 py-1 text-sm',
              status === s
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border text-muted hover:text-fg',
            )}
          >
            {s === 'active' ? 'Aktiiviset' : s === 'dissolved' ? 'Lakkautetut' : 'Kaikki'}
          </button>
        ))}
        <div className="ml-auto flex rounded-md border border-border p-0.5">
          <Button
            size="icon-sm"
            variant={view === 'table' ? 'secondary' : 'ghost'}
            onClick={() => setView('table')}
            aria-label="Taulukkonäkymä"
            aria-pressed={view === 'table'}
          >
            <Rows3 />
          </Button>
          <Button
            size="icon-sm"
            variant={view === 'cards' ? 'secondary' : 'ghost'}
            onClick={() => setView('cards')}
            aria-label="Korttinäkymä"
            aria-pressed={view === 'cards'}
          >
            <LayoutGrid />
          </Button>
        </div>
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.isLoading ? <Skeleton className="h-64" /> : null}
      {list.data && !rows.length ? <EmptyState title="Ei puolueita näillä ehdoilla" /> : null}
      {rows.length && view === 'table' ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Puolue</Th>
                <Th>Lyhenne</Th>
                <Th>Eduskuntaryhmä</Th>
                <Th>Tila</Th>
                <Th className="w-10">
                  <span className="sr-only">Lähde</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-surface-2"
                  onClick={() => navigate(`/rekisterit/puolueet/${p.id}`)}
                >
                  <Td>
                    <Link
                      to={`/rekisterit/puolueet/${p.id}`}
                      className="flex items-center gap-2.5 font-medium"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <PartyDot color={p.color} />
                      {p.nameFi}
                    </Link>
                  </Td>
                  <Td className="font-mono text-xs">{p.abbreviation}</Td>
                  <Td className="text-muted">{p.parliamentaryGroupName ?? '–'}</Td>
                  <Td>
                    {p.status === 'active' ? (
                      <Badge tone="success">Aktiivinen</Badge>
                    ) : (
                      <Badge>Lakkautettu</Badge>
                    )}
                  </Td>
                  <Td>
                    <SourceMark source={p.source} manual={p.manualFields.length > 0} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
      {rows.length && view === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <Link
              key={p.id}
              to={`/rekisterit/puolueet/${p.id}`}
              className="group relative overflow-hidden rounded-lg border border-border bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm"
            >
              <span
                className="absolute inset-y-0 left-0 w-1"
                style={{ background: p.color ?? 'transparent' }}
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-subtle">{p.abbreviation}</span>
                <SourceMark source={p.source} manual={p.manualFields.length > 0} />
              </div>
              <div className="mt-1 font-medium group-hover:text-accent">{p.nameFi}</div>
              <div className="mt-0.5 text-sm text-subtle">{p.nameSv}</div>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}

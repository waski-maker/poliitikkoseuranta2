import { Link } from 'react-router';
import { unwrap } from '@ps/sdk';
import { useApi, useQuery } from '@ps/sdk/react';
import { Card, CardBody, CardHeader, ErrorState, PartyDot, Skeleton, Stat, formatDate } from '@ps/ui';
import { useEntityList, type Party } from './hooks.ts';

export function RegistriesCard() {
  const api = useApi();
  const s = useQuery({
    queryKey: ['registries', 'summary'],
    queryFn: () => unwrap(api.GET('/registries/summary')),
  });
  const parties = useEntityList<Party>('parties');
  return (
    <Card className="md:col-span-2 xl:col-span-2">
      <CardHeader
        title="Perusrekisterit"
        description="Nykyinen vaalikausi, hallitus ja puolueet"
        actions={
          <Link to="/rekisterit" className="text-[13px] text-accent hover:underline">
            Avaa
          </Link>
        }
      />
      <CardBody className="grid gap-5">
        {s.error ? <ErrorState error={s.error} /> : null}
        {!s.data ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Vaalikausi"
              value={s.data.currentTerm?.code.replace('-', '–') ?? '–'}
              hint={s.data.currentTerm ? `alkaen ${formatDate(s.data.currentTerm.startDate)}` : undefined}
            />
            <Stat
              label="Hallitus"
              value={<span className="text-lg">{s.data.currentGovernment?.name ?? '–'}</span>}
              hint={
                s.data.currentGovernment
                  ? `alkaen ${formatDate(s.data.currentGovernment.startDate)}`
                  : undefined
              }
            />
            <Stat label="Puolueita" value={s.data.activeParties} hint={`${s.data.parties} kaikkiaan`} />
            <Stat
              label="Valiokuntia ja toimielimiä"
              value={s.data.bodies}
              hint={`${s.data.districts} vaalipiiriä`}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {parties.data
            ?.filter((p) => p.status === 'active')
            .map((p) => (
              <Link
                key={p.id}
                to={`/rekisterit/puolueet/${p.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
              >
                <PartyDot color={p.color} size={8} /> {p.abbreviation}
              </Link>
            ))}
        </div>
      </CardBody>
    </Card>
  );
}

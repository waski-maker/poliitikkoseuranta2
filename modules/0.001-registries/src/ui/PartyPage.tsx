import { Link, useParams } from 'react-router';
import { unwrap } from '@ps/sdk';
import { useApi, usePermissions, useQuery } from '@ps/sdk/react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  InlineEdit,
  PageHeader,
  PartyDot,
  Skeleton,
  SourceMark,
  formatDate,
  readableOn,
  toast,
} from '@ps/ui';
import { useEntity, useEntityList, useEntityMutations, type Party } from './hooks.ts';

function Row({
  label,
  field,
  party,
  kind,
  options,
}: {
  label: string;
  field: keyof Party;
  party: Party;
  kind?: 'text' | 'date' | 'color' | 'url' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
}) {
  const { update } = useEntityMutations('parties');
  const { can } = usePermissions();
  const manual = party.manualFields.includes(String(field).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
  return (
    <div className="grid grid-cols-[160px_1fr_20px] items-center gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-[13px] text-subtle">{label}</span>
      <InlineEdit
        label={label}
        kind={kind}
        options={options}
        disabled={!can('registries.edit')}
        value={party[field] as string | null}
        display={
          kind === 'color' && party.color ? (
            <span className="flex items-center gap-2">
              <PartyDot color={party.color} size={14} />
              <span className="font-mono text-xs">{party.color}</span>
            </span>
          ) : undefined
        }
        onSave={(v) => update.mutateAsync({ id: party.id, patch: { [field]: v } })}
      />
      <SourceMark source={party.source} manual={manual} />
    </div>
  );
}

export function PartyPage() {
  const { id } = useParams();
  const api = useApi();
  const q = useEntity<Party>('parties', id);
  const parties = useEntityList<Party>('parties');
  const { remove, restore } = useEntityMutations('parties');
  const { can } = usePermissions();
  const relations = useQuery({
    queryKey: ['registries', 'relations', id],
    enabled: Boolean(id),
    queryFn: () => unwrap(api.GET('/registries/parties/{id}/relations', { params: { path: { id: id! } } })),
  });
  const governments = useQuery({
    queryKey: ['registries', 'party-governments', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const gs = (await unwrap(api.GET('/registries/governments', { params: { query: { limit: 200 } } })))
        .items;
      const out = [];
      for (const g of gs) {
        const ps = (
          await unwrap(api.GET('/registries/governments/{id}/parties', { params: { path: { id: g.id } } }))
        ).items;
        const mine = ps.find((p) => p.partyId === id);
        if (mine) out.push({ ...g, joinedAt: mine.joinedAt, leftAt: mine.leftAt });
      }
      return out;
    },
  });

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const p = q.data;
  const del = async () => {
    await remove.mutateAsync(p.id);
    toast('Puolue siirretty roskakoriin', {
      action: { label: 'Kumoa', onClick: () => void restore.mutateAsync(p.id) },
    });
  };
  const partyOptions = (parties.data ?? [])
    .filter((x) => x.id !== p.id)
    .map((x) => ({ value: x.id, label: `${x.nameFi} (${x.abbreviation})` }));
  const addRelation = async (relation: 'predecessor' | 'successor', relatedPartyId: string | null) => {
    if (!relatedPartyId) return;
    await unwrap(
      api.POST('/registries/parties/{id}/relations', {
        params: { path: { id: p.id } },
        body: { relatedPartyId, relation },
      }),
    );
    await relations.refetch();
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span
              className="grid size-10 place-items-center rounded-lg text-sm font-bold"
              style={{
                background: p.color ?? 'var(--ps-surface-2)',
                color: p.color ? readableOn(p.color) : undefined,
              }}
            >
              {p.abbreviation.slice(0, 4)}
            </span>
            {p.nameFi}
          </span>
        }
        description={[p.nameSv, p.nameEn].filter(Boolean).join(' · ')}
        crumbs={[
          { label: 'Perusrekisterit' },
          { label: 'Puolueet', href: '/rekisterit/puolueet' },
          { label: p.abbreviation },
        ]}
        renderLink={(c) => (
          <Link to={c.href!} className="hover:text-fg">
            {c.label}
          </Link>
        )}
        actions={
          <>
            {p.status === 'active' ? <Badge tone="success">Aktiivinen</Badge> : <Badge>Lakkautettu</Badge>}
            {can('registries.edit') ? (
              <Button variant="ghost" onClick={() => void del()}>
                Poista
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader
            title="Perustiedot"
            description="Napsauta kenttää muokataksesi; tallennus on automaattinen. K = käsin muokattu (synkronointi ei ylikirjoita)."
          />
          <CardBody>
            <Row party={p} field="nameFi" label="Nimi (suomi)" />
            <Row party={p} field="nameSv" label="Nimi (ruotsi)" />
            <Row party={p} field="nameEn" label="Nimi (englanti)" />
            <Row party={p} field="abbreviation" label="Lyhenne" />
            <Row party={p} field="officialName" label="Virallinen nimi" />
            <Row party={p} field="parliamentaryGroupName" label="Eduskuntaryhmä" />
            <Row party={p} field="color" label="Tunnusväri" kind="color" />
            <Row party={p} field="website" label="Kotisivu" kind="url" />
            <Row party={p} field="registeredAt" label="Rekisteröity" kind="date" />
            <Row party={p} field="deregisteredAt" label="Poistettu rekisteristä" kind="date" />
            <Row
              party={p}
              field="status"
              label="Tila"
              kind="select"
              options={[
                { value: 'active', label: 'Aktiivinen' },
                { value: 'dissolved', label: 'Lakkautettu' },
              ]}
            />
            <Row party={p} field="notes" label="Muistiinpanot" kind="textarea" />
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Edeltäjät ja seuraajat" />
            <CardBody className="grid gap-2 text-sm">
              {relations.data?.items.length ? (
                relations.data.items.map((r) => (
                  <Link
                    key={r.id}
                    to={`/rekisterit/puolueet/${r.relatedPartyId}`}
                    className="flex items-center gap-2 hover:text-accent"
                  >
                    <Badge>{r.relation === 'predecessor' ? 'Edeltäjä' : 'Seuraaja'}</Badge>
                    <PartyDot color={r.relatedParty.color} /> {r.relatedParty.nameFi}
                  </Link>
                ))
              ) : (
                <p className="text-subtle">Ei merkittyjä.</p>
              )}
              {can('registries.edit') ? (
                <div className="mt-2 grid gap-1">
                  <InlineEdit
                    label="Lisää edeltäjä"
                    kind="select"
                    options={partyOptions}
                    value={null}
                    placeholder="+ Lisää edeltäjä"
                    onSave={(v) => addRelation('predecessor', v)}
                  />
                  <InlineEdit
                    label="Lisää seuraaja"
                    kind="select"
                    options={partyOptions}
                    value={null}
                    placeholder="+ Lisää seuraaja"
                    onSave={(v) => addRelation('successor', v)}
                  />
                </div>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Hallituksissa" />
            <CardBody className="grid gap-2 text-sm">
              {governments.isLoading ? <Skeleton className="h-12" /> : null}
              {governments.data?.length ? (
                governments.data.map((g) => (
                  <div key={g.id} className="flex justify-between gap-2">
                    <span>{g.name}</span>
                    <span className="text-xs text-subtle tabular">
                      {formatDate(g.joinedAt ?? g.startDate, { year: 'numeric', month: 'numeric' })}–
                      {g.leftAt || g.endDate
                        ? formatDate(g.leftAt ?? g.endDate, { year: 'numeric', month: 'numeric' })
                        : ''}
                    </span>
                  </div>
                ))
              ) : governments.data ? (
                <p className="text-subtle">Ei hallituskausia rekisterissä.</p>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Alkuperä" />
            <CardBody className="grid gap-1 text-xs text-subtle">
              <span>
                Lähde:{' '}
                {p.source === 'eduskunta'
                  ? 'Eduskunnan avoin data'
                  : p.source === 'seed'
                    ? 'Alkudata'
                    : p.source === 'manual'
                      ? 'Käsin lisätty'
                      : 'Muu'}
              </span>
              {p.fetchedAt ? (
                <span>Noudettu: {formatDate(p.fetchedAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              ) : null}
              <span>Muokattu: {formatDate(p.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              {p.manualFields.length ? <span>Käsin muokatut kentät: {p.manualFields.join(', ')}</span> : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

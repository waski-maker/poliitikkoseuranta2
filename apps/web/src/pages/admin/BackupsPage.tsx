import * as React from 'react';
import { unwrap } from '@ps/sdk';
import { useApi, useMutation, useQuery, useQueryClient } from '@ps/sdk/react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  DialogContent,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  formatDate,
  formatNumber,
  toast,
} from '@ps/ui';
import { uiModules } from '../../modules.ts';

const CONFIRM = 'PALAUTA';

export function BackupsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['backups'],
    queryFn: () => unwrap(api.GET('/backups')),
    refetchInterval: 10_000,
  });
  const [restoreId, setRestoreId] = React.useState<string | null>(null);
  const [moduleRestore, setModuleRestore] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);

  const start = useMutation({
    mutationFn: (body: { kind: 'full' | 'module' | 'verify'; moduleId?: string }) =>
      unwrap(api.POST('/backups/run', { body })),
    onSuccess: () => (
      toast.success('Käynnistetty taustalla'),
      void qc.invalidateQueries({ queryKey: ['backups'] })
    ),
    onError: (e) => toast.error((e as Error).message),
  });
  const download = useMutation({
    mutationFn: (id: string) => unwrap(api.GET('/backups/{id}/download', { params: { path: { id } } })),
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener'),
    onError: (e) => toast.error((e as Error).message),
  });
  const restore = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/backups/{id}/restore', { params: { path: { id: restoreId! } }, body: { confirm } })),
    onSuccess: () => (toast.success('Palautus käynnistetty'), setRestoreId(null), setConfirm('')),
    onError: (e) => toast.error((e as Error).message),
  });
  const exportModule = async (id: string) => {
    const data = await unwrap(
      api.GET('/backups/modules/{moduleId}/export', { params: { path: { moduleId: id }, query: {} } }),
    );
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `moduuli-${id}-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };
  const importModule = useMutation({
    mutationFn: async () => {
      const backup = JSON.parse(await file!.text()) as Record<string, unknown>;
      return unwrap(
        api.POST('/backups/modules/{moduleId}/import', {
          params: { path: { moduleId: moduleRestore! } },
          body: { confirm, backup },
        }),
      );
    },
    onSuccess: (r) => (
      toast.success('Moduulin tiedot palautettu', {
        description: r.restored.map((t) => `${t.table}: ${t.rows}`).join(', '),
      }),
      setModuleRestore(null),
      setConfirm('')
    ),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <>
      <PageHeader
        title="Varmuuskopiot"
        description="Salattu päivittäinen varmuuskopio (7 päivittäistä, 4 viikoittaista, 12 kuukausittaista), kuukausittainen palautustesti ja moduulikohtainen JSON-vienti."
        crumbs={[{ label: 'Ylläpito' }, { label: 'Varmuuskopiot' }]}
        actions={
          <>
            <Button onClick={() => start.mutate({ kind: 'verify' })}>Palautustesti</Button>
            <Button
              variant="primary"
              onClick={() => start.mutate({ kind: 'full' })}
              loading={start.isPending}
            >
              Varmuuskopioi nyt
            </Button>
          </>
        }
      />
      {q.error ? <ErrorState error={q.error} /> : null}
      {q.data && !q.data.encryptionKeySet ? (
        <p className="mb-4 rounded-md bg-warning-soft p-3 text-sm text-warning">
          BACKUP_ENCRYPTION_KEY puuttuu: varmuuskopioita ei voi tehdä ennen kuin salausavain on asetettu.
        </p>
      ) : null}
      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Moduulit"
            description="Yksittäisen moduulin tiedot tarjoajasta riippumattomana JSON-tiedostona. Palautus toimii myös uudempaan ohjelmaversioon."
          />
          <CardBody className="grid gap-2">
            {uiModules.map((m) => (
              <div key={m.manifest.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="text-subtle">{m.manifest.id}</span> {m.manifest.name}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => start.mutate({ kind: 'module', moduleId: m.manifest.id })}>
                    Varmuuskopioi
                  </Button>
                  <Button size="sm" onClick={() => void exportModule(m.manifest.id)}>
                    Lataa JSON
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setModuleRestore(m.manifest.id)}>
                    Palauta…
                  </Button>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Kopiot"
            description={
              q.data
                ? `Kohde: ${q.data.target} · säilytys ${q.data.retention.daily}/${q.data.retention.weekly}/${q.data.retention.monthly}`
                : undefined
            }
          />
          {q.isLoading ? <Skeleton className="m-4 h-24" /> : null}
          {q.data?.items.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Aika</Th>
                  <Th>Tyyppi</Th>
                  <Th>Tila</Th>
                  <Th className="text-right">Koko</Th>
                  <Th>Palautustesti</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((b) => (
                  <tr key={b.id}>
                    <Td>{formatDate(b.startedAt, { dateStyle: 'short', timeStyle: 'short' })}</Td>
                    <Td>
                      {b.kind === 'full'
                        ? 'Täysi'
                        : b.kind === 'module'
                          ? `Moduuli ${b.moduleId}`
                          : b.kind === 'files'
                            ? 'Tiedostot'
                            : 'Ennen migraatiota'}
                      {b.retentionClass ? <span className="text-subtle"> · {b.retentionClass}</span> : null}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          b.status === 'succeeded' ? 'success' : b.status === 'failed' ? 'danger' : 'accent'
                        }
                      >
                        {b.status === 'succeeded'
                          ? 'Valmis'
                          : b.status === 'failed'
                            ? 'Epäonnistui'
                            : 'Käynnissä'}
                      </Badge>
                      {b.error ? <div className="text-xs text-danger">{b.error}</div> : null}
                    </Td>
                    <Td className="text-right">
                      {b.sizeBytes
                        ? `${formatNumber(b.sizeBytes / 1024 / 1024, { maximumFractionDigits: 1 })} Mt`
                        : '–'}
                    </Td>
                    <Td>
                      {b.verifyStatus ? (
                        <Badge
                          tone={b.verifyStatus === 'ok' ? 'success' : 'danger'}
                          title={b.verifyMessage ?? ''}
                        >
                          {b.verifyStatus === 'ok' ? 'OK' : 'Virhe'}
                        </Badge>
                      ) : (
                        '–'
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {b.status === 'succeeded' && b.location ? (
                        <Button size="sm" variant="ghost" onClick={() => download.mutate(b.id)}>
                          Lataa
                        </Button>
                      ) : null}
                      {b.status === 'succeeded' && b.kind === 'full' ? (
                        <Button size="sm" variant="ghost" onClick={() => setRestoreId(b.id)}>
                          Palauta…
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : q.data ? (
            <CardBody>
              <p className="text-sm text-subtle">Ei varmuuskopioita vielä.</p>
            </CardBody>
          ) : null}
        </Card>
      </div>
      <Dialog open={Boolean(restoreId)} onOpenChange={(o) => !o && (setRestoreId(null), setConfirm(''))}>
        <DialogContent
          title="Palauta koko järjestelmä"
          description="Palautus korvaa nykyiset tiedot. Nykytilasta otetaan ensin automaattisesti varmuuskopio."
        >
          <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), restore.mutate())}>
            <Field label={`Kirjoita ${CONFIRM} vahvistaaksesi`}>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
            </Field>
            <Button type="submit" variant="danger" disabled={confirm !== CONFIRM} loading={restore.isPending}>
              Palauta
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(moduleRestore)}
        onOpenChange={(o) => !o && (setModuleRestore(null), setConfirm(''))}
      >
        <DialogContent
          title={`Palauta moduuli ${moduleRestore ?? ''}`}
          description="Valitse moduulin JSON-varmuuskopio. Nykyisistä tiedoista otetaan ensin tilannekuva."
        >
          <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), importModule.mutate())}>
            <Field label="Tiedosto">
              <Input
                type="file"
                accept="application/json"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label={`Kirjoita ${CONFIRM} vahvistaaksesi`}>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button
              type="submit"
              variant="danger"
              disabled={confirm !== CONFIRM || !file}
              loading={importModule.isPending}
            >
              Palauta
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

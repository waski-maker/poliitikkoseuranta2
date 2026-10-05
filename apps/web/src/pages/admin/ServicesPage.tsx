import * as React from 'react';
import { unwrap, type Schemas } from '@ps/sdk';
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
  NativeSelect,
  PageHeader,
  Skeleton,
  formatRelative,
  toast,
} from '@ps/ui';

type Service = Schemas['Service'];
const tone = { ok: 'success', error: 'danger', unknown: 'neutral', disabled: 'neutral' } as const;
const label = { ok: 'Toimii', error: 'Virhe', unknown: 'Ei testattu', disabled: 'Pois käytöstä' } as const;

function ConfigureDialog({ service, onDone }: { service: Service; onDone(): void }) {
  const api = useApi();
  const [provider, setProvider] = React.useState(service.provider);
  const [values, setValues] = React.useState<Record<string, string>>(service.config);
  const option = service.options.find((o) => o.id === provider);
  const save = useMutation({
    mutationFn: () => {
      const config: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const f of option?.fields ?? [])
        if (values[f.key]) (f.secret ? secrets : config)[f.key] = values[f.key]!;
      return unwrap(
        api.PUT('/services/{type}', {
          params: { path: { type: service.type as 'storage' } },
          body: { provider, config, secrets },
        }),
      );
    },
    onSuccess: (r) => {
      (r.ok ? toast.success : toast.error)(
        r.ok ? 'Palvelu vaihdettu ja testattu' : 'Tallennettu, mutta testi epäonnistui',
        { description: r.message },
      );
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
      <Field label="Palveluntarjoaja">
        <NativeSelect value={provider} onChange={(e) => setProvider(e.target.value)}>
          {service.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {option?.fields.map((f) => (
        <Field
          key={f.key}
          label={f.label}
          hint={
            f.secret
              ? service.secretsSet.includes(f.key)
                ? 'Tallennettu salattuna – jätä tyhjäksi, jos et vaihda'
                : 'Tallennetaan salattuna eikä näytetä uudelleen'
              : undefined
          }
        >
          <Input
            type={f.secret ? 'password' : 'text'}
            placeholder={f.placeholder}
            value={values[f.key] ?? ''}
            autoComplete="off"
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        </Field>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Tallenna ja testaa
        </Button>
      </div>
    </form>
  );
}

export function ServicesPage() {
  const api = useApi();
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<Service | null>(null);
  const q = useQuery({ queryKey: ['services'], queryFn: () => unwrap(api.GET('/services')) });
  const test = useMutation({
    mutationFn: (type: string) => unwrap(api.POST('/services/{type}/test', { params: { path: { type } } })),
    onSuccess: (r) => {
      (r.ok ? toast.success : toast.error)(r.ok ? 'Yhteys toimii' : 'Yhteys ei toimi', {
        description: r.message,
      });
      void qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
  return (
    <>
      <PageHeader
        title="Palvelut"
        description="Jokainen ulkoinen palvelu on vaihdettavissa. Moduulit käyttävät palveluita vain ytimen rajapintojen kautta, joten vaihto ei vaadi koodimuutoksia."
        crumbs={[{ label: 'Ylläpito' }, { label: 'Palvelut' }]}
      />
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.isLoading ? <Skeleton className="h-64" /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {q.data?.items.map((s) => (
          <Card key={s.type}>
            <CardHeader
              title={s.label}
              description={s.providerLabel}
              actions={<Badge tone={tone[s.status]}>{label[s.status]}</Badge>}
            />
            <CardBody className="grid gap-3 text-sm">
              {s.message ? <p className="text-muted">{s.message}</p> : null}
              {s.note ? <p className="text-xs text-subtle">{s.note}</p> : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                <span>Viimeksi toiminut: {s.lastOkAt ? formatRelative(s.lastOkAt) : '–'}</span>
                {s.usedBy.length ? (
                  <span>Käyttäjät: {s.usedBy.map((m) => `${m.id} ${m.name}`).join(', ')}</span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => test.mutate(s.type)}
                  loading={test.isPending && test.variables === s.type}
                >
                  Testaa yhteys
                </Button>
                {s.switchable ? (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    Vaihda tarjoaja
                  </Button>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? (
          <DialogContent
            title={`Vaihda: ${editing.label}`}
            description="Jos uudet asetukset eivät toimi, aiemmat palautetaan automaattisesti."
          >
            <ConfigureDialog
              service={editing}
              onDone={() => (setEditing(null), void qc.invalidateQueries({ queryKey: ['services'] }))}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

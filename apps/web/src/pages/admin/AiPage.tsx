import * as React from 'react';
import { unwrap, type Schemas } from '@ps/sdk';
import { useApi, useMutation, useQuery, useQueryClient } from '@ps/sdk/react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Skeleton,
  Switch,
  Table,
  Td,
  Th,
  formatNumber,
  toast,
} from '@ps/ui';

type Settings = Schemas['AiSettings'];
const TASKS = [
  { key: 'default', label: 'Oletus' },
  { key: 'analysis', label: 'Analyysit (raskas malli)' },
  { key: 'summary', label: 'Tiivistelmät' },
  { key: 'classification', label: 'Luokittelu (kevyt malli)' },
  { key: 'chat', label: 'Keskustelu aineiston kanssa' },
] as const;

export function AiPage() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai-settings'], queryFn: () => unwrap(api.GET('/ai/settings')) });
  const usage = useQuery({
    queryKey: ['ai-usage'],
    queryFn: () => unwrap(api.GET('/ai/usage', { params: { query: { days: 30 } } })),
  });
  const [draft, setDraft] = React.useState<Settings | null>(null);
  const [keys, setKeys] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (q.data && !draft) setDraft(q.data.settings);
  }, [q.data, draft]);

  const save = useMutation({
    mutationFn: async () => {
      for (const [name, apiKey] of Object.entries(keys))
        if (apiKey)
          await unwrap(api.PUT('/ai/providers/{name}/key', { params: { path: { name } }, body: { apiKey } }));
      await unwrap(api.PUT('/ai/settings', { body: draft! }));
    },
    onSuccess: () => {
      toast.success('Tekoälyasetukset tallennettu');
      setKeys({});
      void qc.invalidateQueries({ queryKey: ['ai-settings'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const test = useMutation({
    mutationFn: (p: { name: string; model?: string }) =>
      unwrap(
        api.POST('/ai/providers/{name}/test', {
          params: { path: { name: p.name } },
          body: { model: p.model },
        }),
      ),
    onSuccess: (r) =>
      (r.ok ? toast.success : toast.error)(r.ok ? 'Yhteys toimii' : 'Yhteys ei toimi', {
        description: `${r.message} (${r.latencyMs} ms)`,
      }),
  });

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!draft || !q.data) return <Skeleton className="h-96" />;
  const providers = draft.providers.map((p) => p.name);
  const setTask = (key: string, patch: Partial<Settings['tasks']['default']> | null) => {
    const tasks = { ...draft.tasks } as Record<string, Settings['tasks']['default'] | undefined>;
    if (patch === null) delete tasks[key];
    else tasks[key] = { ...(tasks[key] ?? draft.tasks.default), ...patch };
    setDraft({ ...draft, tasks: tasks as Settings['tasks'] });
  };

  return (
    <>
      <PageHeader
        title="Tekoäly"
        description="Valitse tekoälypalvelu ja malli tehtävittäin. API-avaimet tallennetaan salattuina palvelimelle eikä niitä näytetä tallennuksen jälkeen."
        crumbs={[{ label: 'Ylläpito' }, { label: 'Tekoäly' }]}
        actions={
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Tallenna
          </Button>
        }
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Palvelut"
            description="Anthropic, OpenAI ja OpenAI-yhteensopivat (esim. Ollama, vLLM, LM Studio)."
          />
          <CardBody className="grid gap-4">
            {draft.providers.map((p, i) => (
              <div
                key={p.name}
                className="grid items-end gap-3 border-b border-border pb-4 last:border-0 last:pb-0 md:grid-cols-[1fr_1fr_1.4fr_1fr_auto]"
              >
                <div className="grid gap-1">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="flex gap-1">
                    <Badge>{p.kind}</Badge>
                    {p.internal ? <Badge tone="success">sisäinen</Badge> : null}
                    {q.data.keysSet.includes(p.name) ? <Badge tone="accent">avain asetettu</Badge> : null}
                  </span>
                </div>
                <Field label="Oletusmalli">
                  <Input
                    list={`models-${p.name}`}
                    value={p.defaultModel}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        providers: draft.providers.map((x, k) =>
                          k === i ? { ...x, defaultModel: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <datalist id={`models-${p.name}`}>
                    {q.data.knownModels[p.name]?.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Palvelun osoite">
                  <Input
                    value={p.baseUrl ?? ''}
                    placeholder={p.kind === 'openai-compatible' ? 'http://localhost:11434/v1' : 'oletus'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        providers: draft.providers.map((x, k) =>
                          k === i ? { ...x, baseUrl: e.target.value || undefined } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="API-avain">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={q.data.keysSet.includes(p.name) ? '•••••• (tallennettu)' : ''}
                    value={keys[p.name] ?? ''}
                    onChange={(e) => setKeys({ ...keys, [p.name]: e.target.value })}
                  />
                </Field>
                <Button
                  size="sm"
                  onClick={() => test.mutate({ name: p.name })}
                  loading={test.isPending && test.variables?.name === p.name}
                >
                  Testaa yhteys
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Tehtäväkohtainen malli"
            description="Esim. raskas malli analyyseihin, kevyt ja edullinen luokitteluun."
          />
          <CardBody className="grid gap-3">
            {TASKS.map((tk) => {
              const route = (draft.tasks as Record<string, Settings['tasks']['default'] | undefined>)[tk.key];
              return (
                <div key={tk.key} className="grid items-end gap-3 md:grid-cols-[1.2fr_1fr_1fr_0.6fr]">
                  <span className="text-sm">
                    {tk.label}
                    {!route && tk.key !== 'default' ? (
                      <span className="text-subtle"> – käyttää oletusta</span>
                    ) : null}
                  </span>
                  <NativeSelect
                    aria-label={`${tk.label}: palvelu`}
                    value={route?.provider ?? ''}
                    onChange={(e) =>
                      e.target.value
                        ? setTask(tk.key, {
                            provider: e.target.value,
                            model: draft.providers.find((p) => p.name === e.target.value)!.defaultModel,
                          })
                        : setTask(tk.key, null)
                    }
                  >
                    {tk.key !== 'default' ? <option value="">Oletus</option> : null}
                    {providers.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label={`${tk.label}: malli`}
                    disabled={!route}
                    value={route?.model ?? ''}
                    onChange={(e) => setTask(tk.key, { model: e.target.value })}
                  />
                  <Input
                    aria-label={`${tk.label}: enimmäispituus`}
                    type="number"
                    placeholder="max tokens"
                    disabled={!route}
                    value={route?.maxTokens ?? ''}
                    onChange={(e) =>
                      setTask(tk.key, { maxTokens: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </div>
              );
            })}
            <div className="grid gap-3 border-t border-border pt-4 md:grid-cols-3">
              <Field label="Varapalvelu, jos ensisijainen ei vastaa">
                <NativeSelect
                  value={draft.fallbackProvider ?? ''}
                  onChange={(e) => setDraft({ ...draft, fallbackProvider: e.target.value || null })}
                >
                  <option value="">Ei varapalvelua</option>
                  {providers.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Upotemalli (semanttinen haku)" hint="Vaihto laskee upotteet uudelleen taustalla.">
                <div className="flex gap-2">
                  <NativeSelect
                    value={draft.embedding?.provider ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        embedding: e.target.value
                          ? { provider: e.target.value, model: draft.embedding?.model ?? '' }
                          : null,
                      })
                    }
                  >
                    <option value="">Ei käytössä</option>
                    {providers.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label="Upotemalli"
                    value={draft.embedding?.model ?? ''}
                    disabled={!draft.embedding}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        embedding: { provider: draft.embedding!.provider, model: e.target.value },
                      })
                    }
                  />
                </div>
              </Field>
              <div className="grid gap-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  Ei-julkinen tieto vain sisäiselle mallille
                  <Switch
                    checked={draft.nonPublicOnlyInternal}
                    onCheckedChange={(v) => setDraft({ ...draft, nonPublicOnlyInternal: v })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  Välimuisti (samat kysymykset eivät maksa uudelleen)
                  <Switch
                    checked={draft.cacheEnabled}
                    onCheckedChange={(v) => setDraft({ ...draft, cacheEnabled: v })}
                  />
                </label>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Käyttö (30 päivää)"
            description="Kutsut, tokenit, kesto ja arvioitu kustannus palveluittain."
          />
          {usage.data?.items.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Palvelu</Th>
                  <Th>Malli</Th>
                  <Th className="text-right">Kutsut</Th>
                  <Th className="text-right">Virheet</Th>
                  <Th className="text-right">Tokenit (sis./ulos)</Th>
                  <Th className="text-right">Kesto</Th>
                  <Th className="text-right">Kustannus</Th>
                </tr>
              </thead>
              <tbody>
                {usage.data.items.map((u) => (
                  <tr key={`${u.provider}${u.model}`}>
                    <Td>{u.provider}</Td>
                    <Td>{u.model}</Td>
                    <Td className="text-right">
                      {formatNumber(u.calls)}
                      {u.cachedCalls ? (
                        <span className="text-subtle"> ({u.cachedCalls} välimuistista)</span>
                      ) : null}
                    </Td>
                    <Td className="text-right">{u.failures}</Td>
                    <Td className="text-right">
                      {formatNumber(u.inputTokens)} / {formatNumber(u.outputTokens)}
                    </Td>
                    <Td className="text-right">{formatNumber(u.avgDurationMs)} ms</Td>
                    <Td className="text-right">
                      {formatNumber(u.costUsd, {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 4,
                      })}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody>
              <p className="text-sm text-subtle">Ei kutsuja vielä.</p>
            </CardBody>
          )}
        </Card>
      </div>
    </>
  );
}

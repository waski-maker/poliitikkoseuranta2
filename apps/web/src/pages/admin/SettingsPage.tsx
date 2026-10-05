import * as React from 'react';
import { unwrap } from '@ps/sdk';
import { useApi, useMutation, useQuery } from '@ps/sdk/react';
import { Card, CardBody, CardHeader, Input, PageHeader, Skeleton, Switch, toast } from '@ps/ui';
import { uiModules } from '../../modules.ts';

function ModuleSettings({ moduleId }: { moduleId: string }) {
  const api = useApi();
  const m = uiModules.find((x) => x.manifest.id === moduleId)!.manifest;
  const q = useQuery({
    queryKey: ['settings', moduleId],
    queryFn: () => unwrap(api.GET('/modules/{moduleId}/settings', { params: { path: { moduleId } } })),
  });
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      unwrap(api.PUT('/modules/{moduleId}/settings', { params: { path: { moduleId } }, body: { values } })),
    onSuccess: () => toast.success('Tallennettu'),
    onError: (e) => toast.error((e as Error).message),
  });
  const [values, setValues] = React.useState<Record<string, unknown> | null>(null);
  React.useEffect(() => {
    if (q.data && !values) setValues(q.data.values);
  }, [q.data, values]);
  if (!m.settings.length) return null;
  return (
    <Card>
      <CardHeader title={`${m.id} ${m.name}`} description={m.description} />
      <CardBody className="grid gap-4">
        {!values ? <Skeleton className="h-10" /> : null}
        {values &&
          m.settings.map((s) => (
            <label key={s.key} className="flex items-center justify-between gap-4 text-sm">
              <span className="grid gap-0.5">
                <span className="font-medium">{s.label}</span>
                {s.description ? <span className="text-xs text-subtle">{s.description}</span> : null}
              </span>
              {s.type === 'boolean' ? (
                <Switch
                  checked={Boolean(values[s.key])}
                  onCheckedChange={(v) => {
                    const next = { ...values, [s.key]: v };
                    setValues(next);
                    save.mutate({ [s.key]: v });
                  }}
                />
              ) : (
                <Input
                  className="max-w-60"
                  value={String(values[s.key] ?? '')}
                  onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                  onBlur={(e) =>
                    save.mutate({ [s.key]: s.type === 'number' ? Number(e.target.value) : e.target.value })
                  }
                />
              )}
            </label>
          ))}
      </CardBody>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Asetukset"
        description="Moduulikohtaiset asetukset tallentuvat heti."
        crumbs={[{ label: 'Ylläpito' }, { label: 'Asetukset' }]}
      />
      <div className="grid gap-4">
        {uiModules.map((m) => (
          <ModuleSettings key={m.manifest.id} moduleId={m.manifest.id} />
        ))}
      </div>
    </>
  );
}

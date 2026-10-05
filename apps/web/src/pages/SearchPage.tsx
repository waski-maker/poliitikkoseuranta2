import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { unwrap } from '@ps/sdk';
import { useApi, useQuery } from '@ps/sdk/react';
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, PartyDot, Skeleton, cn } from '@ps/ui';

/** Global search; criteria live in the URL so searches can be shared as links. */
export function SearchPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const mode = (params.get('mode') ?? 'text') as 'text' | 'semantic';
  const [input, setInput] = React.useState(q);
  React.useEffect(() => {
    const id = setTimeout(() => {
      if (input !== q)
        setParams((p) => (input ? (p.set('q', input), p) : (p.delete('q'), p)), { replace: true });
    }, 200);
    return () => clearTimeout(id);
  }, [input, q, setParams]);
  const res = useQuery({
    queryKey: ['search', q, type, mode],
    enabled: q.length >= 2,
    queryFn: () =>
      unwrap(api.GET('/search', { params: { query: { q, types: type || undefined, mode, limit: 50 } } })),
  });
  const setParam = (k: string, v: string) =>
    setParams((p) => (v ? p.set(k, v) : p.delete(k), p), { replace: true });

  return (
    <>
      <PageHeader
        title="Haku"
        description="Hae kaikista moduuleista. Suomen kielen taivutusmuodot löytyvät automaattisesti; lainausmerkit = tarkka fraasi, OR = tai, -sana = ei."
      />
      <div className="grid gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Esim. vihreät, perustuslakivaliokunta, Orpo"
            className="h-11 pl-9 text-base"
            autoFocus
            aria-label="Hakusana"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[{ type: '', label: 'Kaikki' }, ...(res.data?.types ?? [])].map((t) => (
            <button
              key={t.type}
              onClick={() => setParam('type', t.type)}
              className={cn(
                'cursor-pointer rounded-full border px-3 py-1',
                type === t.type
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          {(['text', 'semantic'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setParam('mode', m === 'text' ? '' : m)}
              className={cn(
                'cursor-pointer rounded-full border px-3 py-1',
                mode === m
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-muted hover:text-fg',
              )}
            >
              {m === 'text' ? 'Tekstihaku' : 'Semanttinen'}
            </button>
          ))}
        </div>
        {res.error ? <ErrorState error={res.error} onRetry={() => res.refetch()} /> : null}
        {q.length < 2 ? (
          <EmptyState title="Kirjoita vähintään kaksi merkkiä" icon={<Search className="size-5" />} />
        ) : null}
        {res.isLoading ? <Skeleton className="h-40" /> : null}
        {res.data && !res.data.hits.length ? (
          <EmptyState title="Ei osumia" description="Kokeile toista hakusanaa tai semanttista hakua." />
        ) : null}
        {res.data?.hits.length ? (
          <Card className="divide-y divide-border">
            {res.data.hits.map((h) => (
              <Link
                key={`${h.contentType}:${h.refId}`}
                to={h.urlPath ?? '#'}
                className="grid gap-1 px-5 py-3.5 hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  {typeof h.meta.color === 'string' ? <PartyDot color={h.meta.color} /> : null}
                  <span className="font-medium">{h.title}</span>
                  <Badge>
                    {res.data.types.find((t) => t.type === h.contentType)?.label ?? h.contentType}
                  </Badge>
                </div>
                {/* Snippets come from ts_headline over our own index; only <mark> tags are produced. */}
                {h.snippet ? (
                  <p
                    className="text-sm text-muted [&_mark]:rounded [&_mark]:bg-accent-soft [&_mark]:px-0.5 [&_mark]:text-fg"
                    dangerouslySetInnerHTML={{ __html: sanitize(h.snippet) }}
                  />
                ) : null}
              </Link>
            ))}
          </Card>
        ) : null}
      </div>
    </>
  );
}

function sanitize(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

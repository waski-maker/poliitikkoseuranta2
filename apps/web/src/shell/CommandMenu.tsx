import * as React from 'react';
import { useNavigate } from 'react-router';
import { useApi, useQuery } from '@ps/sdk/react';
import { unwrap } from '@ps/sdk';
import { CommandEmpty, CommandGroup, CommandItem, CommandPalette, Icon, PartyDot, Spinner } from '@ps/ui';
import { useAuth } from '../auth/AuthProvider.tsx';
import { uiModules } from '../modules.ts';

const ACTIONS = [
  { id: 'search', label: 'Avaa haku', path: '/haku', icon: 'Search', permission: 'core.search' },
  { id: 'jobs', label: 'Taustatyöt', path: '/tyot', icon: 'ListChecks' },
  {
    id: 'sync',
    label: 'Synkronoinnit: päivitä tietolähteet',
    path: '/yllapito/synkronoinnit',
    icon: 'RefreshCw',
    permission: 'core.sync',
  },
  {
    id: 'backup',
    label: 'Varmuuskopioi nyt',
    path: '/yllapito/varmuuskopiot',
    icon: 'DatabaseBackup',
    permission: 'core.backup',
  },
  { id: 'ai', label: 'Tekoälyasetukset', path: '/yllapito/tekoaly', icon: 'Sparkles', permission: 'core.ai' },
  {
    id: 'services',
    label: 'Palvelut',
    path: '/yllapito/palvelut',
    icon: 'Plug',
    permission: 'core.services',
  },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Ctrl/⌘+K: search anything (all modules via /search) and run actions. */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const api = useApi();
  const auth = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = React.useState('');
  const q = useDebounced(search.trim(), 150);
  const results = useQuery({
    queryKey: ['palette', q],
    enabled: open && q.length >= 2 && auth.can('core.search'),
    queryFn: () => unwrap(api.GET('/search', { params: { query: { q, limit: 8 } } })),
  });
  const go = (path: string) => {
    onOpenChange(false);
    setSearch('');
    navigate(path);
  };
  const lower = search.toLowerCase();
  const nav = [
    ...uiModules.flatMap((m) =>
      m.manifest.menu.map((i) => ({
        id: i.path,
        label: i.label,
        path: i.path,
        icon: i.icon,
        permission: i.permission,
      })),
    ),
    ...uiModules.flatMap((m) => (m.ui.commands ?? []).map((c) => ({ ...c, icon: 'ArrowRight' }))),
    ...ACTIONS,
  ].filter((a) => (!a.permission || auth.can(a.permission)) && a.label.toLowerCase().includes(lower));

  return (
    <CommandPalette open={open} onOpenChange={onOpenChange} search={search} onSearchChange={setSearch}>
      {results.isFetching ? (
        <div className="flex justify-center py-3">
          <Spinner />
        </div>
      ) : null}
      {results.data?.hits.length ? (
        <CommandGroup heading="Tulokset">
          {results.data.hits.map((h) => (
            <CommandItem
              key={`${h.contentType}:${h.refId}`}
              value={`${h.contentType}:${h.refId}`}
              onSelect={() => h.urlPath && go(h.urlPath)}
            >
              {typeof h.meta.color === 'string' ? (
                <PartyDot color={h.meta.color} />
              ) : (
                <Icon name="FileText" />
              )}
              <span className="flex-1 truncate">{h.title}</span>
              <span className="text-xs text-subtle">
                {results.data.types.find((t) => t.type === h.contentType)?.label}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {nav.length ? (
        <CommandGroup heading="Siirry ja toiminnot">
          {nav.map((a) => (
            <CommandItem key={a.id} value={`nav:${a.id}`} onSelect={() => go(a.path)}>
              <Icon name={a.icon} />
              {a.label}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {!nav.length && !results.data?.hits.length && !results.isFetching ? (
        <CommandEmpty>Ei tuloksia haulle “{search}”</CommandEmpty>
      ) : null}
    </CommandPalette>
  );
}

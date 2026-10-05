import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Bell, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  Kbd,
  Tooltip,
  cn,
  useTheme,
} from '@ps/ui';
import { useAuth } from '../auth/AuthProvider.tsx';
import { t } from '../i18n.ts';
import { uiModules } from '../modules.ts';
import { CommandMenu } from './CommandMenu.tsx';
import { NotificationsMenu } from './NotificationsMenu.tsx';
import { useRealtimeInvalidation } from '../realtime/live.ts';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  permission?: string;
}

const CORE_MAIN: NavItem[] = [
  { label: t('nav.dashboard'), path: '/', icon: 'LayoutDashboard' },
  { label: t('nav.search'), path: '/haku', icon: 'Search', permission: 'core.search' },
];

const CORE_ADMIN: NavItem[] = [
  { label: t('nav.jobs'), path: '/tyot', icon: 'ListChecks' },
  { label: t('nav.sync'), path: '/yllapito/synkronoinnit', icon: 'RefreshCw', permission: 'core.sync' },
  { label: t('nav.services'), path: '/yllapito/palvelut', icon: 'Plug', permission: 'core.services' },
  { label: t('nav.ai'), path: '/yllapito/tekoaly', icon: 'Sparkles', permission: 'core.ai' },
  {
    label: t('nav.backups'),
    path: '/yllapito/varmuuskopiot',
    icon: 'DatabaseBackup',
    permission: 'core.backup',
  },
  { label: t('nav.audit'), path: '/yllapito/muutoshistoria', icon: 'History', permission: 'core.audit' },
  { label: t('nav.trash'), path: '/yllapito/roskakori', icon: 'Trash2', permission: 'core.trash' },
  { label: t('nav.settings'), path: '/yllapito/asetukset', icon: 'Settings', permission: 'core.settings' },
  { label: t('nav.users'), path: '/yllapito/kayttajat', icon: 'Users', permission: 'core.admin' },
];

function NavGroup({
  title,
  items,
  collapsed,
  active,
  onNavigate,
}: {
  title?: string;
  items: NavItem[];
  collapsed: boolean;
  active: string | null;
  onNavigate?: () => void;
}) {
  if (!items.length) return null;
  return (
    <div className="grid gap-0.5">
      {title && !collapsed ? (
        <div className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-subtle">
          {title}
        </div>
      ) : null}
      {title && collapsed ? <div className="my-2 h-px bg-border" /> : null}
      {items.map((item) => {
        const link = (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            aria-current={active === item.path ? 'page' : undefined}
            className={() =>
              cn(
                'flex h-8 items-center gap-2.5 rounded-md px-3 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg',
                active === item.path && 'bg-surface-2 font-medium text-fg',
                collapsed && 'justify-center px-0',
              )
            }
          >
            <Icon name={item.icon} className="size-4 shrink-0" />
            {collapsed ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <span className="truncate">{item.label}</span>
            )}
          </NavLink>
        );
        return collapsed ? (
          <Tooltip key={item.path} content={item.label}>
            {link}
          </Tooltip>
        ) : (
          link
        );
      })}
    </div>
  );
}

export function AppShell() {
  const auth = useAuth();
  const { resolved, toggle } = useTheme();
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem('ps-sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const location = useLocation();
  useRealtimeInvalidation();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  React.useEffect(() => localStorage.setItem('ps-sidebar', collapsed ? 'collapsed' : 'open'), [collapsed]);
  React.useEffect(() => setMobileOpen(false), [location.pathname]);

  const visible = (i: NavItem) => !i.permission || auth.can(i.permission);
  const moduleItems: NavItem[] = uiModules
    .flatMap((m) => m.manifest.menu.filter((i) => (i.section ?? 'main') === 'main'))
    .sort((a, b) => a.order - b.order);
  const main = [...CORE_MAIN, ...moduleItems].filter(visible);
  const admin = CORE_ADMIN.filter(visible);
  // Highlight the most specific menu item that matches the current path.
  const active =
    [...main, ...admin]
      .map((i) => i.path)
      .filter((p) =>
        p === '/'
          ? location.pathname === '/'
          : location.pathname === p || location.pathname.startsWith(`${p}/`),
      )
      .sort((a, b) => b.length - a.length)[0] ?? null;

  const sidebar = (isMobile: boolean) => (
    <div className="flex h-full flex-col gap-2 p-3">
      <div
        className={cn('flex h-10 items-center gap-2 px-2', collapsed && !isMobile && 'justify-center px-0')}
      >
        <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-fg">
          P
        </div>
        {!collapsed || isMobile ? (
          <span className="truncate text-sm font-semibold tracking-tight">{t('app.name')}</span>
        ) : null}
      </div>
      <nav aria-label="Päävalikko" className="flex-1 overflow-y-auto">
        <NavGroup items={main} active={active} collapsed={collapsed && !isMobile} />
        <NavGroup title={t('nav.admin')} items={admin} active={active} collapsed={collapsed && !isMobile} />
      </nav>
      {!isMobile ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="self-end"
          onClick={() => setCollapsed((c) => !c)}
          aria-label="Pienennä tai laajenna sivupalkki"
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Siirry sisältöön
      </a>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 border-r border-border bg-surface transition-[width] duration-200 md:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {sidebar(false)}
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface shadow-lg animate-fade-in">
            {sidebar(true)}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur md:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Avaa valikko"
          >
            <Menu />
          </Button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full min-w-0 max-w-md cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-subtle shadow-xs transition-colors hover:border-border-strong"
          >
            <Search className="size-4" />
            <span className="flex-1 truncate text-left">{t('search.placeholder')}</span>
            <span className="hidden sm:inline">
              <Kbd>Ctrl K</Kbd>
            </span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <NotificationsMenu icon={<Bell />} />
            <Tooltip content={t('theme.toggle')}>
              <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={t('theme.toggle')}>
                {resolved === 'dark' ? <Sun /> : <Moon />}
              </Button>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Käyttäjävalikko">
                  <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                    {auth.user?.email.slice(0, 1).toUpperCase()}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {auth.user?.email}
                  <br />
                  {auth.user?.roles.join(', ')}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void auth.signOut()}>
                  <LogOut /> {t('auth.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8 animate-fade-in"
          key={location.pathname}
        >
          <Outlet />
        </main>
      </div>
      <CommandMenu open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

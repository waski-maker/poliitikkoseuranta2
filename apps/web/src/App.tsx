import { Route, Routes } from 'react-router';
import { PermissionsProvider } from '@ps/sdk/react';
import { Spinner } from '@ps/ui';
import { useAuth } from './auth/AuthProvider.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { AppShell } from './shell/AppShell.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { JobsPage } from './pages/JobsPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { ServicesPage } from './pages/admin/ServicesPage.tsx';
import { AiPage } from './pages/admin/AiPage.tsx';
import { SyncPage } from './pages/admin/SyncPage.tsx';
import { BackupsPage } from './pages/admin/BackupsPage.tsx';
import { TrashPage } from './pages/admin/TrashPage.tsx';
import { AuditPage } from './pages/admin/AuditPage.tsx';
import { SettingsPage } from './pages/admin/SettingsPage.tsx';
import { UsersPage } from './pages/admin/UsersPage.tsx';
import { uiModules } from './modules.ts';

export function App() {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (auth.status !== 'signedIn') return <LoginPage />;
  return (
    <PermissionsProvider value={{ can: auth.can }}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="haku" element={<SearchPage />} />
          <Route path="tyot" element={<JobsPage />} />
          <Route path="tyot/:id" element={<JobsPage />} />
          <Route path="yllapito/palvelut" element={<ServicesPage />} />
          <Route path="yllapito/tekoaly" element={<AiPage />} />
          <Route path="yllapito/synkronoinnit" element={<SyncPage />} />
          <Route path="yllapito/varmuuskopiot" element={<BackupsPage />} />
          <Route path="yllapito/roskakori" element={<TrashPage />} />
          <Route path="yllapito/muutoshistoria" element={<AuditPage />} />
          <Route path="yllapito/asetukset" element={<SettingsPage />} />
          <Route path="yllapito/kayttajat" element={<UsersPage />} />
          {uiModules.flatMap((m) =>
            m.ui.routes.map((r) => (
              <Route key={`${m.manifest.id}${r.path}`} path={r.path.replace(/^\//, '')} element={r.element} />
            )),
          )}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </PermissionsProvider>
  );
}

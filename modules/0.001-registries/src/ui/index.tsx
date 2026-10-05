import type { UiModule } from '@ps/sdk/react';
import { Navigate, useParams } from 'react-router';
import { PartiesPage } from './PartiesPage.tsx';
import { PartyPage } from './PartyPage.tsx';
import { RegistriesPage } from './RegistriesPage.tsx';
import { RegistriesCard } from './DashboardCard.tsx';

function RedirectToTab({ tab }: { tab: string }) {
  useParams();
  return <Navigate to={`/rekisterit?valilehti=${tab}`} replace />;
}

/** UI of module 0.001 Perusrekisterit. */
export const registriesUi: UiModule = {
  id: '0.001',
  routes: [
    { path: '/rekisterit', element: <RegistriesPage /> },
    { path: '/rekisterit/puolueet', element: <PartiesPage /> },
    { path: '/rekisterit/puolueet/:id', element: <PartyPage /> },
    { path: '/rekisterit/hallitukset/:id', element: <RedirectToTab tab="hallitukset" /> },
    { path: '/rekisterit/valiokunnat/:id', element: <RedirectToTab tab="valiokunnat" /> },
  ],
  dashboardCards: [{ id: 'registries-summary', permission: 'registries.read', Component: RegistriesCard }],
  commands: [
    {
      id: 'registries-terms',
      label: 'Vaalikaudet',
      path: '/rekisterit?valilehti=vaalikaudet',
      permission: 'registries.read',
    },
    {
      id: 'registries-governments',
      label: 'Hallitukset',
      path: '/rekisterit?valilehti=hallitukset',
      permission: 'registries.read',
    },
    {
      id: 'registries-districts',
      label: 'Vaalipiirit',
      path: '/rekisterit?valilehti=vaalipiirit',
      permission: 'registries.read',
    },
    {
      id: 'registries-bodies',
      label: 'Valiokunnat ja toimielimet',
      path: '/rekisterit?valilehti=valiokunnat',
      permission: 'registries.read',
    },
  ],
};

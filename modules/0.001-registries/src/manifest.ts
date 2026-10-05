import { defineManifest } from '@ps/core/manifest';

export const manifest = defineManifest({
  id: '0.001',
  slug: 'registries',
  name: 'Perusrekisterit',
  description:
    'Puolueet, eduskuntaryhmät, vaalipiirit, vaalikaudet, hallitukset, valiokunnat ja luottamustoimien tyypit, joihin muut moduulit viittaavat.',
  version: '0.1.0',
  dependsOn: [],
  dbSchema: 'm0001_registries',
  migrations: ['20261005001000_m0001_registries.sql'],
  apiBasePath: '/registries',
  provides: [
    'registries.parties',
    'registries.terms',
    'registries.governments',
    'registries.districts',
    'registries.bodies',
  ],
  events: {
    publishes: [
      { type: 'party.created', version: 1, description: 'Puolue lisättiin' },
      { type: 'party.updated', version: 1, description: 'Puolueen tietoja muutettiin' },
      { type: 'party.changed', version: 1, description: 'Puolueen tila, nimi tai lyhenne muuttui' },
      { type: 'registry.updated', version: 1, description: 'Muu perusrekisterin tieto muuttui' },
    ],
    subscribes: [],
  },
  menu: [
    {
      label: 'Puolueet',
      path: '/rekisterit/puolueet',
      icon: 'Flag',
      permission: 'registries.read',
      order: 50,
      section: 'main',
    },
    {
      label: 'Perusrekisterit',
      path: '/rekisterit',
      icon: 'Library',
      permission: 'registries.read',
      order: 60,
      section: 'main',
    },
  ],
  permissions: [
    { id: 'registries.read', description: 'Perusrekisterien luku', roles: ['editor', 'analyst', 'reader'] },
    { id: 'registries.edit', description: 'Perusrekisterien muokkaus', roles: ['editor'] },
    { id: 'registries.sync', description: 'Perusrekisterien päivitys eduskunnan datasta', roles: ['editor'] },
  ],
  settings: [
    {
      key: 'autoLinkGroups',
      label: 'Yhdistä eduskuntaryhmät puolueisiin automaattisesti',
      description:
        'Synkronointi yhdistää eduskuntaryhmän puolueeseen ryhmätunnuksen etuliitteen perusteella.',
      type: 'boolean',
      default: true,
    },
  ],
  services: ['database', 'storage', 'jobs'],
  dataSources: [
    {
      id: 'eduskunta',
      name: 'Eduskunnan avoin data (api.eduskunta.fi)',
      url: 'https://api.eduskunta.fi/api/v1/reference-data/',
      license: 'CC BY 4.0',
      description: 'Viitetiedot: eduskuntaryhmät, vaalipiirit, vaalikaudet, valiokunnat.',
    },
    {
      id: 'om-puoluerekisteri',
      name: 'Oikeusministeriön puoluerekisteri (vaalit.fi)',
      url: 'https://vaalit.fi/puoluerekisteri',
      description: 'Puolueiden viralliset nimet ja rekisteröinti; alkudata koottu käsin.',
    },
  ],
  backup: {
    schemaVersion: 1,
    irreplaceable: [
      {
        table: 'm0001_registries.parties',
        description: 'Puolueet (käsin lisätyt ja muokatut, värit, logot)',
      },
      { table: 'm0001_registries.party_relations', description: 'Edeltäjä- ja seuraajapuolueet' },
      { table: 'm0001_registries.governments', description: 'Hallitukset' },
      { table: 'm0001_registries.government_parties', description: 'Hallituspuolueet' },
      { table: 'm0001_registries.position_types', description: 'Luottamustoimien tyypit' },
    ],
    reproducible: [
      { table: 'm0001_registries.parliamentary_groups', description: 'Eduskuntaryhmät (eduskunnan data)' },
      { table: 'm0001_registries.electoral_districts', description: 'Vaalipiirit' },
      { table: 'm0001_registries.electoral_terms', description: 'Vaalikaudet' },
      { table: 'm0001_registries.bodies', description: 'Valiokunnat ja toimielimet' },
    ],
    files: { irreplaceable: ['registries/logos/'], reproducible: [] },
  },
  searchTypes: [
    { type: 'party', label: 'Puolue', readPermission: 'registries.read' },
    { type: 'government', label: 'Hallitus', readPermission: 'registries.read' },
    { type: 'body', label: 'Valiokunta / toimielin', readPermission: 'registries.read' },
  ],
  dashboardCards: [{ id: 'registries-summary', title: 'Perusrekisterit', permission: 'registries.read' }],
});

import { useSearchParams, Link } from 'react-router';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@ps/ui';
import { EntityTable } from './EntityTable.tsx';
import { useEntityList, type Party } from './hooks.ts';

const today = () => new Date().toISOString().slice(0, 10);
const byDateDesc = (k: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(b[k] ?? '').localeCompare(String(a[k] ?? ''));
const byName = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(a.nameFi ?? a.name).localeCompare(String(b.nameFi ?? b.name), 'fi');
const rnd = () => Math.random().toString(36).slice(2, 6).toUpperCase();

const TABS = [
  { id: 'vaalikaudet', label: 'Vaalikaudet' },
  { id: 'hallitukset', label: 'Hallitukset' },
  { id: 'vaalipiirit', label: 'Vaalipiirit' },
  { id: 'valiokunnat', label: 'Valiokunnat ja toimielimet' },
  { id: 'eduskuntaryhmat', label: 'Eduskuntaryhmät' },
  { id: 'luottamustoimet', label: 'Luottamustoimien tyypit' },
];

export function RegistriesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('valilehti') ?? 'vaalikaudet';
  const parties = useEntityList<Party>('parties');
  const partyOptions = (parties.data ?? []).map((p) => ({
    value: p.id,
    label: `${p.nameFi} (${p.abbreviation})`,
  }));
  return (
    <>
      <PageHeader
        title="Perusrekisterit"
        description="Tiedot, joihin kaikki moduulit viittaavat. Muokkaa suoraan taulukossa; muutokset tallentuvat automaattisesti ja ne voi kumota."
        crumbs={[{ label: 'Perusrekisterit' }]}
        actions={
          <Link to="/rekisterit/puolueet" className="text-sm text-accent hover:underline">
            Puolueet →
          </Link>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ valilehti: v }, { replace: true })}>
        <TabsList className="overflow-x-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="vaalikaudet">
          <EntityTable
            entity="electoral-terms"
            sort={byDateDesc('startDate')}
            columns={[
              { key: 'name', label: 'Nimi' },
              { key: 'code', label: 'Tunnus', width: '140px' },
              { key: 'startDate', label: 'Alku', kind: 'date', width: '160px' },
              { key: 'endDate', label: 'Loppu', kind: 'date', width: '160px' },
            ]}
            defaults={() => ({ code: `uusi-${rnd()}`, name: 'Uusi vaalikausi', startDate: today() })}
          />
        </TabsContent>
        <TabsContent value="hallitukset">
          <EntityTable
            entity="governments"
            sort={byDateDesc('startDate')}
            columns={[
              { key: 'name', label: 'Hallitus' },
              { key: 'primeMinisterName', label: 'Pääministeri' },
              { key: 'ordinal', label: 'Järjestysnro', kind: 'number', width: '110px' },
              { key: 'startDate', label: 'Alku', kind: 'date', width: '150px' },
              { key: 'endDate', label: 'Loppu', kind: 'date', width: '150px' },
            ]}
            defaults={() => ({ code: `uusi-${rnd()}`, name: 'Uusi hallitus', startDate: today() })}
          />
        </TabsContent>
        <TabsContent value="vaalipiirit">
          <EntityTable
            entity="electoral-districts"
            sort={byName}
            columns={[
              { key: 'nameFi', label: 'Vaalipiiri' },
              { key: 'nameSv', label: 'Ruotsiksi' },
              { key: 'code', label: 'Tunnus', width: '100px' },
              { key: 'validFrom', label: 'Voimassa alkaen', kind: 'date', width: '150px' },
              { key: 'validTo', label: 'Voimassa asti', kind: 'date', width: '150px' },
            ]}
            defaults={() => ({ code: `U${rnd()}`, nameFi: 'Uusi vaalipiiri' })}
          />
        </TabsContent>
        <TabsContent value="valiokunnat">
          <EntityTable
            entity="bodies"
            sort={byName}
            columns={[
              { key: 'nameFi', label: 'Nimi' },
              { key: 'abbreviation', label: 'Lyhenne', width: '100px' },
              {
                key: 'type',
                label: 'Tyyppi',
                kind: 'select',
                width: '150px',
                options: [
                  { value: 'committee', label: 'Valiokunta' },
                  { value: 'body', label: 'Toimielin' },
                  { value: 'other', label: 'Muu' },
                ],
              },
              { key: 'validFrom', label: 'Alkaen', kind: 'date', width: '150px' },
              { key: 'validTo', label: 'Asti', kind: 'date', width: '150px' },
            ]}
            defaults={() => ({ code: `UUSI-${rnd()}`, nameFi: 'Uusi toimielin', type: 'body' })}
          />
        </TabsContent>
        <TabsContent value="eduskuntaryhmat">
          <EntityTable
            entity="parliamentary-groups"
            sort={byName}
            columns={[
              { key: 'nameFi', label: 'Eduskuntaryhmä' },
              { key: 'code', label: 'Tunnus', width: '110px' },
              { key: 'partyId', label: 'Puolue', kind: 'select', options: partyOptions },
              { key: 'validFrom', label: 'Alkaen', kind: 'date', width: '150px' },
              { key: 'validTo', label: 'Asti', kind: 'date', width: '150px' },
            ]}
            defaults={() => ({ code: `UUSI${rnd()}`, nameFi: 'Uusi eduskuntaryhmä', active: true })}
          />
          <p className="mt-2 text-xs text-subtle">
            Eduskuntaryhmät päivittyvät eduskunnan avoimesta datasta (Synkronoinnit). Eduskuntaryhmä ja puolue
            ovat eri asioita; yhteys puolueeseen voidaan muuttaa käsin.
          </p>
        </TabsContent>
        <TabsContent value="luottamustoimet">
          <EntityTable
            entity="position-types"
            sort={(a, b) => Number(a.sortOrder) - Number(b.sortOrder)}
            columns={[
              { key: 'nameFi', label: 'Luottamustoimi' },
              {
                key: 'level',
                label: 'Taso',
                kind: 'select',
                width: '160px',
                options: [
                  { value: 'municipal', label: 'Kunta' },
                  { value: 'regional', label: 'Alue' },
                  { value: 'state', label: 'Valtio' },
                  { value: 'eu', label: 'EU' },
                  { value: 'party', label: 'Puolue' },
                  { value: 'other', label: 'Muu' },
                ],
              },
              { key: 'sortOrder', label: 'Järjestys', kind: 'number', width: '100px' },
            ]}
            defaults={() => ({
              code: `custom-${rnd().toLowerCase()}`,
              nameFi: 'Uusi luottamustoimi',
              level: 'other',
              sortOrder: 100,
            })}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

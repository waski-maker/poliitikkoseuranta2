# 0.001 Perusrekisterit

Tiedot, joihin useat moduulit viittaavat:

- **Puolueet** – nimet (fi/sv/en), lyhenne, virallinen nimi, rekisteröinti- ja poistopäivä, eduskuntaryhmän nimi, tunnusväri (käytetään koko käyttöliittymässä), logo, kotisivu, puheenjohtaja (viittaus henkilöön, moduuli 1.001), edeltäjä- ja seuraajapuolueet, tila.
- **Eduskuntaryhmät** – eduskunnan tunnus (esim. `PS01`), linkki puolueeseen.
- **Vaalipiirit** – voimassaoloaikoineen (myös vuonna 2015 lakkautetut).
- **Vaalikaudet**, **hallitukset** ja hallituspuolueet aikaväleineen.
- **Valiokunnat ja toimielimet**.
- **Luottamustoimien tyypit** – valmiit (kansanedustaja, ministeri, presidentti, MEP, aluevaltuutettu, kunnanvaltuutettu) ja käyttäjän lisäämät.

## Rajapinnat

- Moduulien välinen: `ctx.registry.get('0.001').api` – `list`, `get`, `create`, `update`, `remove`, `restore`, `getPartyByAbbreviation`, `resolveGroup(eduskuntaryhmäTunnus)`, `termForDate`, `currentTerm`, `governmentForDate`, `governmentParties`, `partyRelations`, `summary`.
- REST: `/api/v1/registries/{parties|parliamentary-groups|electoral-districts|electoral-terms|governments|bodies|position-types}` (+ `/{id}`, `/{id}/restore`), `/governments/{id}/parties`, `/parties/{id}/relations`, `/summary`, `/sync`.
- Tapahtumat: `party.created`, `party.updated`, `party.changed`, `registry.updated`.

## Data

- Alkudata: `src/seed/data.ts` (lähde `seed`).
- Synkronointi: `0.001:eduskunta-reference` – eduskunnan viitetiedot (`pnpm job run sync:registries`). Ei ylikirjoita käsin muokattuja kenttiä.
- Varmuuskopiointi: puolueet, puoluesuhteet, hallitukset ja luottamustoimien tyypit ovat korvaamattomia; eduskuntaryhmät, vaalipiirit, vaalikaudet ja valiokunnat voidaan tuottaa uudelleen.

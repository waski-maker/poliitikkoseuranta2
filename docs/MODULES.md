# Moduulit

Ohjelma koostuu moduuleista. Jokainen moduuli on oma pnpm-pakettinsa hakemistossa `modules/<numero>-<nimi>/`, ja se puhuu muille moduuleille vain julkisen rajapintansa ja tapahtumaväylän kautta.

## Numerointi

| Alue           | Merkitys                     | Nykyiset                                                                                    |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| 0.xxx          | Ydin ja yhteiset palvelut    | 0.001 Perusrekisterit (0.002 Käyttäjät ja oikeudet varattu)                                 |
| 1.xxx          | Eduskunta ja kansanedustajat | 1.001 Kansanedustajat, 1.002 Puheet (tulossa); varattu: äänestykset, kysymykset, asiakirjat |
| 2.xxx, 3.xxx … | Tulevat kokonaisuudet        | varattu: kunnat, hyvinvointialueet, EU, media, vaalirahoitus                                |

## Uusi moduuli

```bash
pnpm new-module 1.003 votes "Äänestykset"
pnpm db:migrate && pnpm db:seed && pnpm sdk:generate
pnpm dev
```

Komento luo valmiin pohjan ja rekisteröi moduulin API:in (`apps/api/src/modules.ts`) ja käyttöliittymään (`apps/web/src/modules.ts`):

```
modules/1.003-votes/
  package.json            @ps/m1003-votes
  README.md
  src/manifest.ts         tunnus, riippuvuudet, oikeudet, valikko, tapahtumat, palvelut, tietolähteet, varmuuskopiointi
  src/schema.ts           taulujen tyypit (skeema m1003_votes)
  src/api.ts              julkinen rajapinta muille moduuleille
  src/events.ts           julkaistavat tapahtumat
  src/routes.ts           REST-rajapinta /api/v1/votes (OpenAPI)
  src/sync/index.ts       tuonti ulkoisesta lähteestä
  src/ui/                 sivut ja kojelautakortti
  tests/module.test.ts
supabase/migrations/<aikaleima>_m1003_votes.sql   taulut + core.setup_table (RLS, audit, vakiosarakkeet)
```

## Viestintä moduulien välillä

1. **Synkroniset kutsut:** `ctx.registry.get('1.001').api.getPerson(tx, id)`. Rekisteri tarkistaa riippuvuudet käynnistyksessä (puuttuva tai syklinen riippuvuus pysäyttää käynnistyksen). Tyypitys: moduuli laajentaa `ModuleApis`-rajapintaa (`declare module '@ps/core'`).
2. **Tapahtumat:** `publishEvent(tx, { type, source, payload })` kirjoittaa outbox-tauluun samassa transaktiossa kuin datamuutos. Kuuntelijat määritellään `subscriptions()`-funktiossa; jokaisella kuluttajalla on oma kursori, joten tapahtumat voidaan toistaa (`EventBus.replay`). Tapahtumilla on tyyppi, versio, aikaleima, lähdemoduuli ja hyötykuorma.
3. **Jaetut tunnisteet:** pysyvät UUID:t ja taulu `core.external_ids` (esim. eduskunnan henkilönumero, Wikidata).
4. **Yhteiset palvelut:** haku (`indexDocument`), tekoäly (`ctx.ai()`), vienti (`renderExport`), työjono (`ctx.startJob`), audit-loki (automaattinen), oikeudet (`requirePermission`), palvelut (`ctx.services`), HTTP-asiakas tietolähteille (`ctx.http('eduskunta')`).

## Tarkistuslista uudelle moduulille

**Rakenne ja rajat**

- [ ] Manifestissa tunnus, nimi, versio, riippuvuudet, tarjotut palvelut, julkaistut ja kuunnellut tapahtumat, valikkokohdat, oikeudet (`<slug>.read`, `<slug>.edit` …, oletusroolit), asetukset, käytetyt palvelut ja tietolähteet.
- [ ] Omat taulut omassa skeemassa `mNNNN_nimi`; jokaiselle taululle `select core.setup_table(...)`.
- [ ] Ei lue toisen moduulin tauluja – käyttää niiden `api.ts`-rajapintaa tai tapahtumia.
- [ ] Ei käytä palveluntarjoajien kirjastoja suoraan (`ctx.services`, `ctx.ai()`, `ctx.http()`).

**Rajapinta (API ensin)**

- [ ] Kaikki toiminnot (haku, luonti, muokkaus, tuonti, vienti, analyysi) ovat REST-rajapinnassa `/api/v1/<moduuli>/…` ja kuvattu OpenAPI:ssa (`createRoute`).
- [ ] Listat tukevat `updated_since`, `include_deleted`, `limit`, `offset`; poistot ovat pehmeitä.
- [ ] Jokainen reitti tarkistaa oikeuden `requirePermission()` ja ajaa kyselyt `ctx.withActor(user)`-transaktiossa (RLS).
- [ ] Tiedostot ja viennit palautetaan latauslinkkeinä (`services.storage.signedUrl`).
- [ ] `pnpm sdk:generate` ajettu ja SDK commitoitu; käyttöliittymä käyttää vain SDK:ta.

**Data**

- [ ] Synkronointi rekisteröity (`syncSources`), käyttää `upsertSynced()`-funktiota (ei ylikirjoita käsin muokattuja kenttiä) ja kirjaa rivimäärät ja virheet.
- [ ] Lähde, noutoaika ja lähde-URL tallennetaan; näkyvyystaso asetetaan (henkilökohtaiset yhteystiedot `private`).
- [ ] Ulkoisen rajapinnan rakenne tarkistettu ja dokumentoitu `docs/DATA-SOURCES.md`-tiedostoon.
- [ ] Hakukelpoinen sisältö rekisteröity (`searchTypes` + `indexDocument`).

**Varmuuskopiointi**

- [ ] Manifestin `backup`: korvaamattomat taulut (käsin syötetyt, muokatut, analyysit) ja uudelleen tuotettavat (avoin data, indeksit, upotteet) sekä tiedostopolut.
- [ ] Taulut listattu viiteriippuvuusjärjestyksessä (vanhemmat ensin), jotta moduulin palautus toimii.
- [ ] `backup.schemaVersion` kasvatetaan, kun JSON-muoto muuttuu, ja `upgradeBackup()` muuntaa vanhat varmuuskopiot.
- [ ] Riskialttiit toiminnot (yhdistäminen, massamuokkaus, suuri tuonti) ottavat tilannekuvan `takeSnapshot()`.

**Käyttöliittymä**

- [ ] Vain `@ps/ui`-komponentit ja design-tokenit; tekstit suomeksi.
- [ ] Tyhjät, lataus- ja virhetilat; muokkaus paikallaan (`InlineEdit`) ja kumoaminen; ei vahvistusdialogeja (paitsi palautus).
- [ ] Reitit ja kojelautakortti `ui/index.tsx`:ssä; valikkokohdat manifestissa.

**Laatu**

- [ ] Testit: manifestin validointi, API-reitit oikeuksineen, synkronointi testiaineistolla, RLS (ei näy ilman oikeutta).
- [ ] README.md kuvaa moduulin; `pnpm check` menee läpi.

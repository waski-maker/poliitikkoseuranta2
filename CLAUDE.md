# CLAUDE.md – pysyvät ohjeet tuleville istunnoille

Poliitikkoseuranta 2.0: suomalaisen politiikan avoimen datan seuranta- ja analyysiohjelma.
Koko määrittely: `docs/SPEC.md`. Tehdyt päätökset: `docs/DECISIONS.md`. Lue molemmat ennen isoja muutoksia.

## Toimintatapa (tärkein ohje)

- **Tee kaikki itse.** Asenna riippuvuudet, aja migraatiot, kirjoita testit, korjaa virheet ja aja sovellus itse.
- **Älä kysy turhaan.** Ei "jatkanko?" -kysymyksiä vaiheiden välillä. Kysy vain, kun olet aidosti jumissa (esim. salainen avain) – ja silloin kaikki kysymykset yhdellä kertaa.
- **Kirjaa oletuspäätökset** `docs/DECISIONS.md`-tiedostoon (päivämäärä, päätös, perustelu, vaihtoehdot).
- **Tarkista ulkoiset rajapinnat ennen koodaamista.** Älä arvaa kenttien nimiä; dokumentoi `docs/DATA-SOURCES.md`-tiedostoon.
- **Pidä projekti aina ajokelpoisena:** jokaisen vaiheen lopussa sovellus käynnistyy, `pnpm check` menee läpi ja muutokset on commitoitu selkein viestein.
- **Kieli:** käyttöliittymä, README ja käyttäjälle näkyvät tekstit suomeksi; koodi, muuttujat ja koodikommentit englanniksi.
- Päivitä tämä tiedosto aina, kun arkkitehtuuri muuttuu.

## Arkkitehtuuri lyhyesti

```
apps/web        Vite + React -käyttöliittymä (staattinen; GitHub Pages / mikä tahansa staattinen palvelin)
apps/api        Hono-API /api/v1 + OpenAPI. Sama koodi: Supabase Edge (Deno), Node, Bun, Docker
apps/worker     Taustatyöt komentoina (pnpm job …); GitHub Actions / cron kutsuu niitä
packages/core   Ydin: DB, moduulirekisteri, tapahtumaväylä (outbox), työjono, synkronointikehys,
                haku, tekoäly, vienti, palvelurekisteri + sovittimet, oikeudet, audit, varmuuskopiot
packages/sdk    OpenAPI:sta generoitu tyypitetty asiakas (+ React-hookit). Web käyttää VAIN tätä.
packages/ui     Design-järjestelmä (tokenit, komponentit). Moduulit käyttävät VAIN näitä.
modules/<n.nnn>-<nimi>   Moduulit (0.xxx ydin, 1.xxx eduskunta, 2.xxx+ varattu)
supabase/       migrations/ (SQL, myös RLS) ja functions/api (ohut kääre API:lle)
deploy/         Docker self-host, Caddy/nginx, varmuuskopio- ja palautusskriptit
```

Ajoympäristöt: `createRuntime()` (packages/core/src/runtime.ts) kokoaa saman ytimen API:lle, työntekijälle ja testeille.

## Moduulisäännöt

1. Moduuli puhuu muille **vain** julkisen API:nsa (`registry.get('1.001').api`) ja tapahtumaväylän kautta. **Ei koskaan** lue toisen moduulin tauluja.
2. Moduulin rakenne: `manifest.ts`, `schema.ts`, `api.ts`, `events.ts`, `routes.ts`, `sync/`, `ui/`, `tests/`, `README.md`. Uusi moduuli: `pnpm new-module <numero> <nimi> "Näyttönimi"`.
3. Manifest kertoo: tunnus, riippuvuudet, tarjotut palvelut, tapahtumat, valikko, oikeudet, asetukset, käytetyt palvelut ja tietolähteet sekä varmuuskopiointi (korvaamattomat / uudelleen tuotettavat taulut).
4. Omat taulut omassa skeemassa `mNNNN_nimi`; jokainen taulu `select core.setup_table('skeema.taulu', '<slug>.read', '<slug>.edit')` → vakiosarakkeet (created/updated_at/by, deleted_at, visibility, source, source_url, fetched_at, manual_fields), audit-loki ja RLS.
5. Kaikki moduulin toiminnot REST-rajapintaan (`/api/v1/<moduuli>/…`) OpenAPI-kuvauksineen. Listat tukevat `updated_since` ja pehmeät poistot.
6. Ulkoiset palvelut vain ytimen kautta: `ctx.services.storage|mail|jobs|realtime|backup`, `ctx.ai()`, `ctx.http('eduskunta')`. Ei tarjoajakohtaisia kirjastoja moduuleihin (ESLint estää `@supabase/*`).
7. Synkronointi: `upsertSynced()` – ei koskaan ylikirjoita `manual_fields`-kenttiä.
8. Oikeudet: API:ssa `requirePermission(user, 'x.y')`, tietokannassa RLS (`core.has_permission`). Kumpikin aina.
9. Käyttäjän tiedot käsitellään `ctx.withActor({kind:'user', …}, tx => …)` -transaktiossa (rooli `authenticated`, RLS voimassa). Järjestelmäajot: `{kind:'system'}`.

## Koodauskäytännöt

- TypeScript strict, ESM, `.ts`-päätteet importeissa. Prettier (110 merkkiä, single quotes). ESLint flat config.
- DB: `postgres` (porsager) + camelCase-muunnos; `date`-tyyppi pysyy merkkijonona. SQL-migraatiot `supabase/migrations/<aikaleima>_<nimi>.sql` (älä muokkaa jo julkaistuja migraatioita – lisää uusi).
- Virheet: `AppError`-luokat (`NotFoundError`, `ForbiddenError`, …) → API muuntaa HTTP-vastauksiksi suomenkielisin viestein.
- Promptit versioidaan tiedostoina (`*.v1.ts`); muutos = uusi versio.
- UI-tekstit suomeksi; yleiset tekstit `apps/web/src/i18n.ts`.
- Testit: Vitest (`*.test.ts`; DB-testit ohittuvat ilman kantaa), Playwright (`apps/web/e2e`).

## Ajokomennot

```
pnpm run setup          # kaikki tyhjästä (huom: `pnpm setup` on pnpm:n oma komento)
pnpm dev                # API :8787 + web :5173
pnpm check              # lint + format + typecheck + test
pnpm test               # Vitest (tarvitsee PostgreSQL:n: TEST_DATABASE_URL)
pnpm test:e2e           # Playwright
pnpm db:migrate / db:seed
pnpm sdk:generate       # OpenAPI → packages/sdk (aja aina API:n muuttuessa ja commitoi)
pnpm job list | run <tyyppi> [--avain arvo] | work [--id <id>]
pnpm build:web / build:edge
pnpm new-module 1.003 votes "Äänestykset"
pnpm deploy:setup [--dry-run]
```

Paikallinen kanta: `docker compose up -d db` (pgvector/pg16, kannat ps_dev ja ps_test).

## Tila

- Vaihe 0 (perusta ja ydin): toteutettu – ks. `docs/DECISIONS.md` ja README:n tilaosio.
- Vaiheet 1 (1.001 Kansanedustajat) ja 2 (1.002 Puheet): seuraavaksi. Eduskunnan rajapinnan rakenne: `docs/DATA-SOURCES.md` (käytä api.eduskunta.fi:tä, vanha avoindata.eduskunta.fi poistuu 2026 lopussa).

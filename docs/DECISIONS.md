# Päätökset

Jokainen oletuspäätös: päivämäärä, päätös, perustelu ja harkitut vaihtoehdot. Uusin ylimpänä kunkin aiheen sisällä ei ole pakollista – lisää uudet loppuun.

---

### 2026-10-05 · D1 Eduskunnan rajapinta: api.eduskunta.fi, ei avoindata.eduskunta.fi

**Päätös:** Tuontikoodi käyttää uutta rajapintaa `https://api.eduskunta.fi/api/v1/`.
**Perustelu:** Eduskunnan avoimen datan ohjeen mukaan vanhasta avoindata.eduskunta.fi-palvelusta luovutaan vuoden 2026 lopussa. Uuden rajapinnan rakenne on vahvistettu julkaistuista todellisista vastauksista (ks. DATA-SOURCES.md). Tämän kehitysympäristön verkkorajaus esti suorat kutsut molempiin osoitteisiin, joten rakenne tarkistettiin kahden avoimen lähdekoodiprojektin tallentamista vastauksista ja niiden testiaineistosta; sovitin validoi jokaisen rivin ja kirjaa poikkeamat ajolokiin arvaamatta kenttiä.
**Vaihtoehdot:** vanha taulurajapinta (poistumassa), HTML-sivujen jäsentäminen (hauras).

### 2026-10-05 · D2 Käyttöliittymä: Vite + React (ei Next.js)

**Päätös:** Vite + React + React Router, staattinen koonti.
**Perustelu:** Sovellus on kokonaan kirjautumisen takana ja kaikki data tulee API:sta, joten palvelinrenderöinnistä ei ole hyötyä. Vite on yksinkertaisempi, nopeampi ja toimii sellaisenaan GitHub Pagesissa (basePath + 404-uudelleenohjaus).
**Vaihtoehdot:** Next.js `output: 'export'` (raskaampi, reitityksen ja basePathin erikoistapaukset).

### 2026-10-05 · D3 Migraatiot: SQL-tiedostot + oma ajaja (ei Drizzlea)

**Päätös:** Migraatiot ovat tavallisia SQL-tiedostoja `supabase/migrations/`-hakemistossa (Supabase CLI -yhteensopiva nimeäminen); niitä ajaa oma kevyt ajaja (`pnpm db:migrate`), joka kirjaa ne tauluun `core_meta.schema_migrations` ja ottaa varmuuskopion ennen ajoa.
**Perustelu:** RLS-säännöt, triggerit ja funktiot ovat luontevimpia SQL:nä; sama komento toimii Supabasessa, omassa PostgreSQL:ssä ja CI:ssä. Tietokantakerros on `postgres`-kirjasto (toimii Node/Deno/Bun), ja moduulien yhteinen CRUD-apu on ytimessä.
**Vaihtoehdot:** Drizzle ORM (lisäkerros, RLS silti käsin), Supabase CLI:n `db push` (sidottu Supabaseen).

### 2026-10-05 · D4 RLS toisena suojakerroksena: API ajaa käyttäjän kyselyt roolilla `authenticated`

**Päätös:** API avaa jokaiselle käyttäjäpyynnölle transaktion, jossa asetetaan `role authenticated` ja JWT-väitteet (`request.jwt.claims`). RLS-säännöt käyttävät funktiota `core.has_permission()`. Järjestelmätyöt (synkronointi, jono) ajetaan omistajaroolilla.
**Perustelu:** Sama malli kuin Supabasessa, mutta toimii millä tahansa PostgreSQL:llä (migraatio luo `anon`/`authenticated`-roolit ja `auth.uid()`-funktion, jos niitä ei ole). Jokainen moduulitaulu saa säännöt yhdellä kutsulla `core.setup_table()`; julkisen roolin säännöt ovat valmiina mutta pois päältä (`core.public_access_enabled` = false).
**Vaihtoehdot:** RLS vain Supabasen PostgREST-kutsuille (ei suojaa API:n omia kyselyitä).

### 2026-10-05 · D5 Kirjautuminen sovittimilla: supabase | oidc | dev

**Päätös:** API tarkistaa JWT:n itse (jose). Supabase Auth (sähköpostilinkki, PKCE) on oletus verkossa; OIDC-sovitin kattaa Keycloakin, Entra ID:n ja muut; `dev` on paikallista kehitystä ja testejä varten (API myöntää tunnisteen vain sallitulle osoitteelle). Sallitut sähköpostit: `ALLOWED_EMAILS` + taulu `core.allowed_emails`. Supabasessa julkinen rekisteröityminen suljetaan ja sallitut käyttäjät luodaan `pnpm deploy:setup` -komennolla.
**Perustelu:** Sama API toimii kaikissa ympäristöissä, ja kirjautumispalvelun vaihto on asetus. Käyttäjä tunnistetaan sähköpostilla, joten palvelun vaihdossa käyttäjärivi siirtyy uuteen tunnisteeseen roolit säilyttäen.

### 2026-10-05 · D6 Supabase Edge Function ajaa esikäännetyn paketin

**Päätös:** `pnpm build:edge` paketoi API:n esbuildillä yhdeksi ESM-tiedostoksi (`supabase/functions/api/_bundle/api.mjs`), ja `supabase/functions/api/index.ts` on 5-rivinen kääre. Node-sisäiset moduulit muunnetaan `node:`-muotoon. Paketti on testattu Deno 2:lla PostgreSQL-yhteyden kanssa.
**Perustelu:** pnpm-työtilan TypeScript-lähteet eivät sellaisenaan ratkea Denossa; paketti tekee julkaisusta toistettavan ja riippumattoman Denon npm-tuesta.

### 2026-10-05 · D7 Pitkät työt: tietokantajono + vaihdettava ajaja

**Päätös:** Työt tallennetaan tauluun `core.jobs`. Työn määrittely kertoo, saako sen ajaa API-prosessissa (`inline`) vai vaatiiko se työntekijän (`worker`). Ajaja on palvelu: `github-actions` (workflow_dispatch → `pnpm job work --id`), `inline` (Node/Docker) tai `queue` (cron/systemd/Docker-työntekijä). Edistyminen luetaan tietokannasta (Supabase Realtime tai kysely).
**Perustelu:** Edge Functionin aikaraja ei riitä suuriin tuonteihin; sama komento toimii kaikkialla.

### 2026-10-05 · D8 Tekoäly: Anthropic SDK + fetch-pohjainen OpenAI-yhteensopiva sovitin

**Päätös:** Anthropic-sovitin käyttää virallista `@anthropic-ai/sdk`-kirjastoa (toimii Node/Deno), oletusmallina `claude-opus-5-5`, striimaus ja palvelinpuolen varamalli kieltäytymistilanteisiin (`fallbacks: "default"`). OpenAI ja kaikki OpenAI-yhteensopivat palvelut (Ollama, vLLM, LM Studio) kulkevat yhden REST-sovittimen kautta. Valepalvelu (`mock`) toimii ilman avainta kehityksessä ja testeissä. Kaikki tehtäväkohtaiset mallit ovat oletuksena samat; ylläpitäjä voi valita kevyemmän mallin esim. luokitteluun.
**Perustelu:** Moduulit kutsuvat vain `ai.complete()/analyze()/embed()`; uusi palvelu = uusi sovitin. Avaimet salataan (AES-256-GCM) eikä niitä palauteta selaimeen.

### 2026-10-05 · D9 Upotteiden oletus

**Päätös:** Upotemalli valitaan erikseen. Oletus: OpenAI `text-embedding-3-small`, jos OpenAI-avain on annettu, muuten valepalvelun 64-ulotteiset hajautusvektorit (vain kehitykseen). Upotteet tallennetaan malli- ja ulottuvuustietoineen (`core.embeddings`), joten mallin vaihto laskee uudet taustalla ja haku käyttää vanhoja siihen asti.
**Perustelu:** Anthropic ei tarjoa upotemallia; ratkaisu ei sido mihinkään palveluun.

### 2026-10-05 · D10 Perusrekisterien alkudata

**Päätös:** Puolueet (9 eduskuntapuoluetta), vaalipiirit (myös vuonna 2015 lakkautetut), vaalikaudet 1999–2027, hallitukset 2003–, valiokunnat ja luottamustoimien tyypit on koottu käsin julkisista lähteistä (`modules/0.001-registries/src/seed/data.ts`, lähde `seed`). Eduskunnan viitetietosynkronointi täydentää ja vahvistaa ne (lähde muuttuu `eduskunta`), mutta ei koskaan ylikirjoita käsin muokattuja kenttiä. Puoluerekisterin merkitsemispäivät jätettiin tyhjiksi, koska niitä ei voitu tarkistaa luotettavasti tästä ympäristöstä – ne lisätään käsin tai myöhemmällä puoluerekisterisovittimella.
**Perustelu:** Ohjelma on käyttökelpoinen heti, vaikka ulkoinen rajapinta ei olisi tavoitettavissa.

### 2026-10-05 · D11 Eduskuntaryhmä ja puolue ovat eri tietueita

**Päätös:** Eduskuntaryhmät (`parliamentary_groups`, eduskunnan tunnus esim. `PS01`) ovat oma taulunsa, joka viittaa puolueeseen. Linkitys tehdään tunnuksen etuliitteellä ja on käsin muutettavissa.
**Perustelu:** Ryhmä voi poiketa puolueesta (esim. irtautuneet edustajat); puheiden "puolue puhehetkellä" vaatii molemmat.

### 2026-10-05 · D12 `pnpm run setup`

**Päätös:** Asennuskomento on `pnpm run setup`, koska `pnpm setup` on pnpm:n oma sisäänrakennettu komento (PNPM_HOME-asetus), eikä sitä voi korvata skriptillä.

### 2026-10-05 · D13 Tyylikirjasto

**Päätös:** Tailwind CSS v4 + omat shadcn/ui-tyyliset komponentit Radix-primitiivien päällä paketissa `packages/ui` (ei shadcn-generaattoria). Fontit Inter (käyttöliittymä) ja Source Serif 4 (lukunäkymä), self-host @fontsource-paketeista.
**Perustelu:** Yksi paikka design-tokeneille; moduulit eivät määrittele omia tyylejään. Self-host-fontit eivät vaadi ulkoisia pyyntöjä.

### 2026-10-05 · D14 Varmuuskopioiden salaus ja kohde

**Päätös:** Varmuuskopiot salataan AES-256-GCM:llä ennen siirtoa (oma kirjekuorimuoto `PSB1 | iv | data | tag`), avain `BACKUP_ENCRYPTION_KEY` säilytetään erillään. Kohde on vaihdettava palvelu (S3-yhteensopiva suositus, paikallinen levy). Täysi kopio = `pg_dump` sovelluksen skeemoista + tiedostot ZIP-pakettina; kuukausittainen palautustesti palauttaa kopion kertakäyttöiseen kantaan (GitHub Actionsin palvelukontti). Säilytys 7/4/12 (päivä/viikko/kuukausi).
**Perustelu:** 3-2-1-periaate ilman omaa palvelinta; palautus onnistuu myös ilman sovellusta (`deploy/decrypt-backup.mjs`, `deploy/restore.sh`).

### 2026-10-05 · D15 Ajastukset

**Päätös:** Synkronointi joka yö 02:15 UTC ja istuntopäivinä (ti–pe) tunnin välein 08–18 UTC; varmuuskopio 01:30 UTC; palautustesti kuun 1. päivä.

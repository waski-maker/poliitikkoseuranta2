# Poliitikkoseuranta 2.0

Suomalaisen politiikan avoimen datan seuranta- ja analyysiohjelma. Ohjelma kerää, tallentaa, hakee ja analysoi eduskunnan avointa dataa, ja se rakentuu moduuleista, joita voi lisätä ilman ytimen muutoksia.

> Tila: **vaihe 0 (perusta ja ydin) valmis.** Mukana moduuli 0.001 Perusrekisterit (puolueet, eduskuntaryhmät, vaalipiirit, vaalikaudet, hallitukset, valiokunnat, luottamustoimien tyypit). Seuraavaksi 1.001 Kansanedustajat ja 1.002 Puheet. Koko määrittely: [docs/SPEC.md](docs/SPEC.md).

## Mitä ohjelmassa on

- **Web-käyttöliittymä** (React, Tailwind, Radix): kokoontaitettava sivupalkki, komentopaletti (Ctrl/⌘ + K), vaalea ja tumma teema, kojelauta, yleishaku suomen kielen taivutusmuodoilla, muokkaus suoraan paikallaan automaattisella tallennuksella ja kumoamisella.
- **Yksi REST-API** (`/api/v1`, Hono + OpenAPI) kaikille asiakkaille; web käyttää sitä vain generoidun SDK:n kautta. Sama koodi toimii Supabase Edge Functionissa, Node.js:llä, Bunissa ja Dockerissa.
- **Ydinpalvelut**: moduulirekisteri, tapahtumaväylä (outbox), työjono, synkronointikehys, haku (finnish/swedish + pgvector), vaihdettava tekoäly (Anthropic, OpenAI, OpenAI-yhteensopivat ja sisäiset mallit), vienti (TXT, MD, CSV, JSON, PDF, DOCX, ZIP), audit-loki, roskakori, salattu varmuuskopiointi.
- **Tietoturva**: kirjautuminen vain sallituille sähköposteille, ensimmäinen kirjautuja on ylläpitäjä, oikeudet tarkistetaan API:ssa ja lisäksi tietokannassa (Row Level Security kaikissa tauluissa).
- **Vaihdettavat palvelut**: tallennus, sähköposti, taustatyöt, reaaliaikaisuus, tekoäly ja varmuuskopioiden kohde vaihdetaan asetuksista (Ylläpito → Palvelut).

## Pika-aloitus (oma kone tai Codespaces)

Vaatimukset: Node.js 22+, pnpm 10 (`corepack enable`) ja joko Docker tai olemassa oleva PostgreSQL 15+ (pgvector).

```bash
pnpm run setup   # asentaa kaiken, luo .env:n avaimineen, käynnistää kannan, ajaa migraatiot ja tuo alkudatan
pnpm dev         # API http://localhost:8787 ja käyttöliittymä http://localhost:5173
```

Kirjaudu osoitteella, joka on `.env`-tiedoston `ALLOWED_EMAILS`-listalla (setup käyttää oletuksena git-sähköpostiasi). Paikallisesti kirjautuminen toimii ilman sähköpostia (`AUTH_PROVIDER=dev`).

> Huom: `pnpm setup` (ilman `run`) on pnpm:n oma sisäänrakennettu komento. Käytä `pnpm run setup`.

GitHub Codespaces / VS Code devcontainer ajaa asennuksen automaattisesti (`.devcontainer/`).

## Verkkoon (GitHub Pages + Supabase)

1. Luo Supabase-projekti ([supabase.com](https://supabase.com)).
2. Aja `pnpm deploy:setup` – se luo tiedoston `.env.deploy`; täytä siihen Supabasen tiedot ja sallitut sähköpostit.
3. Aja `pnpm deploy:setup` uudelleen. Komento asettaa GitHub Secretsit ja Variablesit, ottaa Pagesin käyttöön, määrittää Supabasen (funktion salaisuudet, kirjautuminen ilman julkista rekisteröitymistä, käyttäjät, tallennustila) ja käynnistää julkaisun.

Jatkossa jokainen `main`-haaraan tehty muutos julkaistaan automaattisesti. Tarkemmin: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (myös oma palvelin Dockerilla ja webhotelli).

## Komennot

| Komento                                     | Tarkoitus                                            |
| ------------------------------------------- | ---------------------------------------------------- |
| `pnpm run setup`                            | Asennus tyhjästä koneesta                            |
| `pnpm dev`                                  | API + käyttöliittymä kehitystilassa                  |
| `pnpm check`                                | Lint, formatointi, tyypit ja testit                  |
| `pnpm test` / `pnpm test:e2e`               | Yksikkö- ja integraatiotestit / käyttöliittymätestit |
| `pnpm db:migrate`, `pnpm db:seed`           | Migraatiot (varmuuskopio ensin) ja alkudata          |
| `pnpm job list`                             | Taustatöiden luettelo                                |
| `pnpm job run sync:registries`              | Perusrekisterien päivitys eduskunnan datasta         |
| `pnpm job run backup:full`                  | Salattu täysi varmuuskopio                           |
| `pnpm job work`                             | Käsittele jonossa olevat työt                        |
| `pnpm sdk:generate`                         | OpenAPI-kuvaus ja tyypitetty SDK                     |
| `pnpm new-module 1.003 votes "Äänestykset"` | Uusi moduulipohja                                    |
| `pnpm deploy:setup`                         | Verkkojulkaisun käyttöönotto                         |

## Dokumentaatio

- [docs/SPEC.md](docs/SPEC.md) – määrittely ja toteutusvaiheet
- [docs/DECISIONS.md](docs/DECISIONS.md) – tehdyt päätökset perusteluineen
- [docs/MODULES.md](docs/MODULES.md) – uuden moduulin lisääminen ja tarkistuslista
- [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) – eduskunnan avoimen datan rajapinta
- [docs/SERVICES.md](docs/SERVICES.md) – vaihdettavat palvelut ja vaihto-ohjeet
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) – julkaisu GitHubiin, omalle palvelimelle tai webhotelliin
- [docs/BACKUP.md](docs/BACKUP.md) – varmuuskopiointi ja palautus
- [docs/PRIVACY.md](docs/PRIVACY.md) – tietosuoja
- [CLAUDE.md](CLAUDE.md) – arkkitehtuuri ja säännöt kehittäjille

## Lisenssi ja lähteet

Eduskunnan avoin data: © Eduskunta, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Lähde näytetään käyttöliittymässä ja jokaisessa viennissä.

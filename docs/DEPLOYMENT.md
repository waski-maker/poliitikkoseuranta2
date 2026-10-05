# Julkaisu ja siirto

Ohjelma toimii nyt GitHubissa ja Supabasessa, mutta mikään osa ei ole sidottu niihin: API on alustariippumaton Hono-sovellus, tietokanta on tavallinen PostgreSQL, taustatyöt ovat komentoja ja kaikki asetukset ympäristömuuttujia. Pääkäyttöliittymä on aina web-sovellus.

| Osa                         | GitHub + Supabase (nyt) | Oma palvelin / VPS (Docker)          | Webhotelli                             |
| --------------------------- | ----------------------- | ------------------------------------ | -------------------------------------- |
| Käyttöliittymä (staattinen) | GitHub Pages            | Caddy tai nginx                      | ✓ mikä tahansa webhotelli              |
| API (`/api/v1`)             | Supabase Edge Function  | Node.js-kontti                       | vain jos tukee Node.js:ää tai Dockeria |
| Tietokanta                  | Supabase PostgreSQL     | PostgreSQL 17 + pgvector -kontti     | vain jos PostgreSQL saatavilla         |
| Taustatyöt                  | GitHub Actions          | worker-kontti (cron)                 | cron + Node.js                         |
| Kirjautuminen               | Supabase Auth           | Supabase Auth, Keycloak tai muu OIDC | OIDC-palvelu                           |
| Tiedostot                   | Supabase Storage        | paikallinen levy tai S3              | S3                                     |

## 1. GitHub + Supabase (nykyinen tapa)

1. Luo Supabase-projekti (EU-alue). Tietokannassa on valmiina `pgvector` ja `pg_trgm`.
2. Aja `pnpm deploy:setup`. Ensimmäinen ajo luo tiedoston `.env.deploy`; täytä:
   - `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API)
   - `DATABASE_URL` (Project Settings → Database → Connection string, _Session pooler_, salasana mukaan)
   - `SUPABASE_ACCESS_TOKEN` (Account → Access tokens)
   - `ALLOWED_EMAILS` (pilkuin erotellut sallitut käyttäjät)
   - valinnaiset: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_DISPATCH_TOKEN`, `BACKUP_S3_*`
3. Aja `pnpm deploy:setup` uudelleen (kokeile ensin `--dry-run`). Komento:
   - asettaa GitHub Secretsit ja Variablesit (`gh`),
   - ottaa GitHub Pagesin käyttöön (julkaisu Actionsilla),
   - asettaa Edge Functionin salaisuudet, sulkee julkisen rekisteröitymisen, asettaa paluuosoitteet, luo tallennustilan ja sallitut käyttäjät (Supabase Management API),
   - käynnistää työnkulut `supabase.yml` (migraatiot + Edge Function) ja `pages.yml` (käyttöliittymä).
4. Avaa `https://<käyttäjä>.github.io/<repo>/` ja kirjaudu sähköpostilinkillä.

Automaattiset työnkulut (`.github/workflows/`):

| Työnkulku      | Milloin                                     | Mitä                                                                                           |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ci.yml`       | jokainen push ja PR                         | lint, formatointi, tyypit, SDK ajan tasalla, testit (PostgreSQL + pgvector), build, Playwright |
| `pages.yml`    | push `main`                                 | käyttöliittymä GitHub Pagesiin (`VITE_API_URL`, `VITE_BASE_PATH` = `/<repo>/`)                 |
| `supabase.yml` | push `main` (palvelinkoodi)                 | varmuuskopio → migraatiot → alkudata → Edge Function                                           |
| `jobs.yml`     | ajastus + käyttöliittymän käynnistämät työt | synkronoinnit, tapahtumien jakelu, valvonta, roskakori, jonossa olevat työt                    |
| `backup.yml`   | joka yö, kuun 1. päivä                      | salattu täysi varmuuskopio, palautustesti                                                      |

**Alipolku ja reititys:** käyttöliittymä käännetään alipolulle (`VITE_BASE_PATH`). Pagesin `404.html` ohjaa syvät linkit (esim. `/repo/rekisterit/puolueet`) takaisin sovellukseen, joka palauttaa osoitteen ennen reitittimen käynnistystä.

**Oma verkkotunnus:** aseta `CUSTOM_APP_URL` `.env.deploy`-tiedostoon (alipolku `/`) ja lisää CNAME GitHub Pagesin asetuksiin.

## 2. Oma palvelin tai VPS (Docker)

Vaatimukset: Docker ja Docker Compose, 2 Gt muistia.

```bash
git clone <repo> && cd <repo>
cp .env.example .env
# .env: POSTGRES_PASSWORD, AUTH_PROVIDER (oidc tai supabase), ALLOWED_EMAILS,
#       SETTINGS_ENCRYPTION_KEY, BACKUP_ENCRYPTION_KEY (openssl rand -base64 32),
#       DOMAIN=seuranta.example.fi, PUBLIC_URL=https://seuranta.example.fi,
#       APP_BASE_URL=https://seuranta.example.fi, API_PUBLIC_URL=https://seuranta.example.fi
docker compose -f deploy/docker-compose.selfhost.yml --env-file .env up -d --build
```

Palvelut: `web` (Caddy: staattinen käyttöliittymä + automaattinen HTTPS + `/api` → API), `api` (Node), `worker` (migraatiot käynnistyksessä, cron-ajastukset `deploy/crontab`), `db` (PostgreSQL 17 + pgvector). nginx-vaihtoehto: `deploy/nginx.conf`.

Siirto Supabasesta omalle palvelimelle:

1. Ota varmuuskopio (Ylläpito → Varmuuskopiot → Varmuuskopioi nyt) tai `DATABASE_URL=… deploy/backup.sh`.
2. Käynnistä palvelin yllä olevalla ohjeella ja palauta: `DATABASE_URL=postgres://…@localhost:5432/… BACKUP_ENCRYPTION_KEY=… deploy/restore.sh <tiedosto> --confirm`.
3. Kopioi tiedostot: varmuuskopion `files/*.zip.enc` puretaan `node deploy/decrypt-backup.mjs` ja kopioidaan `STORAGE_LOCAL_DIR`-hakemistoon (tai vaihda tallennus S3:ksi Palvelut-sivulta).
4. Kirjautuminen: pidä Supabase Auth (`AUTH_PROVIDER=supabase`) tai vaihda OIDC-palveluun (`AUTH_PROVIDER=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`). Käyttäjät tunnistetaan sähköpostista, joten roolit säilyvät eikä salasanoja tarvitse siirtää.

Ilman Dockeria: `pnpm install && pnpm --filter @ps/api build && node apps/api/dist/server.mjs`, käyttöliittymä `pnpm build:web` → `apps/web/dist` mille tahansa web-palvelimelle, taustatyöt cronilla (`pnpm job work`, ks. `deploy/crontab`).

## 3. Webhotelli

- **Käyttöliittymä toimii missä tahansa webhotellissa:** aja `VITE_API_URL=https://api.example.fi VITE_BASE_PATH=/ pnpm build:web` ja kopioi `apps/web/dist/` palvelimelle. Lisää uudelleenohjaus kaikista poluista `index.html`:ään (Apache: `.htaccess` → `FallbackResource /index.html`) tai käytä mukana tulevaa `404.html`:ää.
- **API ja tietokanta eivät toimi pelkässä PHP + MySQL -webhotellissa.** API vaatii Node.js:n (tai Dockerin), ja tietokannan on oltava PostgreSQL, koska haku (suomen kielen tekstihaku) ja semanttinen haku (pgvector) perustuvat PostgreSQL:n ominaisuuksiin.
- Toimiva yhdistelmä: käyttöliittymä webhotellissa + API Supabase Edge Functionina tai pienellä VPS:llä + PostgreSQL Supabasessa tai muussa palvelussa (Neon, AWS RDS, Hetzner …).

## Ympäristömuuttujat

Kaikki asetukset ovat ympäristömuuttujia, ja ne on dokumentoitu tiedostossa `.env.example`. Mitään GitHub- tai Supabase-osoitetta ei ole kovakoodattu.

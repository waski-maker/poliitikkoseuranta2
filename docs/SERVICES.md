# Vaihdettavat palvelut

Moduulit käyttävät palveluita vain ytimen rajapintojen kautta (`ctx.services.storage`, `ctx.services.mail`, `ctx.services.jobs`, `ctx.services.realtime`, `ctx.services.backup`, `ctx.ai()`, `ctx.http()`), eivät koskaan tarjoajan kirjastoja suoraan. Palvelun vaihto on asetus, ei koodimuutos.

Asetussivu **Ylläpito → Palvelut** näyttää jokaisen palvelun nykyisen tarjoajan, tilan, viimeisimmän onnistuneen yhteyden ja moduulit, jotka käyttävät palvelua. "Testaa yhteys" kokeilee asetukset heti, ja "Vaihda tarjoaja" tallentaa uudet asetukset (salaiset kentät salattuina) – jos uudet asetukset eivät toimi, vanhat palautetaan automaattisesti. Valvontatyö (`health:check`) testaa palvelut säännöllisesti ja ilmoittaa ylläpitäjälle.

| Palvelu                    | Oletus nyt                               | Toteutetut vaihtoehdot                                                | Rakenne varautuu                             | Vaihto                                |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------- |
| Tietokanta                 | Supabase PostgreSQL                      | mikä tahansa PostgreSQL 15+ (pgvector, pg_trgm)                       | Neon, AWS RDS, Azure, Hetzner, oma palvelin  | `DATABASE_URL` (ks. alla)             |
| Kirjautuminen              | Supabase Auth (sähköpostilinkki)         | OIDC (Keycloak, Entra ID, Google, Auth.js …), dev                     | –                                            | `AUTH_PROVIDER`                       |
| Tiedostojen tallennus      | Supabase Storage                         | S3-yhteensopiva (AWS, R2, MinIO), paikallinen levy                    | –                                            | Palvelut-sivu tai `STORAGE_PROVIDER`  |
| Sähköposti                 | Supabase Auth -sähköpostit               | Resend, palvelimen loki                                               | SMTP, SendGrid, Postmark (uusi sovitin)      | Palvelut-sivu tai `MAIL_PROVIDER`     |
| Reaaliaikaiset ilmoitukset | Supabase Realtime                        | kysely (polling)                                                      | SSE, WebSocket                               | Palvelut-sivu tai `REALTIME_PROVIDER` |
| Taustatöiden ajo           | GitHub Actions                           | API-prosessissa (Node/Docker), jono + cron/systemd/Docker-työntekijä  | –                                            | Palvelut-sivu tai `JOBS_RUNNER`       |
| Tekoäly                    | Anthropic Claude                         | OpenAI, OpenAI-yhteensopivat (Ollama, vLLM, LM Studio …), valepalvelu | Gemini, Mistral, Azure OpenAI (uusi sovitin) | Ylläpito → Tekoäly                    |
| Upotteet                   | OpenAI / valepalvelu                     | OpenAI-yhteensopivat                                                  | –                                            | Ylläpito → Tekoäly                    |
| Varmuuskopioiden kohde     | S3-yhteensopiva                          | paikallinen levy                                                      | toinen pilvi, oma palvelin                   | Palvelut-sivu tai `BACKUP_TARGET`     |
| Käyttöliittymän julkaisu   | GitHub Pages                             | Caddy, nginx, webhotelli                                              | mikä tahansa staattinen palvelin             | DEPLOYMENT.md                         |
| API:n ajoympäristö         | Supabase Edge Functions                  | Node.js, Bun, Docker                                                  | –                                            | DEPLOYMENT.md                         |
| Tietolähteet               | Eduskunnan avoin data (api.eduskunta.fi) | –                                                                     | muuttunut osoite/versio, varalähde           | `EDUSKUNTA_API_URL`                   |

Koodi: `packages/core/src/services/` (rajapinnat `types.ts`, sovittimet `adapters/`, rekisteri `registry.ts`).

## Vaihto-ohjeet

### Tietokanta (PostgreSQL → toinen PostgreSQL)

Tietokanta ja kirjautuminen ovat poikkeus, koska ohjelma tarvitsee ne käynnistyäkseen: ne annetaan ympäristömuuttujina.

1. Luo uusi PostgreSQL 15+ ja ota käyttöön laajennukset `vector`, `pg_trgm`, `pgcrypto`.
2. Ota varmuuskopio vanhasta (`pnpm job run backup:full` tai `deploy/backup.sh`).
3. Palauta uuteen: `DATABASE_URL=<uusi> deploy/restore.sh <tiedosto> --confirm`.
4. Vaihda `DATABASE_URL` (GitHub Secrets / Supabase-salaisuudet / `.env`) ja aja `pnpm db:migrate`.

Siirto toiseen tietokantatyyppiin (esim. MySQL) ei kuulu tavoitteisiin: haku ja upotteet perustuvat PostgreSQL:n ominaisuuksiin.

### Kirjautuminen

1. Määritä uusi palvelu (OIDC: `OIDC_ISSUER`, `OIDC_JWKS_URL`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`) ja vaihda `AUTH_PROVIDER`.
2. Käyttäjät tunnistetaan sähköpostista: ensimmäisellä kirjautumisella käyttäjärivi siirtyy uuteen tunnisteeseen ja roolit säilyvät. Salasanoja ei tarvitse siirtää (sähköpostilinkki / OIDC).

### Tiedostojen tallennus

Valitse Palvelut-sivulla uusi tarjoaja ja testaa. Kopioi vanhat tiedostot: ota täysi varmuuskopio (sisältää tiedostot ZIP-pakettina), pura `node deploy/decrypt-backup.mjs` ja lataa uuteen kohteeseen.

### Tekoäly

Ylläpito → Tekoäly: lisää API-avain, valitse palvelu ja malli tehtävittäin, varapalvelu ja upotemalli; "Testaa yhteys". Tietosuoja-asetus rajaa ei-julkisen tiedon sisäisille malleille. Käyttö näkyy samalla sivulla palveluittain.

## Poistumissuunnitelma

- **PostgreSQL-vedos:** `pnpm job run backup:full` (salattu) tai `deploy/backup.sh`.
- **JSON-vienti kaikesta:** jokaisen moduulin tiedot tarjoajasta riippumattomana JSON-tiedostona (Varmuuskopiot → Lataa JSON tai `pnpm job module:export <id>`); palautus myös uudempaan ohjelmaversioon.
- **Tiedostot:** täyden varmuuskopion `files/*.zip.enc`.
- **Käyttäjät:** sähköpostilistat ja roolit ovat omissa tauluissa (`core.users`, `core.user_roles`), ei kirjautumispalvelussa.

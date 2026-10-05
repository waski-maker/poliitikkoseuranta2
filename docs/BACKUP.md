# Varmuuskopiointi ja palautus

Tavoite: mitään käsin syötettyä tai rahalla tuotettua tietoa ei voi menettää, vaikka palveluntarjoaja lopettaisi, tietokanta vioittuisi tai joku poistaisi tietoa vahingossa.

## Yleiskuva

| Mitä                                        | Milloin                                                      | Missä                                                  | Toteutus                                                                      |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Täysi varmuuskopio (tietokanta + tiedostot) | joka yö 01:30 UTC                                            | varmuuskopioiden kohde (S3-yhteensopiva, eri tarjoaja) | `pnpm job run backup:full` (`.github/workflows/backup.yml`, `deploy/crontab`) |
| Palautustesti                               | kuun 1. päivä                                                | kertakäyttöinen PostgreSQL                             | `pnpm job run backup:verify`                                                  |
| Kopio ennen migraatioita                    | jokainen `pnpm db:migrate`                                   | varmuuskopioiden kohde                                 | automaattinen (`BACKUP_BEFORE_MIGRATE=true`)                                  |
| Tilannekuva ennen riskitoimintoja           | yhdistäminen, suuri tuonti, massamuokkaus, moduulin palautus | `core.snapshots` (90 pv)                               | `takeSnapshot()`                                                              |
| Moduulin JSON-vienti                        | käsin tai `backup:module`                                    | lataus / kohde                                         | Varmuuskopiot-sivu                                                            |
| Roskakori                                   | jokainen poisto                                              | sama taulu (`deleted_at`)                              | 30 päivää, sitten `trash:purge`                                               |
| Muutoshistoria                              | jokainen muutos                                              | `core.audit_log`                                       | palautus mihin tahansa versioon                                               |

**Säilytys** (asetettavissa Varmuuskopiot-sivulla / `PUT /api/v1/backups/retention`): 7 päivittäistä, 4 viikoittaista ja 12 kuukausittaista kopiota. Vanhemmat poistetaan kohteesta automaattisesti.

**3-2-1:** tuotantodata Supabasessa, varmuuskopiot eri tarjoajalla (esim. Cloudflare R2, Backblaze B2, oma palvelin), ja moduulikohtaiset JSON-viennit voi ladata omalle koneelle.

## Salaus

- Varmuuskopiot salataan AES-256-GCM:llä **ennen** siirtoa. Tiedostomuoto: `PSB1` (4 tavua) | IV (12) | salattu data | todennustunniste (16).
- Avain `BACKUP_ENCRYPTION_KEY` (32 tavua base64) säilytetään **erillään** varmuuskopioista: GitHub Secrets / palvelimen ympäristö **ja** turvallinen paikka (salasanojen hallinta). Ilman avainta varmuuskopioita ei voi palauttaa.
- Varmuuskopioita ei koskaan tallenneta Git-repositorioon (`.gitignore`: `backups/`, `*.dump*`).
- Asetukset kuuluvat tietokantaan ja ovat mukana varmuuskopiossa; salaiset avaimet (`core.secrets`) ovat siellä valmiiksi salattuina `SETTINGS_ENCRYPTION_KEY`:llä, joka palautetaan erikseen.

## Moduulikohtaisuus

Jokainen moduuli kertoo manifestissaan (`backup`):

- **korvaamattomat** taulut ja tiedostot (käsin syötetyt, muokkaukset, analyysit) – aina mukana,
- **uudelleen tuotettavat** (avoin data, hakuindeksit, upotteet) – jätetään oletuksena pois päivittäisen kopion datasta (rakenne on mukana) ja lasketaan palautuksen jälkeen uudelleen taustatyönä,
- `schemaVersion` – vanhemman version JSON-varmuuskopio muunnetaan moduulin `upgradeBackup()`-funktiolla, joten palautus toimii uudempaan ohjelmaversioon.

## Palautus käyttöliittymästä

Ylläpito → Varmuuskopiot:

- **Koko järjestelmä:** valitse kopio → "Palauta…" → kirjoita `PALAUTA`. Ennen palautusta nykytilasta otetaan automaattisesti uusi varmuuskopio. (Palautus on ainoa toiminto, joka vaatii erillisen vahvistuksen.)
- **Yksi moduuli:** "Palauta…" moduulin rivillä → valitse JSON-tiedosto → `PALAUTA`. Nykyisistä tiedoista otetaan tilannekuva.
- **Yksittäinen tietue:** Ylläpito → Muutoshistoria → "Palauta tähän" tai Roskakori → "Palauta".

## Palautus komentoriviltä

```bash
# Moduuli JSON-tiedostosta
pnpm job module:import moduuli-0.001-2026-10-05.json --confirm

# Koko tietokanta sovelluksen varmuuskopiosta (lataa ensin kohteesta, esim. aws s3 cp / rclone)
DATABASE_URL=postgres://… BACKUP_ENCRYPTION_KEY=… deploy/restore.sh full/2026-10-05T01-30-00-000Z-ab12cd34.dump.enc --confirm
```

## Kun ohjelma itse ei käynnisty

Palautukseen tarvitaan vain PostgreSQL:n työkalut (`pg_restore`, `psql`) ja Node.js tai OpenSSL – ei sovellusta:

1. Hae uusin kopio kohteesta (S3-konsoli, `aws s3 ls s3://<bucket>/full/`, `rclone`).
2. Pura salaus: `BACKUP_ENCRYPTION_KEY=… node deploy/decrypt-backup.mjs kopio.dump.enc kopio.dump`
   (sovelluksesta riippumaton, käyttää vain Node.js:n crypto-moduulia).
3. Luo tyhjä PostgreSQL 15+ (pgvector), roolit ja laajennukset – `deploy/restore.sh` tekee tämän – ja palauta:
   `pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" kopio.dump`
4. Tiedostot: `files/*.zip.enc` → pura samalla komennolla → `unzip`.
5. Käynnistä sovellus (`DATABASE_URL` uuteen kantaan) ja aja `pnpm db:migrate`; uudelleen tuotettavat tiedot (hakuindeksi, upotteet) lasketaan taustatöinä (`pnpm job run embeddings:reindex`).

Käsin tehty varmuuskopio ilman sovellusta: `DATABASE_URL=… BACKUP_ENCRYPTION_KEY=… deploy/backup.sh` (OpenSSL AES-256-CBC + PBKDF2).

## Palautustesti

`backup:verify` lataa uusimman täyden kopion, purkaa salauksen, palauttaa sen tyhjään tietokantaan (`BACKUP_VERIFY_DATABASE_URL`; GitHub Actionsissa kertakäyttöinen kontti) ja tarkistaa migraatiohistorian sekä korvaamattomien taulujen rivimäärät. Tulos näkyy Varmuuskopiot-sivulla; epäonnistuminen lähettää ylläpitäjälle ilmoituksen.

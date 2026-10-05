# Tietolähteet

Jokaisella ulkoisella tietolähteellä on oma sovittimensa; osoite, versio ja nopeusrajoitukset ovat asetuksia (`EDUSKUNTA_API_URL`, `EDUSKUNTA_USER_AGENT`, `EDUSKUNTA_MIN_INTERVAL_MS`). Jos lähteen rakenne muuttuu, vain sovitin päivitetään.

## Eduskunnan avoin data

|                    |                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Rajapinta          | `https://api.eduskunta.fi/api/v1/` (OpenAPI: `https://api.eduskunta.fi/openapi.json`)                                                      |
| Lisenssi           | CC BY 4.0, tuottaja Eduskunta – lähde mainitaan käyttöliittymässä ja vienneissä                                                            |
| Vanha rajapinta    | `avoindata.eduskunta.fi` (taulut kuten `MemberOfParliament`, `SaliDBPuheenvuoro`) – **käytöstä luovutaan vuoden 2026 lopussa**, ei käytetä |
| Pakollinen otsake  | `User-Agent` (ilman sitä 403). Lisää yhteystieto (`EDUSKUNTA_USER_AGENT`).                                                                 |
| Nopeusrajoitus     | POST `/search*`: 450 pyyntöä / 3000 s / IP. Sovitin pysyy alle (430 / 3000 s) ja pitää vähimmäisvälin pyyntöjen välillä.                   |
| Uudelleenyritykset | 429 ja 5xx: eksponentiaalinen viive, `Retry-After` huomioidaan. `Deprecation`/`Sunset`-otsakkeet ilmoitetaan ylläpitäjälle.                |

### Miten rakenne tarkistettiin

Tämän kehitysympäristön verkkorajaus esti suorat kutsut sekä `api.eduskunta.fi`- että `avoindata.eduskunta.fi`-osoitteisiin (HTTP 403 välityspalvelimelta). Kenttiä ei arvattu: rakenne tarkistettiin kahden avoimen lähdekoodiprojektin dokumentaatiosta, lähdekoodista ja **sellaisinaan tallennetuista API-vastauksista** (testiaineisto SHA-256-tiivisteineen, haettu 2.10.2026 ja syyskuussa 2026):

- [petudesign/Eduskuntadata](https://github.com/petudesign/Eduskuntadata) – `docs/sources.md`, `src/client.mjs`, `src/normalize.mjs`, `test/fixtures/*.json`
- [atvilkman/datalla-vaaleihin-2027](https://github.com/atvilkman/datalla-vaaleihin-2027) – `edk/client.py`, `edk/collectors.py`, `edk/tables.py`

Sovittimet validoivat jokaisen rivin ja kirjaavat poikkeavat rivit ajolokiin (Ylläpito → Synkronoinnit) sen sijaan, että hylkäisivät koko ajon. Kun ohjelma ajetaan ympäristössä, jossa rajapinta on tavoitettavissa, ensimmäinen ajo vahvistaa rakenteen.

### Haku ja sivutus (`POST /search`)

Pyyntö: `{ "category": "<luokka>", "query"?: "...", "expression"?: {...}, "sort"?: [{ "property": "id", "ascending": true }], "maxResults": 1..1000, "startFromIndex": n, "fields"?: { "operation": "include"|"exclude", "list": [...] } }`

Vastaus: `{ "searchMetadata": { "totalResultCount", "startFromIndex", "actualResultCount", ... }, "results": [ { "id", "type", "<luokka>": { ...tietue } } ] }` – tietue on luokan nimisen avaimen alla.

- Sivutusikkuna: `startFromIndex + maxResults <= 10000`. Suuremmat joukot: asynkroninen `POST /search/dataset` → `GET /search/dataset/status/{jobId}` → `resultUrl` (NDJSON).
- `POST /search/count` palauttaa `{ count }`.
- Päivämäärärajaus: `expression: { "property", "fromDate", "toDate" }` (alku mukaan, loppu ei). Tarkka arvo: `{ "property", "match" }`.
- Luokkia mm. `kansanedustaja`, `puheenvuoro`, `aanestys`, `valtiopaivaasia`.

### Viitetiedot (moduuli 0.001) – `GET /reference-data/{nimi}`

Käytössä: `eduskuntaryhmat`, `vaalipiirit`, `vaalikaudet`, `valiokunnat` (saatavilla myös `asiakirjatyypit`, `asiatyypit`, `puheenvuorotyypit`, `sukupuolet`, `valtiopaivat`, `kansanedustajat`).

- Vastaus on lista tai objekti, jonka sisällä on lista (sovitin purkaa molemmat).
- Rivillä `tunnus`, monikielinen `nimi` (`{ fi, sv, en }`) ja `aktiivinen`. Eduskuntaryhmän tunnus on muotoa `PS01~PERUSSUOMALAISTEN EDUSKUNTARYHMÄ` → tunnus `PS01`, puolue etuliitteestä `PS`.
- Vaalikausien alkupäivä (esim. 2023-04-05) tulee viitetiedoista; sovitin poimii alku- ja loppupäivän kentistä, joiden nimi alkaa `alku`/`loppu`.
- Eduskuntaryhmä ≠ puolue: ryhmät tallennetaan omaan tauluunsa ja linkitetään puolueeseen (ks. DECISIONS D11).
- Eduskunnan tunnukset tallennetaan tauluun `core.external_ids` (`system = 'eduskunta'`), joten vaalipiirit ja valiokunnat yhdistyvät alkudatan riveihin.

Synkronointi: `pnpm job run sync:registries` tai Ylläpito → Synkronoinnit → Päivitä nyt. Ajastus: joka yö ja istuntopäivinä tunneittain.

### Kansanedustajat (moduuli 1.001, vaihe 1)

- Haku: `POST /search` luokalla `kansanedustaja` (koko henkilörekisteri vuodesta 1907; kokeiltu 2 677 osumaa, tilat `Nykyinen`, `Entinen`, `Keskeytynyt`). `GET /kansanedustajat` palauttaa vain 1 000 henkilöä – ei käytetä täydelliseen tuontiin.
- Henkilö: `GET /kansanedustajat/{henkilonro}`. Kentät: `henkilonro`, `etunimet`, `sukunimi`, `kutsumanimi`, `syntymavuosi`, `kuolemavuosi`, `syntymapaikka`, `kotikunta`, `sukupuolikoodi`, `ammatti` (`{fi,sv,en}`), `sahkoposti`, `puhelinnumero`, `edustajantoimenTila`, `kansanedustajuusPaattynytPvm`, `viimeisinEduskuntaryhma`, `eduskuntaryhmat[]` (`nimi`, `tunnus`, `alkupvm`, `loppupvm`), `vaalipiirit[]` (sama rakenne), `viimeisinVaalipiiri`, `edustajatoimet[]` (`alkupvm`, `loppupvm`), `sidonnaisuudet.fi[]` (`sidonta`, `ryhmaotsikko`, `vuosi`, `ilmoitusTyyppi`, `jarjestys`), `valiokuntajasenyydet[]`, `toimielinjasenyydet[]`.
- Henkilönumero (`henkilonro`) on sama kuin puheiden `puhuja.henkilonro` ja äänestysten `henkilonumero` → tallennetaan `core.external_ids` (`system = 'eduskunta'`, `entity_type = 'person'`).
- Puoluehistoria = `eduskuntaryhmat[]` aikaväleineen; vaalipiirihistoria = `vaalipiirit[]`.

### Puheenvuorot (moduuli 1.002, vaihe 2)

- `POST /search` luokalla `puheenvuoro`. Tietueessa mm. `id` (esim. `PUH 99/2024/4/1/58`), `tunnus` (`{fi: "PTK 99/2024 vp", sv}`), `tila`, `puheenvuorotyyppikoodi` + `puheenvuorotyyppinimi` (esim. `T` = Varsinainen puheenvuoro), `valtiopaiva`, `valtiopaivavuosi`, `taysistuntonumero`, `asia.{fi,sv}.{eduskuntatunnus, nimeketeksti}`, `poytakirjanasiankohta.{fi,sv}.{eduskuntatunnus, kohtanumero, nimeketeksti}`, `asiakirjaviitteet.{fi,sv}[]`, `puhuja.{henkilonro, asema, etunimi, sukunimi, lisatieto, eduskuntaryhma_tunnus}`, `aloitushetki`, `lopetushetki`, `kellonaika`, `puheenvuoro` (koko teksti).
- Kattavuus: puheenvuorot syksystä 1999 (eduskunnan hakupalvelun kattavuustieto). Koko historia haetaan `search/dataset`-viennillä (NDJSON) vuosittain, inkrementaalisesti `aloitushetki`-päivämäärärajauksella.
- Puolue puhehetkellä: `puhuja.eduskuntaryhma_tunnus` + henkilön ryhmähistoria.
- Asian tiedot: `GET /valtiopaivaasiat/{tunnus}` (esim. `HE 74/2023 vp`): `kasittelyt.fi[]`, `keskeisetAsiakirjat.fi[]`, `asiasanat.fi[]`, `ehdotukset.fi[]`. Asiakirja: `GET /asiakirjat/edktunnus/{edktunnus}` (`fullText`).

## Oikeusministeriön puoluerekisteri

Puolueiden viralliset nimet ja tunnukset on koottu alkudataan käsin (`modules/0.001-registries/src/seed/data.ts`). Rekisteröinti- ja poistopäivät täydennetään käsin; myöhemmin oma sovitin (vaalit.fi), kun lähteen rakenne on tarkistettu.

## Muut tulevat lähteet (tutkittu, ei toteutettu)

Avoimuusrekisteri (VTV, CC BY 4.0), vaalirahoitusilmoitukset (VTV:n CSV, lisenssi tarkistettava) ja Finlex (avoin data, Akoma Ntoso XML) – ks. petudesign/Eduskuntadata `docs/sources.md`. Henkilöiden yhdistäminen näihin vaatii tarkistetun vastaavuuden; nimen samankaltaisuus ei yksin riitä.

# Tietosuoja

Tämä kuvaus koskee Poliitikkoseurantaa sellaisena kuin se on vaiheessa 0–2: suljettu työkalu, jota käyttävät vain kutsutut käyttäjät. Kuvaus päivitetään, kun ohjelmaan lisätään julkinen näkymä.

## Mitä tietoja käsitellään

| Tieto                                            | Esimerkki                                                                                              | Lähde                                                             | Peruste                                                                                                                                             | Näkyvyys oletuksena                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Poliitikkojen julkiseen rooliin liittyvät tiedot | nimi, puolue, vaalipiiri, luottamustoimet, valiokuntajäsenyydet, puheenvuorot, sidonnaisuusilmoitukset | Eduskunnan avoin data (CC BY 4.0), käsin lisätyt julkiset lähteet | Yleisen edun mukainen tehtävä / oikeutettu etu: julkisen vallan käytön seuranta ja tutkimus (tietosuoja-asetus 6(1)(e)/(f), 85 artikla sananvapaus) | internal                                           |
| Virkayhteystiedot                                | eduskunnan sähköposti ja puhelin                                                                       | Eduskunnan avoin data                                             | kuten yllä                                                                                                                                          | internal                                           |
| Henkilökohtaiset yhteystiedot                    | kotiosoite, yksityinen puhelin                                                                         | käsin lisätty                                                     | oikeutettu etu, vain tarvittaessa                                                                                                                   | **private** – ei koskaan julkaista automaattisesti |
| Puolueet ja muut rekisterit                      | nimet, tunnusvärit                                                                                     | eduskunta, puoluerekisteri                                        | – (ei henkilötietoa)                                                                                                                                | public                                             |
| Käyttäjät                                        | sähköposti, roolit, kirjautumisaika                                                                    | käyttäjä itse                                                     | sopimus / oikeutettu etu (pääsynhallinta)                                                                                                           | –                                                  |
| Audit-loki                                       | kuka muutti mitä, vanha ja uusi arvo, viennit                                                          | järjestelmä                                                       | oikeutettu etu (eheys, väärinkäytösten selvitys)                                                                                                    | vain ylläpito                                      |
| Tekoälyn käyttöloki                              | palvelu, malli, tokenit, kustannus                                                                     | järjestelmä                                                       | oikeutettu etu (kustannusten seuranta)                                                                                                              | vain ylläpito                                      |

## Periaatteet

- **Tietojen minimointi:** tallennetaan vain seurannan kannalta tarpeellinen tieto. Henkilötunnuksia, terveystietoja tai muita erityisiä henkilötietoryhmiä ei tallenneta. Puoluekanta on julkisen roolin tieto.
- **Näkyvyystaso jokaisella tietueella** (`public` / `internal` / `private`). Nyt kaikki on kirjautumisen takana; julkisen näkymän säännöt on kirjoitettu valmiiksi, mutta ne ovat pois päältä.
- **Lähde ja alkuperä** tallennetaan jokaiselle tiedolle (lähde, noutoaika, lähde-URL) ja näytetään käyttöliittymässä ja vienneissä.
- **Pääsy** vain sallittujen sähköpostien listalla oleville; oikeudet tarkistetaan sekä API:ssa että tietokannassa (RLS).
- **Audit-loki** kirjaa kaikki muutokset ja viennit.
- **Tekoäly:** ylläpitäjä voi määrätä, että ei-julkinen tieto lähetetään vain sisäiselle mallille (Ylläpito → Tekoäly → "Ei-julkinen tieto vain sisäiselle mallille"). API-avaimet säilytetään salattuina palvelimella.
- **Säilytys:** poistetut tiedot ovat roskakorissa 30 päivää; varmuuskopiot säilytetään 7 päivää / 4 viikkoa / 12 kuukautta ja ne on salattu.
- **Rekisteröidyn oikeudet:** pyynnöt (tarkastus, oikaisu, poisto) käsittelee ylläpitäjä; audit-lokista näkyy tietueen koko historia, ja tiedon voi oikaista tai poistaa käyttöliittymästä.

## Eduskunnan avoimen datan ehdot

Eduskunnan avoin data on lisensoitu CC BY 4.0 -lisenssillä. Lähde ("Eduskunta, avoin data") mainitaan käyttöliittymässä ja jokaisessa viedyssä tiedostossa. Aineiston muokkaus (esim. normalisointi, tekoälyanalyysit) merkitään johdetuksi.

## Käsittelijät

- **Supabase** (tietokanta, kirjautuminen, tiedostot) – valitse EU-alue projektia luodessa.
- **GitHub** (käyttöliittymän julkaisu, taustatyöt) – ei tallenna sovelluksen dataa pysyvästi.
- **Tekoälypalvelu** (oletus Anthropic) – vain analyysiin valittu aineisto; voidaan korvata sisäisellä mallilla.
- **Varmuuskopioiden kohde** (S3-yhteensopiva) – vain salattuja tiedostoja.

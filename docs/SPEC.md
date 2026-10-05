# Poliitikkoseuranta 2.0 – määrittely

## 1. Rooli, tavoite ja toimintatapa

Olet kokenut full-stack-kehittäjä ja ohjelmistoarkkitehti. Rakennat suomalaisen politiikan seurantaohjelman (työnimi Poliitikkoseuranta 2.0), joka kerää, tallentaa, hakee ja analysoi suomalaisen politiikan avointa dataa. Ohjelma rakennetaan moduuleista, ja moduuleja tulee jatkossa paljon lisää, joten arkkitehtuurin on kestettävä kasvua.

### Toimintatapa – tärkein ohje

- Tee kaikki itse. Käyttäjälle jää mahdollisimman vähän tehtävää. Asenna riippuvuudet, luo tietokantaskeema, aja migraatiot, kirjoita testit, korjaa virheet ja aja sovellus itse.
- Älä kysy turhaan. Älä kysy "jatkanko?", "haluatko että…?" tai pyydä vahvistusta vaiheiden välillä. Jatka suoraan seuraavaan tehtävään, kunnes kaikki tämän dokumentin vaiheet ovat valmiita.
- Tee järkevät oletuspäätökset itse ja kirjaa ne tiedostoon docs/DECISIONS.md (päivämäärä, päätös, perustelu, vaihtoehdot).
- Kysy vain, kun olet aidosti jumissa, esimerkiksi kun tarvitset salaisen avaimen. Kokoa silloin kaikki tarvittavat kysymykset yhteen viestiin.
- Tarkista ulkoiset rajapinnat ennen koodaamista. Hae eduskunnan avoimen datan rajapinnan todellinen rakenne (taulut, kentät, sivutus) ennen kuin kirjoitat tuontikoodia. Älä arvaa kenttien nimiä.
- Pidä projekti aina ajokelpoisena. Jokaisen vaiheen lopussa sovellus käynnistyy, testit menevät läpi ja muutokset on commitoitu selkein commit-viestein.
- Kieli: käyttöliittymä, README ja käyttäjälle näkyvät tekstit suomeksi. Koodi, muuttujat ja koodikommentit englanniksi.

### Pysyvät ohjeet tuleville istunnoille

Luo heti alussa tiedosto CLAUDE.md, joka sisältää projektin arkkitehtuurin tiivistelmän, moduulisäännöt, koodauskäytännöt, ajokomennot ja yllä olevat toimintatapaohjeet. Päivitä sitä aina, kun arkkitehtuuri muuttuu, jotta tulevat istunnot jatkavat johdonmukaisesti.

## 2. Teknologiavalinnat ja GitHub-ympäristö

Käytä alla olevaa pinoa, ellei rajapintojen tarkistus osoita painavaa syytä muuttaa sitä. Kirjaa mahdolliset poikkeamat DECISIONS.md-tiedostoon.

| Osa-alue | Valinta | Perustelu |
| --- | --- | --- |
| Kieli | TypeScript (strict) | Tyyppiturvalliset moduulirajapinnat |
| Käyttöliittymä | Next.js staattisena vientinä (output: 'export') tai Vite + React | Toimii GitHub Pagesissa ilman omaa palvelinta |
| Verkkojulkaisu | GitHub Pages, julkaisu GitHub Actionsilla | Sovellus on käytössä verkossa suoraan GitHubista |
| Tietokanta | PostgreSQL (Supabase) | GitHub ei tarjoa tietokantaa; Supabase on ainoa ulkoinen palvelu |
| Palvelinlogiikka | Hono-pohjainen TypeScript-API, ajetaan nyt Supabase Edge Functionissa | Kaikki asiakkaat käyttävät samaa API:a; sama koodi toimii myöhemmin omalla palvelimella |
| Oikeudet | Supabase Auth + Row Level Security | Oikeudet tarkistetaan API:ssa ja lisäksi tietokannassa toisena suojakerroksena |
| ORM ja migraatiot | Drizzle ORM tai Supabase-migraatiot | Migraatiot versionhallintaan |
| UI-kirjastot | Tailwind CSS, shadcn/ui, Radix, lucide-ikonit | Moderni, saavutettava, muokattava ulkoasu |
| Kaaviot | Recharts tai Tremor | Tyylikkäät datavisualisoinnit |
| Tekoäly | Vaihdettava tekoälypalvelu (oletus Anthropic Claude; OpenAI ja sisäiset mallit asetuksista) | API-avain ei koskaan päädy selaimeen |
| Upotteet | pgvector + vaihdettava upotemalli | Semanttinen haku puheisiin |
| Taustatyöt | GitHub Actions (ajastettu ja käsin käynnistettävä) | Datan tuonti ja raskaat ajot ilman omaa palvelinta |
| Testit | Vitest, Playwright | Yksikkö- ja käyttöliittymätestit |
| Paketinhallinta | pnpm, monorepo | Moduulit omina paketteinaan |

### GitHub-ympäristö

Ohjelmaa käytetään verkossa selaimella, ja kaikki mahdollinen toimii GitHubissa. GitHub ei kuitenkaan pysty ajamaan tietokantaa eikä jatkuvasti käynnissä olevaa palvelinta, joten tietokanta ja pienet palvelinfunktiot ovat Supabasessa. Työnjako:

- GitHub Pages: käyttöliittymä osoitteessa `https://<käyttäjä>.github.io/<repo>/` (myöhemmin oma verkkotunnus). Julkaisu tapahtuu automaattisesti GitHub Actionsilla jokaisesta main-haaran pushista. Ota huomioon Pagesin alipolku (basePath) ja asiakaspuolen reititys (404-uudelleenohjaus).
- GitHub Actions: CI (lint, tyypit, testit), julkaisu Pagesiin, Supabase-migraatioiden ajo ja Edge Functionien julkaisu sekä datan synkronoinnit (ajastettu kerran vuorokaudessa ja istuntopäivinä tiheämmin). Käyttöliittymän tuontinäkymä käynnistää tuonnin Edge Functionin kautta, joka laukaisee Actions-työn (workflow_dispatch); edistyminen luetaan tietokannasta.
- Supabase: tietokanta, kirjautuminen, Row Level Security ja Edge Functions.
- Codespaces / devcontainer: kehitysympäristö, jossa Node, pnpm ja paikallinen Supabase (Supabase CLI). Kehitys onnistuu myös ilman verkkoon julkaisua.
- Salaisuudet: Tekoälypalveluiden avaimet ja Supabasen service role -avain vain GitHub Secretsissä ja Supabasen salaisuuksissa. Selaimeen menee vain Supabasen julkinen anon-avain.
- Asennus yhdellä komennolla: `pnpm setup` asentaa kaiken, luo .env-tiedoston pohjasta, ajaa migraatiot ja tuo alkudatan. Lisäksi `pnpm deploy:setup` asettaa GitHub Secretsit ja ottaa Pagesin käyttöön gh-komentorivityökalulla, jotta käyttäjän ei tarvitse tehdä sitä asetuksista käsin. .env.example dokumentoi jokaisen muuttujan suomeksi.

## 3. Moduuliarkkitehtuuri ja moduulien välinen viestintä

Jokainen moduuli on itsenäinen paketti, joka puhuu muille vain julkisen rajapintansa ja tapahtumaväylän kautta. Moduuli ei koskaan lue toisen moduulin tauluja suoraan.

### Numerointi

- 0.xxx = ydin ja yhteiset palvelut (esim. 0.001 Perusrekisterit, 0.002 Käyttäjät ja oikeudet).
- 1.xxx = eduskunta ja kansanedustajat (1.001 Kansanedustajat, 1.002 Puheet; tulevia esim. äänestykset, kysymykset, asiakirjat).
- 2.xxx, 3.xxx… = tulevat kokonaisuudet (esim. kunnat, hyvinvointialueet, EU, media, vaalirahoitus). Varaa numerointi, älä toteuta.

### Hakemistorakenne

```
/apps/web                 web-käyttöliittymä (staattinen vienti GitHub Pagesiin)
/apps/api                 Hono-API: kaikkien moduulien REST-rajapinta /api/v1 (Edge Function / Node / Docker)
/apps/worker              taustatöiden komennot (tuonnit, analyysit, viennit)
/packages/core            tietokanta, tapahtumaväylä, moduulirekisteri, haku, AI, vienti, oikeudet, sovittimet
/packages/sdk             OpenAPI-kuvauksesta generoitu tyypitetty asiakaskirjasto
/packages/ui              yhteiset UI-komponentit ja design-järjestelmä
/modules/0.001-registries puolueet, vaalipiirit, vaalikaudet, valiokunnat, toimielimet
/modules/1.001-mps        kansanedustajat ja henkilörekisteri
/modules/1.002-speeches   puheet, haku, vienti, analyysit
/supabase/migrations      tietokantamigraatiot ja RLS-säännöt
/supabase/functions       ohut kääre, joka ajaa /apps/api:n Edge Functionina
/deploy                   docker-compose.selfhost.yml, nginx/Caddy-asetukset, varmuuskopioskriptit
/.github/workflows        CI, Pages-julkaisu, synkronoinnit
/docs                     SPEC.md, DECISIONS.md, MODULES.md, DATA-SOURCES.md, DEPLOYMENT.md, SERVICES.md, BACKUP.md, PRIVACY.md
```

### Moduulin rakenne

Jokaisella moduulilla on samat osat:

- manifest.ts: tunnus (esim. 1.002), nimi, versio, riippuvuudet muihin moduuleihin, tarjotut palvelut, julkaistut ja kuunnellut tapahtumat, valikkokohdat, oikeudet, asetukset, käyttämänsä palvelut ja tietolähteet sekä varmuuskopiointitiedot (korvaamattomat ja uudelleen tuotettavat taulut ja tiedostot).
- schema.ts: moduulin omat taulut omassa PostgreSQL-skeemassaan (esim. m1002_speeches).
- api.ts: tyypitetty julkinen rajapinta, jota muut moduulit kutsuvat (esim. mps.getPerson(id), speeches.search(query)).
- events.ts: tapahtumien tyypit ja käsittelijät.
- sync/: tuonti ulkoisista lähteistä.
- ui/: sivut, komponentit ja moduulin oma kojelautakortti.
- tests/ ja README.md.

### Viestintä moduulien välillä

1. Synkroniset kutsut moduulirekisterin kautta: `registry.get('1.001').api.getPerson(id)`. Rekisteri tarkistaa riippuvuudet käynnistyksessä.
2. Tapahtumaväylä (domain events) tietokannan outbox-taulun avulla, jolloin tapahtumat säilyvät ja ne voidaan toistaa. Esimerkkejä: person.created, person.updated, party.changed, speech.imported, analysis.completed. Jokainen tapahtuma sisältää tyypin, version, aikaleiman, lähdemoduulin ja hyötykuorman.
3. Jaetut tunnisteet: henkilöillä, puolueilla, vaalipiireillä ja asioilla on pysyvät sisäiset UUID:t sekä taulukko ulkoisista tunnisteista (esim. eduskunnan henkilönumero). Näin tulevat moduulit voivat liittää omat tietonsa samaan henkilöön.
4. Yhteiset palvelut ytimestä: haku, tekoäly, vienti, työjono, audit-loki ja oikeudet. Moduulit rekisteröivät niihin omat sisältötyyppinsä, jolloin esimerkiksi yleishaku ja vienti toimivat automaattisesti kaikille moduuleille.

Kirjoita docs/MODULES.md: ohje uuden moduulin lisäämiseen sekä komento `pnpm new-module <numero> <nimi>`, joka luo valmiin moduulipohjan.

### Siirrettävyys omaan ympäristöön

Ohjelma toimii nyt GitHubissa ja Supabasessa, mutta se on voitava siirtää myöhemmin omalle palvelimelle tai webhotelliin ilman koodin uudelleenkirjoittamista. Pääkäyttöliittymä on aina web-pohjainen. Siirtoa ei toteuteta nyt, mutta jokainen ratkaisu tehdään sen sallivaksi:

- Palvelinlogiikka on alustariippumatonta. Kaikki rajapinnat kirjoitetaan yhdeksi TypeScript-API:ksi Hono-kehyksellä, joka toimii sellaisenaan Supabase Edge Functionissa (Deno), Node.js-palvelimella, Bunissa ja Docker-kontissa. Supabase-kohtaista koodia ei kirjoiteta moduuleihin.
- Sovittimet (adapterit) kaikelle alustaan sidotulle: kirjautuminen, tiedostojen tallennus (Supabase Storage / paikallinen levy / S3), taustatöiden ajaja (GitHub Actions / cron / Docker-työ), reaaliaikaiset ilmoitukset ja sähköposti. Vaihto tehdään asetuksella, ei moduulikoodiin koskemalla.
- Tietokanta on tavallinen PostgreSQL. Vain standardiominaisuuksia ja yleisiä laajennuksia (pgvector, pg_trgm). Migraatiot ajetaan samoilla komennoilla missä tahansa.
- Taustatyöt ovat komentoja, esim. `pnpm job run sync:mps`. GitHub Actions vain kutsuu niitä; omalla palvelimella sama komento ajetaan cronilla.
- Kaikki asetukset ympäristömuuttujina: osoitteet, polut (basePath), avaimet ja palveluvalinnat. Ei kovakoodattuja GitHub- tai Supabase-osoitteita.
- Valmis siirtopohja: deploy/docker-compose.selfhost.yml (käyttöliittymä nginx- tai Caddy-palvelimella, API, taustatyöt, PostgreSQL + pgvector) sekä varmuuskopio- ja palautusskriptit (pg_dump). Dokumentoi siirto tiedostoon docs/DEPLOYMENT.md kolmelle kohteelle: GitHub + Supabase (nyt), oma palvelin tai VPS Dockerilla, webhotelli.
- Webhotelli: staattinen käyttöliittymä toimii missä tahansa webhotellissa. API ja tietokanta vaativat palvelun, joka tukee Node.js:ää tai Dockeria sekä PostgreSQL:ää; pelkkä PHP + MySQL -webhotelli ei riitä. Kirjaa tämä DEPLOYMENT.md-tiedostoon.

### Tulevat asiakassovellukset (API ensin)

Myöhemmin ohjelmaan voidaan liittää erilliset hallintasovellukset Windowsille, Linuxille, macOS:lle, Androidille ja iOS:lle. Niitä ei kehitetä nyt, mutta jokainen moduuli rakennetaan niin, että ne voidaan lisätä ilman muutoksia moduuleihin:

- Yksi rajapinta kaikille asiakkaille. Web-käyttöliittymä käyttää samaa versioitua REST-API:a (/api/v1/...) kuin tulevat sovellukset. Liiketoimintalogiikkaa ei kirjoiteta käyttöliittymään eikä suoria tietokantakyselyitä selaimesta tehdä.
- Rajapintakuvaus generoidaan automaattisesti (OpenAPI) ja siitä tyypitetty asiakaskirjasto packages/sdk, jota web-käyttöliittymä käyttää ja jota tulevat sovellukset (esim. React Native, Tauri) voivat käyttää sellaisenaan.
- Kirjautuminen standardein (OAuth 2 / OIDC, JWT, PKCE), jolloin mobiili- ja työpöytäsovellukset voivat kirjautua samoilla tunnuksilla.
- Muutosten haku: jokainen listarajapinta tukee hakua updated_since-parametrilla ja poistojen merkintää (soft delete), jotta tulevat sovellukset voivat synkronoida ja toimia myös offline-tilassa.
- Tiedostot ja viennit palautetaan rajapinnasta latauslinkkeinä, ja tapahtumat (esim. "analyysi valmis") ovat tilattavissa rajapinnan kautta.
- Jokaisen moduulin vaatimus: kaikki moduulin toiminnot (haku, luonti, muokkaus, tuonti, vienti, analyysi) ovat käytettävissä API:n kautta ja kuvattu OpenAPI-kuvauksessa. Lisää tämä new-module-pohjaan ja MODULES.md-tiedoston tarkistuslistaan.

## 4. Ydin ja moduuli 0.001 Perusrekisterit

Ydin tarjoaa yhteiset palvelut kaikille moduuleille, ja perusrekisterit sisältävät tiedot, joihin useat moduulit viittaavat. Molemmat toteutetaan ennen moduulia 1.001.

### 0.001 Perusrekisterit

- Puoluerekisteri: nimi suomeksi ja ruotsiksi, lyhenne, virallinen nimi, puoluerekisteriin merkitsemis- ja poistopäivä, eduskuntaryhmän nimi, tunnusväri (käytetään koko UI:ssa), logo (lisätään käsin), kotisivu, puheenjohtaja (viittaus henkilöön), edeltäjä- ja seuraajapuolueet sekä tila (aktiivinen/lakkautettu). Täytä alkudata eduskunnan datasta ja oikeusministeriön puoluerekisterin tiedoista. Puolueita voi lisätä ja muokata käsin.
- Vaalipiirit: nimi, tunnus, voimassaoloaika (vaalipiirijako on muuttunut historiassa).
- Vaalikaudet: esim. "2023–2027", alku- ja loppupäivä, hallitukset kausittain.
- Hallitukset: nimi (esim. Orpon hallitus), alku- ja loppupäivä, hallituspuolueet.
- Valiokunnat ja toimielimet: nimi, lyhenne, tyyppi, voimassaolo.
- Luottamustoimien tyypit: kansanedustaja, kunnanvaltuutettu, aluevaltuutettu, ministeri, presidentti, MEP sekä käyttäjän lisäämät tyypit (taso: kunta / alue / valtio / EU / puolue / muu).

### Ytimen yhteiset palvelut

- Tietokanta: jaettu yhteys, migraatiot moduuleittain, created_at / updated_at / created_by / updated_by jokaisessa taulussa.
- Alkuperä ja muutoshistoria: jokaisella tiedolla lähde (eduskunnan avoin data / käsin lisätty / muu lähde), noutoaika ja lähde-URL. Kaikista muutoksista audit-loki (kuka, mitä, milloin, vanha ja uusi arvo).
- Näkyvyystaso jokaisella tietueella: public / internal / private. Nyt kaikki on suljetun ympäristön takana, mutta taso tallennetaan alusta asti, jotta avaaminen myöhemmin onnistuu ilman uudelleenrakennusta.
- Synkronointikehys: moduulit rekisteröivät synkronointityönsä. Kehys hoitaa ajastuksen, inkrementaalisen haun (vain muuttuneet), sivutuksen, uudelleenyritykset, nopeusrajoituksen, idempotentit upsertit sekä ajolokin (alku, loppu, rivimäärät, virheet). Ylläpitosivulla näkyy jokaisen lähteen tila ja "Päivitä nyt" -painike.
- Hakupalvelu: PostgreSQL:n tekstihaku suomen kielen sanakirjalla (finnish), ruotsinkieliselle tekstille swedish, sekä pgvector-semanttinen haku. Moduulit rekisteröivät hakukelpoiset sisältönsä yleishakuun.
- Tekoälypalvelu: yksi palvelinpuolen rajapinta kaikille tekoälykutsuille, joten API-avaimet pysyvät palvelimella. Käytettävä tekoälypalvelu valitaan asetuksista (ks. Vaihdettava tekoäly). Pitkät aineistot käsitellään automaattisesti osissa (map–reduce), tulokset välimuistitetaan, ja token- ja kustannuskäyttö kirjataan. Kaikki promptit versioidaan tiedostoina.
- Vientipalvelu: TXT, Markdown, PDF, DOCX, CSV, JSON ja ZIP-paketti useasta tiedostosta. Jokaisessa viedyssä tiedostossa on lähdetiedot ja vientiaika. Pienet viennit tehdään suoraan selaimessa, suuret Edge Functionissa tai Actions-työssä, ja valmis tiedosto haetaan Supabase Storagesta.
- Työjono: pitkät tehtävät (tuonnit, analyysit, suuret viennit) tallennetaan tietokannan jonoon. Lyhyet ajetaan Edge Functionissa; Edge Functionin aikarajan ylittävät ajot suoritetaan GitHub Actionsissa. Edistyminen näkyy käyttöliittymässä reaaliaikaisesti (Supabase Realtime) ilman sivun päivittämistä.
- Asetukset ja ilmoitukset: moduulikohtaiset asetukset ja sovelluksen sisäiset ilmoitukset (esim. "analyysi valmis").

### Vaihdettava tekoäly

Ohjelman käyttämä tekoäly valitaan asetuksista, eikä mikään moduuli ole sidottu tiettyyn palveluun. Oletuksena käytetään Anthropic Claudea, mutta tilalle voi vaihtaa esimerkiksi OpenAI:n (ChatGPT-mallit), muun pilvipalvelun tai palvelinympäristön sisäisen mallin ilman koodimuutoksia.

- Yksi yhteinen rajapinta (packages/core/ai): moduulit kutsuvat vain toimintoja kuten ai.complete(), ai.analyze() ja ai.embed(), eivät koskaan suoraan minkään palvelun kirjastoa.
- Palveluliitännät (provider-sovittimet): toteuta nyt Anthropic, OpenAI sekä yleinen OpenAI-yhteensopiva liitäntä, jolla toimivat myös omalla palvelimella ajettavat mallit (esim. Ollama, vLLM, LM Studio) ja monet muut palvelut. Rakenne sallii myöhemmin lisätä esim. Google Geminin, Mistralin tai Azure OpenAI:n yhdellä uudella sovittimella.
- Asetukset ylläpitäjälle: palvelu, malli, palvelun osoite (sisäiselle mallille), API-avain, enimmäispituudet ja lämpötila. "Testaa yhteys" -painike kokeilee asetukset heti. API-avaimet tallennetaan salattuina palvelinpuolelle, eikä niitä näytetä käyttöliittymässä tallennuksen jälkeen.
- Tehtäväkohtainen valinta: eri tehtäville voi valita eri mallin (esim. raskas malli analyyseihin, kevyt ja edullinen luokitteluun ja tiivistelmiin). Lisäksi varapalvelu, jota käytetään, jos ensisijainen ei vastaa.
- Mallin ominaisuudet huomioidaan: sovitin kertoo mallin kontekstin pituuden ja tuetut ominaisuudet, ja pitkien aineistojen osiin pilkkominen mukautuu niihin automaattisesti. Promptit kirjoitetaan palveluneutraaleiksi.
- Upotemalli valitaan erikseen. Jokaisen upotteen yhteyteen tallennetaan malli ja ulottuvuus. Kun upotemalli vaihdetaan, ohjelma laskee upotteet uudelleen taustatyönä ja semanttinen haku käyttää vanhoja siihen asti.
- Tietosuoja-asetus: ylläpitäjä voi määrätä, että ei-julkista tietoa (esim. muistiinpanot, private-tason kentät) lähetetään vain sisäiselle mallille. Sisäistä mallia käytettäessä mikään tieto ei poistu omasta ympäristöstä.
- Seuranta: jokaisesta kutsusta kirjataan palvelu, malli, tokenit, kesto ja arvioitu kustannus, ja käyttö näkyy ylläpitosivulla palveluittain.

### Vaihdettavat palvelut

Kaikki ohjelman ja moduulien käyttämät palvelut ovat vaihdettavissa asetuksista, jotta ohjelma ei ole riippuvainen yhdestäkään palveluntarjoajasta. Jos palvelu lopetetaan, kallistuu tai muuttuu, se korvataan toisella ilman muutoksia moduulien koodiin. Tekoäly (yllä) on yksi esimerkki tästä periaatteesta.

| Palvelu | Oletus nyt | Vaihtoehdot, joihin rakenne varautuu |
| --- | --- | --- |
| Tietokanta | Supabase PostgreSQL | Mikä tahansa PostgreSQL (Neon, AWS RDS, Azure, Hetzner, oma palvelin) |
| Kirjautuminen | Supabase Auth | Oma Supabase, Keycloak, Auth.js, Microsoft Entra ID, Google ja muut OIDC-palvelut |
| Tiedostojen tallennus | Supabase Storage | S3-yhteensopiva (AWS, Cloudflare R2, MinIO), paikallinen levy |
| Sähköposti | Supabase Auth -sähköpostit | SMTP, Resend, SendGrid, Postmark |
| Reaaliaikaiset ilmoitukset | Supabase Realtime | Server-Sent Events, WebSocket, kysely (polling) |
| Taustatöiden ajo | GitHub Actions | cron, Docker-työ, systemd-ajastin |
| Käyttöliittymän julkaisu | GitHub Pages | Mikä tahansa staattinen palvelin, webhotelli, nginx, Caddy |
| API:n ajoympäristö | Supabase Edge Functions | Node.js, Bun, Docker |
| Tekoäly ja upotteet | Anthropic Claude | OpenAI, OpenAI-yhteensopivat ja sisäiset mallit |
| Tietolähteet | Eduskunnan avoin data | Muuttunut osoite tai versio, korvaava tai lisälähde |

- Palvelurekisteri ytimessä: jokaiselle palvelutyypille on yksi rajapinta ja sovittimet eri tarjoajille. Moduulit pyytävät palvelun rekisteriltä (esim. services.storage, services.mail) eivätkä koskaan käytä tarjoajan kirjastoa suoraan.
- Jokainen moduuli ilmoittaa manifestissaan käyttämänsä palvelut ja tietolähteet, jolloin ylläpitäjä näkee, mihin palvelun vaihto vaikuttaa.
- Asetussivu "Palvelut": jokaisen palvelun nykyinen tarjoaja, tila, viimeisin onnistunut yhteys ja "Testaa yhteys" -painike. Vaihto tehdään asetuksista; salaiset avaimet tallennetaan salattuina.
- Tietokannan ja kirjautumisen asetukset ovat poikkeus, koska ohjelma tarvitsee ne käynnistyäkseen: ne annetaan ympäristömuuttujina tai asetustiedostossa, ja vaihto dokumentoidaan vaiheittaisena ohjeena. Tietokantavaatimus on PostgreSQL; siirto toiseen tietokantatyyppiin (esim. MySQL) ei kuulu tavoitteisiin, koska haku ja upotteet perustuvat PostgreSQL:n ominaisuuksiin.
- Tietolähteiden sovittimet: jokaisella ulkoisella tietolähteellä on oma sovitin, jonka osoite, versio ja nopeusrajoitukset ovat asetuksia. Jos lähteen rakenne muuttuu, vain sovitin päivitetään. Sama tieto voidaan hakea useammasta lähteestä, ja lähteelle voi asettaa varalähteen.
- Valvonta: ohjelma tarkistaa palveluiden toiminnan säännöllisesti ja ilmoittaa ylläpitäjälle, jos palvelu ei vastaa, synkronointi epäonnistuu toistuvasti tai rajapinta palauttaa vanhentumisvaroituksen.
- Poistumissuunnitelma: kaikki tieto on vietävissä tarjoajasta riippumattomassa muodossa (PostgreSQL-vedos, JSON-vienti kaikesta tiedosta ja tiedostoista). Siirtotyökalu kopioi tiedostot tallennuspalvelusta toiseen, ja käyttäjät viedään kirjautumispalvelusta toiseen. Kirjautuminen sähköpostilinkillä tai OIDC:llä tarkoittaa, ettei salasanoja tarvitse siirtää.
- Dokumentointi: docs/SERVICES.md listaa jokaisen palvelun, nykyisen tarjoajan, vaihtoehdot ja vaihto-ohjeen.

### Varmuuskopiointi

Varmuuskopiointi on ytimen palvelu, johon jokainen moduuli osallistuu. Tavoite on, ettei mitään käsin syötettyä tai rahalla tuotettua tietoa voi menettää, vaikka palveluntarjoaja lopettaisi, tietokanta vioittuisi tai joku poistaisi tietoa vahingossa.

- Automaattinen ajastus: täysi varmuuskopio tietokannasta (pg_dump) ja tiedostoista kerran vuorokaudessa taustatyönä. Säilytys asetettavissa, oletuksena 7 päivittäistä, 4 viikoittaista ja 12 kuukausittaista kopiota.
- Kopio toiseen paikkaan: vähintään yksi kopio säilytetään eri palveluntarjoajalla kuin tuotantotietokanta (3-2-1-periaate). Varmuuskopioiden kohde on vaihdettava palvelu (S3-yhteensopiva tallennus, toinen pilvi, oma palvelin) ja näkyy Palvelut-sivulla.
- Salaus: varmuuskopiot salataan ennen siirtoa, ja salausavain säilytetään erillään kopioista. Varmuuskopioita ei koskaan tallenneta Git-repositorioon.
- Asetukset mukaan: ohjelman ja moduulien asetukset varmuuskopioidaan; salaiset avaimet vain salattuina ja erikseen palautettavina.
- Moduulikohtaisuus: jokainen moduuli ilmoittaa manifestissaan varmuuskopiointitietonsa: mitkä taulut ja tiedostot ovat korvaamattomia (käsin syötetyt tiedot, muokkaukset, analyysit) ja mitkä uudelleen tuotettavia (esim. upotteet, hakuindeksit). Korvaamattomat kopioidaan aina; uudelleen tuotettavat voidaan jättää pois kopion koon pienentämiseksi.
- Moduulin palautus erikseen: yksittäisen moduulin tiedot voi viedä ja palauttaa tarjoajasta riippumattomassa JSON-muodossa, jossa on skeeman versio. Palautus toimii myös uudempaan ohjelmaversioon (moduuli muuntaa vanhan version tiedot).
- Automaattinen kopio ennen riskiä: ennen jokaista tietokantamigraatiota, suurta tuontia, henkilöiden yhdistämistä ja massamuokkausta otetaan automaattisesti tilannekuva kyseisistä tiedoista.
- Yksittäisten tietojen palautus: poistot ovat pehmeitä (roskakori 30 päivää), ja audit-lokin avulla minkä tahansa tietueen voi palauttaa aiempaan versioon yhdellä klikkauksella.
- Palautustesti: taustatyö palauttaa kerran kuukaudessa uusimman varmuuskopion väliaikaiseen tietokantaan ja tarkistaa sen eheyden. Epäonnistuminen ilmoitetaan ylläpitäjälle.
- Varmuuskopiot-sivu: lista kopioista ja niiden tila, "Varmuuskopioi nyt", lataus sekä palautus koko järjestelmälle tai yhdelle moduulille. Palautus on ainoa toiminto, joka vaatii erillisen vahvistuksen, koska se korvaa nykyiset tiedot.
- Dokumentointi: docs/BACKUP.md kuvaa varmuuskopioinnin, säilytyksen ja palautuksen vaihe vaiheelta myös tilanteessa, jossa ohjelma itse ei käynnisty.

## 5. Moduuli 1.001 Kansanedustajat (henkilörekisteri)

Moduuli 1.001 on koko ohjelman henkilörekisteri: kaikki tulevat moduulit liittävät tietonsa sen henkilöihin. Vaikka moduulin nimi on Kansanedustajat, rekisteriin voi tallentaa kenet tahansa poliitikon (esim. kunnanvaltuutetut, MEPit), ei vain kansanedustajia.

### Henkilön tiedot

- Perustiedot: etunimet, sukunimi, kutsumanimi, syntymävuosi, kotikunta, ammatti, koulutus, kuva (eduskunnan kuva, jos saatavilla), lyhyt esittely.
- Puolue: valitaan puoluerekisteristä. Tallenna puoluehistoria aikaväleineen (puolueen tai eduskuntaryhmän vaihdokset), jotta vanhojen puheiden kohdalla näkyy puolue puhehetkellä.
- Vaalipiiri ja vaalikaudet: historia aikaväleineen.
- Luottamustoimet: valmiit tyypit kansanedustaja, kunnanvaltuutettu, aluevaltuutettu, ministeri, presidentti ja MEP sekä rajaton määrä lisättäviä rivejä muille luottamustoimille. Jokaisella rivillä: tyyppi, nimike, organisaatio (esim. kunta, hyvinvointialue, ministeriö, hallitus, säätiö), taso, rooli (jäsen / varajäsen / puheenjohtaja / varapuheenjohtaja), alku- ja loppupäivä, lähde ja lisätiedot. Lisää rivi -painike lisää uuden rivin heti ilman dialogia.
- Valiokuntajäsenyydet ja eduskunnan muut tehtävät eduskunnan datasta.
- Yhteystiedot: useita sähköposteja, puhelinnumeroita ja osoitteita, jokaisella tyyppi (virka / vaalipiiri / muu) ja näkyvyystaso.
- Verkko: oma kotisivu, muut www-sivut sekä some-tilit (X, Bluesky, Facebook, Instagram, LinkedIn, TikTok, YouTube, Threads, Mastodon, muu).
- Sidonnaisuudet: eduskunnan sidonnaisuusilmoitukset, jos ne ovat saatavilla avoimessa datassa.
- Muut lisätiedot: vapaa muistiinpanokenttä, tunnisteet (tagit) ja vapaasti määriteltävät lisäkentät.
- Ulkoiset tunnisteet: eduskunnan henkilönumero sekä tila myöhemmille tunnisteille (esim. Wikidata, vaalikone).

### Tiedonhaku eduskunnan avoimesta datasta

- Lähde: eduskunnan avoimen datan rajapinta (avoindata.eduskunta.fi). Selvitä ensin taulut, joista kansanedustajien tiedot saadaan (mm. kansanedustajataulu ja sen henkilökohtainen XML-sisältö sekä istumajärjestys/edustajakaudet) ja dokumentoi ne tiedostoon docs/DATA-SOURCES.md.
- Valittava tuonti. Käyttäjä valitsee, keitä kansanedustajia tuodaan. Tuontitavat:
  - Kaikki: kaikki saatavilla olevat nykyiset ja entiset kansanedustajat.
  - Aikaväli: edustajat, joiden edustajakausi osuu valitulle päivämäärävälille (alku- ja loppupäivä). Pikavalinnat vaalikausittain (esim. 2019–2023) ja "nykyinen eduskunta".
  - Yksittäinen edustaja nimellä: nimikenttä ehdottaa edustajia kirjoittaessa (myös osittaisella nimellä ja entiset edustajat); useita nimiä voi valita kerralla.
  - Puolue: kaikki valitun puolueen tai eduskuntaryhmän edustajat. Puolue valitaan puoluerekisteristä, ja lisävalinnalla rajataan nykyisiin jäseniin tai kaikkiin joskus puolueeseen kuuluneisiin.
- Puolue- ja nimituonnin voi yhdistää aikaväliin (esim. "Keskustan edustajat 2015–2019").
- Tuontinäkymä on yksi selkeä lomake. Ennen tuontia näytetään automaattisesti esikatselu: montako edustajaa löytyi ja kuka. Tuonti käynnistyy yhdellä painikkeella ja etenee taustatyönä edistymispalkin kanssa.
- Sama toiminto on käytettävissä moduulin rajapinnassa ja komentorivillä, esim. `pnpm sync:mps --all`, `pnpm sync:mps --from 2019-04-17 --to 2023-04-04`, `pnpm sync:mps --name "Sanna Marin"`, `pnpm sync:mps --party KESK --from 2015-01-01`.
- Jokainen tuontiajo tallennetaan lokiin valintoineen, ja sen voi toistaa yhdellä klikkauksella. Jo tuotuja edustajia ei luoda uudelleen, vaan heidän tietonsa päivitetään.
- Oletukset: `pnpm setup` ja ensimmäinen käynnistys tuovat vain nykyisen eduskunnan edustajat; entiset edustajat tuodaan tarvittaessa tuontinäkymästä. Ajastettu synkronointi päivittää jo tuodut edustajat ja lisää uudet nykyiset edustajat; tämä on muutettavissa asetuksista.
- Synkronointi päivittää vain avoimesta datasta tulevat kentät. Käsin lisätyt tai muokatut kentät eivät koskaan ylikirjoitu. Jos avoin data muuttuu käsin muokatussa kentässä, näytä ero ja anna valita yhdellä klikkauksella.
- Kentissä näkyy pieni merkki, mistä tieto on peräisin (avoin data / käsin).
- Varaudu kaksoiskappaleisiin: tunnista mahdolliset saman henkilön tietueet ja tarjoa yhdistäminen.

### Näkymät

- Henkilölista: nopea haku nimellä, suodattimet (puolue, vaalipiiri, vaalikausi, nykyinen/entinen, luottamustoimi, tunniste), lajittelu, taulukko- ja korttinäkymä, puolueväri tunnisteena.
- Henkilösivu: profiiliyläosa (kuva, nimi, puolue, vaalipiiri, nykyiset tehtävät), välilehdet Perustiedot, Luottamustoimet, Yhteystiedot, Historia sekä muiden moduulien tuomat välilehdet (esim. Puheet moduulista 1.002). Aikajana tehtävistä ja puoluehistoriasta.
- Muokkaus suoraan sivulla (inline): ei erillistä muokkaustilaa, tallennus automaattisesti, kumoa-mahdollisuus.
- Puoluesivu: puolueen tiedot, nykyiset ja entiset edustajat.
- Kojelautakortti: edustajien määrä puolueittain ja viimeisimmät muutokset.
- Vienti: henkilölista CSV-, XLSX- ja PDF-muotoon.

### Moduulin julkaisemat tapahtumat

person.created, person.updated, person.party_changed, person.merged, position.added, position.ended.

### Rajapinta

Kaikki moduulin toiminnot (henkilöiden haku ja suodatus, luonti, muokkaus, luottamustoimet, yhdistäminen, tuonti kaikilla neljällä tavalla ja vienti) ovat käytettävissä REST-rajapinnassa /api/v1/mps/... ja kuvattu OpenAPI-kuvauksessa, jotta tulevat sovellukset voivat käyttää niitä.

### Varmuuskopiointi

- Korvaamattomat tiedot: käsin lisätyt ja muokatut henkilötiedot, luottamustoimet, yhteystiedot, muistiinpanot, tunnisteet, lisäkentät, yhdistämishistoria sekä käsin lisätyt kuvat ja logot.
- Uudelleen tuotettavat: eduskunnan avoimesta datasta tuodut perustiedot. Ne varmuuskopioidaan silti, koska lähde voi muuttua tai poistua.
- Ennen henkilöiden yhdistämistä ja tuontia otetaan automaattisesti tilannekuva kyseisistä henkilöistä, ja yhdistämisen voi perua.

## 6. Moduuli 1.002 Kansanedustajien puheet

Moduuli 1.002 tuo kaikki saatavilla olevat täysistuntojen puheenvuorot tietokantaan, tekee niistä yhdisteltävästi haettavia, vie ne tiedostoiksi ja analysoi niitä tekoälyllä. Puhujat linkitetään aina moduulin 1.001 henkilöihin.

### Tiedonhaku

- Lähde: eduskunnan avoin data. Selvitä, mistä tauluista saadaan puheenvuorojen metatiedot (istunnot, asiakohdat, puheenvuorot) ja mistä puheiden koko teksti (täysistuntojen pöytäkirjat asiakirja-aineistossa). Dokumentoi tulos DATA-SOURCES.md-tiedostoon.
- Tuo koko saatavilla oleva historia ensimmäisellä ajolla taustatyönä, edistymispalkin kanssa. Sen jälkeen päivitys on inkrementaalinen.
- Jos puhujaa ei löydy henkilörekisteristä, luo henkilö automaattisesti moduulin 1.001 rajapinnan kautta (ei suoraan tauluun).

### Tallennettavat tiedot puheenvuorosta

- Puhuja (viittaus henkilöön) sekä puolue, eduskuntaryhmä ja vaalipiiri puhehetkellä.
- Puhujan rooli puhehetkellä (kansanedustaja, ministeri, puhemies, varapuhemies).
- Päivämäärä, alku- ja loppukellonaika, kesto, istunnon numero, vaalikausi, valtiopäivät.
- Asiakohta ja sen otsikko, asian tunnus (esim. HE 123/2025 vp, KAA, VK, LA, KK), asiakirjan tyyppi ja käsittelyvaihe.
- Lakiehdotuksen tai asian nimi sekä asiaa käsitellyt valiokunta ja mietinnön tunnus.
- Puheenvuoron tyyppi (esittelypuheenvuoro, ryhmäpuheenvuoro, varsinainen puheenvuoro, vastauspuheenvuoro, kyselytunti, välikysymys, ajankohtaiskeskustelu).
- Kieli (suomi / ruotsi), koko teksti, sanamäärä.
- Linkit alkuperäiseen pöytäkirjaan ja täysistunnon videotallenteeseen, jos saatavilla.
- Automaattisesti lasketut: tekstihakuindeksi, semanttinen upote, aiheluokitus (tekoäly, ajetaan taustalla).

### Haku

Hakuun yhdistetään vapaasti mitkä tahansa seuraavista ehdoista:

- Edustaja: nimellä, puolueella, vaalipiirillä; nykyiset ja entiset; yksi tai useampi.
- Aika: kaikki puheet, päivämääräväli, vaalikausi, hallituskausi tai pikavalinnat (viimeinen viikko / kuukausi / vuosi).
- Asia: eduskunnan asianumero, lakiehdotuksen nimi, asiakirjatyyppi, valiokunta (asian käsitellyt valiokunta).
- Teksti: hakusana, tarkka fraasi, JA / TAI / EI -ehdot, suomen kielen taivutusmuodot (esim. vero löytää verotuksen ja veroja) sekä semanttinen haku ("puheet, joissa vastustetaan sote-leikkauksia").
- Muut: puheenvuoron tyyppi, kieli, puhujan rooli.

Hakutuloksissa osumat korostetaan, tulokset voi lajitella (uusin, vanhin, osuvin), ja yhteenvetopaneeli näyttää osumat ajan, puolueen ja edustajan mukaan kaavioina. Haut voi tallentaa ja jakaa linkkinä (hakuehdot URL-osoitteessa). Hakuvahdit ovat myöhempi lisäys, mutta varaa niille rakenne.

### Vienti

- Yksi puhe, valitut puheet tai koko hakutulos.
- Muodot: TXT, Markdown, PDF (tyylikäs taitto: kansilehti, hakuehdot, sisällysluettelo, puheet metatietoineen), DOCX, CSV ja JSON. Suuret viennit ZIP-pakettina taustatyönä.
- Jokaisessa viennissä lähdetiedot: puhuja, päivämäärä, asia ja linkki alkuperäiseen pöytäkirjaan.

### Tekoälyanalyysi

- Valitse yksi tai useampi edustaja (tai kokonainen puolue), rajaa puheet millä tahansa hakuehdoilla (aika, aihe, asia, hakusana) ja valitse analyysityyppi. Rajaus käyttää samaa hakukomponenttia kuin haku, joten hausta pääsee analyysiin yhdellä klikkauksella.
- Valmiit analyysityypit:
  - Tiivistelmä edustajan kannoista valitusta aiheesta
  - Edustajien vertailu: missä samaa mieltä, missä eri mieltä
  - Kantojen johdonmukaisuus ja muutokset ajan kuluessa
  - Keskeiset teemat ja niiden painottuminen
  - Retoriikka, sävy ja argumentointityyli
  - Lupaukset ja konkreettiset ehdotukset
  - Vapaa kysymys aineistolle (keskustelunomainen jatkokysely)
- Jokainen väite viittaa lähdepuheeseen: tuloksessa on klikattavat viitteet puheisiin. Analyysi perustuu vain valittuihin puheisiin.
- Puolueettomuus: järjestelmäprompti ohjeistaa tekoälyn olemaan poliittisesti neutraali, erottamaan tosiasiat tulkinnoista ja kertomaan, jos aineisto on liian suppea johtopäätöksiin.
- Suuri aineisto käsitellään automaattisesti osissa. Ennen erittäin suurta ajoa näytetään arvio puheiden määrästä ja kustannuksesta (ei muuten vahvistusdialogeja).
- Analyysit tallennetaan tietokantaan (hakuehdot, mukana olleet puheet, tekoälypalvelu ja malli, promptin versio, tulos, aikaleima), niitä voi selata myöhemmin ja ne voi viedä PDF-, DOCX- ja Markdown-muotoon.

### Integraatio muihin moduuleihin

- Henkilösivulle (1.001) Puheet-välilehti: määrät, aikajana, yleisimmät aiheet ja viimeisimmät puheet.
- Puhe- ja analyysisisällöt rekisteröidään yleishakuun ja vientipalveluun.
- Julkaistut tapahtumat: speech.imported, speech.classified, analysis.completed.

### Rajapinta

Kaikki moduulin toiminnot (haku kaikilla ehdoilla, tallennetut haut, vienti ja tekoälyanalyysit tuloksineen) ovat käytettävissä REST-rajapinnassa /api/v1/speeches/... ja kuvattu OpenAPI-kuvauksessa, jotta tulevat sovellukset voivat käyttää niitä.

### Varmuuskopiointi

- Korvaamattomat tiedot: tekoälyanalyysit tuloksineen (niiden uudelleen tuottaminen maksaa ja tulos voi muuttua), tallennetut haut sekä käsin tehdyt korjaukset ja luokitukset.
- Puheiden teksti ja metatiedot varmuuskopioidaan, vaikka ne ovat avointa dataa, koska koko historian uudelleentuonti on hidasta ja lähde voi muuttua.
- Uudelleen tuotettavat: upotteet ja hakuindeksit. Ne jätetään oletuksena pois päivittäisestä kopiosta ja lasketaan palautuksen jälkeen uudelleen taustatyönä (asetettavissa).

## 7. Ulkoasu ja käyttökokemus

Ulkoasu on yhtä tärkeä kuin toiminnallisuus: tavoitteena on tyylikäs, rauhallinen ja nykyaikainen analyysityökalu, joka tuntuu laadukkaalta tuotteelta eikä hallintapaneelipohjalta. Tasovertailuksi sopivat esimerkiksi Linear, Vercel ja Stripe Dashboard.

### Visuaalinen ilme

- Design-järjestelmä paketissa packages/ui: värit, typografia, välistykset, varjot ja pyöristykset design tokeneina. Kaikki moduulit käyttävät vain näitä komponentteja, jolloin ilme pysyy yhtenäisenä moduulien määrän kasvaessa.
- Vaalea ja tumma teema, oletuksena järjestelmän asetus, vaihto yhdellä klikkauksella.
- Typografia: selkeä moderni groteski (esim. Inter tai Geist), numeroille tasalevyiset numerot taulukoissa. Puheiden lukunäkymässä miellyttävä lukufontti ja rivinpituus.
- Värit: hillitty neutraali pohja ja yksi korostusväri. Puolueiden tunnusvärit näkyvät pieninä merkkeinä, väripalkkeina ja kaavioissa, eivät suurina pintoina. Puoluevärien kontrasti tarkistetaan molemmissa teemoissa.
- Hienovaraiset animaatiot (siirtymät, latausluurangot, hover-tilat), ei häiritseviä efektejä.

### Rakenne ja navigointi

- Kokoontaitettava sivupalkki, jonka valikkokohdat tulevat moduulien manifesteista automaattisesti.
- Komentopaletti (Ctrl/⌘ + K): hae mitä tahansa (henkilö, puolue, puhe, asia) ja siirry suoraan. Myös toiminnot (esim. "Uusi analyysi", "Vie haku PDF:ksi").
- Etusivun kojelauta: moduulien kortit (viimeisimmät puheet, aktiivisimmat puhujat, synkronointien tila, viimeisimmät analyysit).
- Murupolku ja selkeä sivuotsikko jokaisella sivulla.

### Vähän klikkauksia

- Haku päivittyy kirjoittaessa, suodattimet näkyvät aina, ei erillistä "Hae"-painiketta.
- Muokkaus suoraan paikallaan ja automaattinen tallennus; ei "Oletko varma?" -dialogeja, vaan kumoa-ilmoitus.
- Järkevät oletusarvot kaikkialla (esim. haku oletuksena nykyinen vaalikausi).
- Pikanäppäimet yleisimpiin toimintoihin.
- Pitkät tehtävät taustalla; käyttäjä voi jatkaa työskentelyä ja saa ilmoituksen, kun tehtävä valmistuu.

### Laatuvaatimukset

- Responsiivinen: toimii puhelimella, tabletilla ja isolla näytöllä.
- Saavutettavuus WCAG 2.1 AA -tasolla (näppäimistökäyttö, kontrastit, ruudunlukijat).
- Suorituskyky: suuret listat virtualisoidaan, haku vastaa alle sekunnissa sadoilla tuhansilla puheilla.
- Tyhjät tilat, virhetilat ja lataustilat suunnitellaan yhtä huolellisesti kuin täydet näkymät.
- Käyttöliittymän tekstit i18n-rakenteessa (suomi nyt; ruotsi ja englanti myöhemmin ilman koodimuutoksia).

## 8. Käyttöoikeudet, tietosuoja ja tuleva avaaminen

Ohjelma on aluksi suljettu, mutta kaikki rakennetaan niin, että käyttäjähallinta ja avoin tiedon julkaisu voidaan lisätä myöhemmin ilman uudelleenrakennusta.

### Nyt (vaihe 0–2)

- Koko sovellus kirjautumisen takana. GitHub Pagesin sivut ovat teknisesti julkisia, mutta ne ovat pelkkä käyttöliittymä: kaikki tieto tulee API:sta, joka palauttaa dataa vain kirjautuneelle sallitulle käyttäjälle. Kirjautuminen Supabase Authilla sähköpostilinkillä; vain sallittujen sähköpostien lista (ALLOWED_EMAILS) pääsee sisään. Ei julkista rekisteröitymistä.
- Ensimmäinen kirjautuja saa automaattisesti ylläpitäjän roolin.
- Rakenna jo nyt oikeusmallin pohja: taulut users, roles, permissions, role_permissions, user_roles. Jokainen moduuli määrittelee manifestissaan omat oikeutensa (esim. mps.read, mps.edit, speeches.export, speeches.analyze). Koodi tarkistaa oikeudet yhden apufunktion kautta jo nyt, vaikka käytössä on vain ylläpitäjä. Row Level Security on lisäksi päällä kaikissa tauluissa alusta asti toisena suojakerroksena: ilman sääntöä taulusta ei näy mitään. Kirjoita automaattitestit, jotka varmistavat, ettei kirjautumaton tai sallittujen listalta puuttuva käyttäjä saa mitään tietoa.
- Valmiit roolit tietokannassa: ylläpitäjä, toimittaja, analyytikko, lukija ja julkinen (ei kirjautunut).

### Myöhemmin (ei toteuteta nyt, mutta varaudu)

- Käyttäjähallintasivu: kutsut, roolit, oikeudet moduuleittain, käyttäjäryhmät.
- Täysin avoimen tiedon hallinta: julkinen näkymä ilman kirjautumista niille tiedoille, joiden näkyvyystaso on public. Ylläpitäjä päättää moduuleittain ja kentittäin, mikä on julkista.
- Julkinen luku-API (REST) avoimelle datalle, nopeusrajoitukset ja API-avaimet.
- Julkisen roolin RLS-säännöt näkyvyystason mukaan. Kirjoita ne valmiiksi mutta pois päältä, jotta avaaminen on yhden asetuksen muutos.

### Tietosuoja (GDPR)

- Poliitikkojen julkiseen rooliin liittyvät tiedot ovat käsiteltävissä, mutta henkilökohtaiset yhteystiedot (esim. kotiosoite, yksityinen puhelinnumero) merkitään oletuksena tasolle private eikä niitä koskaan julkaista automaattisesti.
- Tallennetaan vain tarpeellinen tieto (tietojen minimointi). Kirjoita docs/PRIVACY.md: mitä tietoja käsitellään, millä perusteella ja mistä lähteestä.
- Audit-loki kirjaa tietojen muutokset ja viennit.
- Eduskunnan avoimen datan käyttöehdot ja lähdeviittaukset noudatetaan; lähde näkyy käyttöliittymässä ja vienneissä.

## 9. Toteutusvaiheet ja hyväksymiskriteerit

Toteuta vaiheet 0–2 järjestyksessä yhdellä kertaa, pysähtymättä vaiheiden välillä. Vaihe on valmis vasta, kun kaikki sen kriteerit täyttyvät; tarkista ne itse ja korjaa puutteet ennen siirtymistä eteenpäin.

### Vaihe 0 – Perusta ja ydin

- [ ] Monorepo, TypeScript, lint, formatointi, devcontainer ja Docker Compose (PostgreSQL + pgvector).
- [ ] CLAUDE.md, README.md (suomeksi), docs/DECISIONS.md, docs/MODULES.md, docs/DATA-SOURCES.md, docs/PRIVACY.md.
- [ ] Moduulirekisteri, manifestit, tapahtumaväylä (outbox), synkronointikehys, työjono, haku-, tekoäly- ja vientipalvelut.
- [ ] Kirjautuminen sallittujen sähköpostien listalla, oikeusmallin taulut ja oikeustarkistusfunktio.
- [ ] Design-järjestelmä, sovelluksen runko (sivupalkki, komentopaletti, teemat, kojelauta).
- [ ] Moduuli 0.001 Perusrekisterit alkudatalla (puolueet, vaalipiirit, vaalikaudet, hallitukset, valiokunnat).
- [ ] `pnpm setup` toimii tyhjästä koneesta; GitHub Actions CI on vihreä; sovellus on julkaistu GitHub Pagesiin ja toimii verkossa kirjautumisen kanssa; RLS-testit menevät läpi.
- [ ] Hono-API toimii OpenAPI-kuvauksineen, ja web-käyttöliittymä käyttää sitä vain packages/sdk-kirjaston kautta.
- [ ] Sovittimet (kirjautuminen, tallennus, taustatyöt, ilmoitukset) ovat käytössä, ja deploy/docker-compose.selfhost.yml sekä docs/DEPLOYMENT.md on tehty siirtoa varten.
- [ ] Tekoälypalvelun vaihto asetuksista toimii Anthropic-, OpenAI- ja OpenAI-yhteensopivalla liitännällä (ilman avainta testataan valepalvelulla); "Testaa yhteys" ja käytön seuranta toimivat.
- [ ] Palvelurekisteri ja Palvelut-asetussivu toimivat; jokaiselle palvelutyypille on vähintään oletussovitin ja yksi vaihtoehtoinen sovitin (esim. tallennus: Supabase Storage ja paikallinen levy); docs/SERVICES.md on tehty.
- [ ] Ajastettu salattu varmuuskopiointi, moduulikohtainen vienti ja palautus, roskakori, automaattinen tilannekuva ennen migraatioita sekä kuukausittainen palautustesti toimivat; docs/BACKUP.md on tehty. Uuden moduulin pohja ja MODULES.md-tarkistuslista sisältävät varmuuskopiointitiedot.

### Vaihe 1 – Moduuli 1.001 Kansanedustajat

- [ ] Kansanedustajien tuonti toimii kaikilla neljällä tavalla (kaikki, aikaväli, nimi, puolue) ja niiden yhdistelmillä; edustajat tulevat puoluehistorioineen.
- [ ] Henkilölista, henkilösivu, puoluesivu, inline-muokkaus ja rajaton määrä luottamustoimirivejä toimivat.
- [ ] Uudelleensynkronointi ei ylikirjoita käsin muokattuja kenttiä (testattu automaattitestillä).
- [ ] Ajastettu GitHub Actions -synkronointi toimii.

### Vaihe 2 – Moduuli 1.002 Puheet

- [ ] Koko saatavilla oleva puhehistoria tuotu ja linkitetty henkilöihin; puolue puhehetkellä oikein.
- [ ] Kaikki hakuehdot toimivat erikseen ja yhdistettyinä; suomen kielen taivutushaku ja semanttinen haku toimivat.
- [ ] Vienti TXT-, Markdown-, PDF-, DOCX-, CSV- ja JSON-muotoon toimii yhdelle puheelle ja koko hakutulokselle.
- [ ] Tekoälyanalyysi yhdelle ja usealle edustajalle; jokainen väite viittaa lähdepuheeseen; analyysit tallentuvat ja ovat vietävissä.
- [ ] Puheet-välilehti näkyy henkilösivulla moduulin 1.001 kautta.

### Lopuksi

Kun kaikki vaiheet ovat valmiita, kirjoita käyttäjälle lyhyt suomenkielinen yhteenveto: mitä rakennettiin, miten sovellus käynnistetään, mitkä avaimet on lisättävä ja ehdotukset seuraaviksi moduuleiksi (esim. 1.003 Äänestykset, 1.004 Kirjalliset kysymykset, 1.005 Valiokuntien asiakirjat, 1.006 Hallituksen esitykset, käyttäjähallinta ja julkinen näkymä).

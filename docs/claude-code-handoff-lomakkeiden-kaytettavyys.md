# Claude Code -tehtävä: Syöttölomakkeiden käytettävyys

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `15d5e82`, ei avoimia PR:iä. Tee lyhyt suunnitelma ennen koodausta — tehtävä on rajattu, mutta §1:ssä on yksi kohta jossa on aito riski.

## 0. Tausta

Sovelluksessa on yksi käyttäjä (hallituksen puheenjohtaja), joka syöttää kaiken datan käsin. Lomakkeet ovat rakentuneet oletukselle että sovellus on virallinen järjestelmä, jossa jokainen muutos on perusteltava ja jäljitettävä. **Se oletus ei päde**: sovellus ei ole taloyhtiön virallinen järjestelmä, isännöitsijän raportit ovat viralliset, eikä sovellus ota vastuuta lukujen oikeellisuudesta.

Käyttäjän oma havainto edellisestä sessiosta: *"pitää varmaan tehdä näistä jotkut ohjeet sivuille, koska en itse osaa käyttää tekelettäni ja tiedä mitä tuonne pitäisi oikein kirjoitella"* — ja metatiedoista: *"aika paljon pitää kirjoitella kenttiä että saa jonkun tiedon aina syötettyä; en rehellisesti sanottuna ymmärrä mikä virka sillä on"*.

Tämä PR poistaa kolme kitkakohtaa. **Ei muutoksia laskentaan, tietomalliin eikä näkymien lukuihin.**

## 1. Metatietojen keventäminen

Jokainen tallennus vaatii nyt kaksi kenttää: **Operaation lähdetunnisteet** ja **Muutoksen selitys**. Molemmat pakollisia (`validateOperationMetadata`).

**Päätetty:**

- **Lähdetunniste esitäytetään** entiteetin omasta lähteestä, kuten poistossa jo tehdään (PR #13/#14). Pysyy pakollisena, mutta käyttäjän ei tarvitse kirjoittaa sitä.
- **Selitys muuttuu vapaaehtoiseksi.** Se on kenttä joka jää tyhjäksi tai täytetään merkityksettömästi ("testi", "päivitys"), ja pakollisuus vain hidastaa.

### RISKI, joka on ratkaistava suunnitelmassa

`validateOperationMetadata` vaatii tällä hetkellä ei-tyhjän selityksen, ja sitä kutsutaan **jokaisesta** admin-operaatiosta sekä selaimessa (`adminOperationPayloads.js`) että domainissa (`adminDataValidation.ts`). Löysääminen koskee siis koko operaatiokantaa.

Kaksi asiaa on varmistettava:

1. **Onko olemassa dataa jonka lataus rikkoutuu?** Audit trail sisältää vanhoja rivejä joilla on selitys. Vapaaehtoisuus ei saa tehdä niistä virheellisiä.
2. **Voiko selitys olla `undefined` vai pitääkö sen olla tyhjä merkkijono?** `exactOptionalPropertyTypes: true` on päällä, joten `explanation: undefined` ei ole sama kuin puuttuva avain. Kerro kumpi valitset ja miksi.

Jos löydät kolmannen ongelman, kerro se ennen kuin koodaat.

### Esitäytön lähde per lomake

Kerro suunnitelmassa mistä esitäyttö tulee kussakin. Poistossa se on kohteen oma tunniste; luonnissa entiteetillä ei ole vielä lähdettä. Ehdota mitä uuden entiteetin lomakkeessa esitäytetään — entiteetin oma `sourceIds`-kenttä on luontevin, jos se on täytetty ennen tallennusta.

## 2. Tunnisteiden generointi

Uutta entiteettiä luodessa tunniste kirjoitetaan käsin: `event_iv_puhdistus`, `asset_julkisivu`, `cost_kuntoarvio`.

**Päätetty: generoi otsikosta, salli muokkaus, törmäys ratkaistaan numerolla.**

- Kenttä esitäytetään kun käyttäjä kirjoittaa otsikon/nimen — mutta **vain jos käyttäjä ei ole itse koskenut tunnistekenttään**. Jos hän on muokannut sitä, esitäyttö ei saa ylikirjoittaa.
- Muunnos: pienet kirjaimet, ääkköset → `a`/`o`, välilyönnit ja välimerkit → `_`, peräkkäiset alaviivat yhdeksi, alku- ja loppualaviivat pois. Etuliite entiteettityypin mukaan (`asset_`, `event_`, `cost_`, `obs_` tai vastaava — katso mikä on nykyinen käytäntö).
- **Törmäys:** jos generoitu tunniste on jo käytössä, lisätään numero (`event_kuntoarvio_2`). Hiljainen, ei virheilmoitusta.
- Pituusraja: pitkä otsikko tuottaa pitkän tunnisteen. Ehdota raja ja miten se katkaistaan.

Esimerkkejä nykyisistä tunnisteista, joiden luettavuus halutaan säilyttää: `asset_lammin_vesi_varaajat`, `event_julkisivu_maalaus`, `cost_iv_puhdistus`.

**Rajaus:** vain uuden entiteetin luonti. Olemassa olevien tunnisteita ei muuteta eikä muokkauslomake saa generoida uutta.

## 3. Ohjetekstit lomakkeisiin

**Päätetty: lyhyt teksti kentän alla, aina näkyvissä.** Ei tooltipiä — sovelluksessa ei ole sellaista mekanismia, ja sen rakentaminen olisi oma työnsä. Sama kuvio kuin `maintenancePlanCoverageThroughYear`-kentässä jo on.

**Katettavat lomakkeet (neljä):**

1. Rakennusosa
2. Havainto
3. Korjaustapahtuma (mukaan lukien skenaariorivit)
4. Kustannusnäyttö

Ulkopuolelle jäävät: taloyhtiön perustiedot (osittain selitteet jo olemassa) ja tuontinäkymät (hyvä ohjeteksti ylhäällä).

### Mitä teksteihin

Kentän nimi kertoo *mitä* kenttä on; ohjeteksti kertoo *mitä siihen kirjoitetaan* ja *milloin se jätetään tyhjäksi*. Konkreettisia esimerkkejä kentistä jotka olivat käyttäjälle epäselviä:

| Kenttä | Mitä ohjeen pitäisi kertoa |
|---|---|
| **Yksikkö** | "erä" kun koko työ hinnoitellaan kerralla, "kpl" kun yksikköhinta × määrä |
| **Määrä** | jätetään tyhjäksi kun yksikkö on "erä" |
| **ALV sisältyy** | "Ei tiedossa" on kelvollinen vastaus arvioille; tarjouksessa lukee kumpi |
| **Hintatasovuosi** | minkä vuoden hinnoissa summa on |
| **Voimassa asti** | vain tarjouksille joilla on umpeutumispäivä; arviolla tyhjä |
| **Havaintopäivä** | milloin hintatieto hankittiin |
| **Tila** (kustannusnäyttö) | Tarjous / Arvio / DATA GAP — mitä ero tarkoittaa laskennassa |
| **Summa €** (skenaariorivi) | pakollinen kun kustannusnäyttö ei ole DATA GAP; yksikköhinta × määrä |
| **Linkitetyt havainnot** | mihin sitä käytetään |

Tämä ei ole täydellinen lista — käy lomakkeet läpi ja ehdota tekstit kaikille kentille jotka eivät ole itsestään selviä. **Älä lisää tekstiä kenttään jonka nimi jo riittää** (esim. "Nimi"), koska silloin ohjeet muuttuvat kohinaksi jota ei lueta.

Tekstit suomeksi, yksi lyhyt lause, ei täyttä virkettä jos ranskalainen viiva riittää.

## 4. Rajaus

Ei muutoksia: laskentaan, tietomalliin, näkymien lukuihin, tuonteihin, julkaisuputkeen, likviditeettiin. Ei auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita. Ei bundleria, ei jsdomia, ei tooltip-kirjastoa.

`viewWiring.test.js` tekee staattisen id-ristiintarkistuksen. Jos lisäät elementtejä, se on pidettävä vihreänä — ja huomaa PR #16:n ansa: **ei heksavärejä `app.js`:ään**, koska skanneri lukee `#fff`:n elementtiviittaukseksi.

## 5. Testit

- Metatietovalidointi: selitys puuttuu → hyväksytään; lähdetunniste puuttuu → hylätään. Molemmat sekä selaimessa että domainissa.
- Regressio: vanha data jossa selitys on olemassa latautuu ja validoituu.
- Tunnisteen generointi: ääkköset, välilyönnit, välimerkit, peräkkäiset erikoismerkit, tyhjä otsikko, pituusraja.
- **Törmäys tuottaa numeron** eikä virhettä; toinen törmäys tuottaa seuraavan numeron.
- **Käyttäjän muokkaama tunniste ei ylikirjoitu** kun otsikkoa muutetaan. Tämä on se testi joka estää ärsyttävimmän mahdollisen regression.
- `viewWiring.test.js` vihreä.

## 6. Työskentelytapa

1. Branch **`feature/form-usability`** tuoreesta mainista.
2. **Lyhyt suunnitelma ensin.** Vastaa §1:n riskikysymyksiin ja kerro §3:n ehdotetut tekstit ennen kuin kirjoitat ne koodiin — ne on helpompi korjata listana kuin diffistä.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen: luo yksi jokaista neljää entiteettityyppiä, tallenna ilman selitystä, ja tarkista että tunniste generoituu.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen valmiusilmoitusta. `pkill -f wrangler` ei toimi (tappaa oman komentonsa) — `kill <PID>` ja curl-varmistus.

## 7. Muistutus

`docs/testien-sokeat-pisteet.md`: **jos testi ei kaadu ilman korjausta, se ei testaa korjausta.** Tämä koskee erityisesti §5:n törmäys- ja ylikirjoitustestejä — molemmat on helppo kirjoittaa niin että ne menevät läpi kummallakin tavalla.

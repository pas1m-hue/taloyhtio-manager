# Claude Code -tehtävä: Selvitykset-näkymä

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `b3a22d1`, ei avoimia PR:iä. Tee lyhyt suunnitelma ennen koodausta.

## 0. Mitä ja miksi

Uusi näkymä **Selvitykset** sivupalkin **Kunnossapito**-otsikon alle (Rakennusosat, Havainnot, Korjaustapahtumat, Kustannusnäyttö, **Selvitykset**).

Näkymässä on kolme taulukkoa. Ne ovat **dokumentteja ja referenssitietoa** — ne eivät osallistu mihinkään laskentaan eivätkä vaikuta kassapolkuun, vastiketarpeeseen tai muihin näkymiin.

Tämä erottaa ne muista Kunnossapito-näkymistä: nuo neljä syöttävät dataa laskentaan, tämä ei. Nimi "Selvitykset" on valittu siksi että se kertoo mitä ne ovat (hallituksen selvityksiä yhtiökokoukselle) eikä lupaa laskentaa.

Tausta: käyttäjä on hallituksen puheenjohtaja ja nämä kolme dokumenttia ovat olemassa paperilla. Ne halutaan sovellukseen sen takia että ne ovat samassa paikassa muun kunnossapitotiedon kanssa.

## 1. Kolme taulukkoa

### 1.1 Tehdyt toimenpiteet

Hallituksen kirjallinen selvitys yhtiössä suoritetuista huomattavista kunnossapito- ja muutostöistä.

Kaksi saraketta: **vuosi** ja **toimenpide**. Järjestys vuoden mukaan.

Käyttäjän nykyinen sisältö (yhdeksän riviä, 2012–2025) on valmiina tab-eroteltuna. Huomaa että samalla vuodella voi olla useita rivejä (2025: kaksi).

### 1.2 Kunnossapitotarveselvitys

Asunto-osakeyhtiölain 6 luvun 3 §:n tarkoittama selvitys, josta ilmenee seuraavan viiden vuoden kunnossapitotarve. Yhtiökokous merkitsee sen tiedoksi.

Kaksi saraketta: **toimenpide** ja **tavoiteajankohta**. Tavoiteajankohta on **vapaamuotoista tekstiä** ("kevät 2026") ja **usein tyhjä** — käyttäjän nykyisessä selvityksessä kolmella neljästä toimenpiteestä se on tyhjä. Se on normaalia eikä puuttuvaa dataa.

Taulukon yhteyteen kuuluu otsikkotieto: **selvityksen kausi** (nyt 2026–2030), **hallituksen käsittelypäivä** ja **yhtiökokouksen esittelypäivä**. Ehdota miten ne syötetään — omina kenttinään taulukon ylle on luontevin.

Dokumentissa on myös vakioteksti joka kannattaa olla näkyvissä:

> Tämä kunnossapitotarveselvitys on hallituksen tämän hetken näkemys tulevista korjauksista. Hallitus teettää pienehköjä korjauksia hoitotalouden korjausbudjetin puitteissa. Yhtiökokous tekee päätökset tulevista merkittävistä korjauksista ja niiden rahoituksesta.

**Huom:** samat toimenpiteet ovat jo sovelluksessa korjaustapahtumina. Tämä taulukko on erillinen dokumentti eikä sitä kytketä niihin — ei automaattista synkronointia kumpaankaan suuntaan. Se on tietoinen valinta: dokumentti on hallituksen muotoilema teksti, korjaustapahtumat ovat laskennan syötettä.

### 1.3 Tekninen käyttöikä

Viitteelliset kunnossapitojaksot rakennusosille. Yleistä tietoa, ei yhtiökohtaista.

Kaksi saraketta: **kohde** ja **kunnossapitojakso**. Jakso on tekstiä eikä lukua ("30–50 v", "50 v – rakennuksen ikä", "yli 50 v"), koska se on väli tai ehdollinen.

19 riviä, sisältö valmiina.

Taulukon alle kaksi huomautusta jotka ovat lähdedokumentissa:

> Viemärit voidaan pystyä myös sukittamaan tai pinnoittamaan.
>
> Yllä olevat vuosimäärät ovat suuntaa antavia ja kohteiden todellinen käyttöikä riippuu siitä, miten niitä on vuosikymmenien aikana hoidettu ja huollettu.

Jälkimmäinen on olennainen — se on sama varaus jota sovellus tekee muuallakin, eikä taulukkoa saa esittää ilman sitä.

## 2. Muokkaus: liitä tekstinä

**Päätetty:** kaikki kolme taulukkoa täytetään liittämällä tab-eroteltu teksti, samalla mekanismilla kuin tilidatan tuonti (`Liitä tilidataa`, `Liitä ryhmäbudjetti`, `Liitä ryhmätason toteuma`).

Ei rivikohtaista lomaketta. Perustelu: nämä taulukot täytetään kerran ja muutetaan harvoin — tekninen käyttöikä tuskin koskaan, kaksi muuta kerran vuodessa. Lomake per rivi tarkoittaisi 19 lomakekäyntiä teknisen käyttöiän täyttämiseksi.

**Liitos korvaa taulukon kokonaan**, ei lisää rivejä. Nämä ovat dokumentteja: kun selvitys päivitetään, se korvataan uudella versiolla. Tämä on eri kuin talousdatan tuonti, joka päivittää rivejä avaimen perusteella — kerro suunnitelmassa miten toteutat sen ja miten se näkyy esikatselussa ("korvaa 19 nykyistä riviä").

**Muista viimeisen rivin kummajainen:** selain karsii liitetyn tekstin viimeiseltä riviltä tyhjän loppusarakkeen. Kunnossapitotarveselvityksessä tavoiteajankohta on usein tyhjä, joten tämä osuu siihen suoraan. Kerro miten käsittelet sen — joko jäsennin sietää puuttuvan sarakkeen viimeisellä rivillä, tai esikatselu kertoo ongelmasta selvästi.

Poisto: riittää että liittää tyhjän tai uuden sisällön. Erillistä poistotoimintoa ei tarvita, mutta jos se on kevyt, sen voi lisätä.

## 3. Rajaus

**Vain admin.** Taulukot eivät mene julkaisuun eivätkä näy visitorille. Ei muutoksia `publishedSnapshot.ts`:ään, `contentFingerprint`iin eikä visitor-näkymiin.

Perustelu: visitor-puoli on keskeneräinen muutenkin, ja jos siitä joskus tehdään osakkaiden näkymä, nämä lisätään silloin osana isompaa kokonaisuutta.

**Ei laskentaa.** Taulukot eivät vaikuta kassapolkuun, vastiketarpeeseen, `forecastComplete`-logiikkaan, kunnossapitokatteeseen eikä mihinkään view-modeliin.

Ei auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita (snapshot-arkkitehtuuri). Ei bundleria, ei jsdomia.

**`withDefaultedAdminCollections()`** (`src/database/postgresPublishingRepository.ts`): uudet kokoelmat on oletusarvoistettava `[]`:ksi + regressiotesti, kirjoitettuna niin että se **failaa** jos defaultointi poistetaan. Tämä bugi on kaatanut työtilan latauksen kerran (3A), ja `adminDashboard.ts` on toinen sama ansa (PR #19) — se listaa eksplisiittisesti mitkä kokoelmat kulkevat työtilaan, ja ilman riviä uusi kokoelma olisi `undefined` ilman että mikään huomauttaa.

## 4. Suunnitelmassa vastattava

1. **Yksi kokoelma vai kolme?** Taulukot ovat rakenteeltaan samanlaisia (kaksi tekstisaraketta), joten yksi kokoelma tyyppikentällä olisi mahdollinen. Mutta kunnossapitotarveselvityksellä on otsikkotietoja (kausi, päivämäärät) joita muilla ei ole. Kerro valintasi ja perustelusi.
2. **Miten otsikkotiedot (§1.2) tallennetaan?**
3. **Järjestys.** Tehdyt toimenpiteet järjestetään vuoden mukaan; kaksi muuta säilyttävät liitetyn järjestyksen (tekninen käyttöikä on lähdedokumentissa aihepiireittäin, ei aakkosissa — sitä ei saa järjestää uudelleen).
4. **Metatiedot.** Liitos on admin-operaatio, joten lähdetunniste ja selitys tulevat mukaan. Selitys on nyt vapaaehtoinen (PR #24), lähdetunniste pakollinen — esitäytetäänkö se jostain?

## 5. Testit

- Jäsennin: kaksi saraketta, tyhjä toinen sarake (kunnossapitotarveselvitys), **tyhjä sarake viimeisellä rivillä**, virheelliset rivit rivinumeroin.
- Liitos **korvaa** eikä lisää: taulukossa 19 riviä, liitetään 3 → tuloksena 3.
- `withDefaultedAdminCollections`-regressio, kirjoitettuna niin että se failaa ilman defaultointia.
- `adminDashboard`-läpivienti: uudet kokoelmat päätyvät työtilaan (PR #19:n ansa).
- Julkaisurajan testi: uudet kokoelmat **eivät** muuta `contentFingerprint`ia eivätkä päädy julkaisuun.
- Järjestys säilyy teknisessä käyttöiässä.
- `viewWiring.test.js` vihreä.

## 6. Työskentelytapa

1. Branch **`feature/selvitykset`** tuoreesta mainista.
2. **Lyhyt suunnitelma ensin.** Vastaa §4:n neljään kysymykseen.
3. Committoi handoff ensimmäisenä (tarkista `git status` — handoff voi olla untracked vaikka status näyttäisi puhtaalta). Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen valmiusilmoitusta. `pkill -f wrangler` ei toimi. `kill <PID>` ja curl-varmistus — `--remote` ei lataa `public/`-assetteja uudelleen tiedostomuutoksesta.

## 7. Muistutus

`docs/testien-sokeat-pisteet.md`: **jos testi ei kaadu ilman korjausta, se ei testaa korjausta.** Neljä peräkkäistä tapausta on kirjattu, viimeisin PR #24:n `mode === "create"` joka tyyppitarkistui ja luki oikein muttei suoriutunut kertaakaan.

## 8. Sisällöt valmiina

Käyttäjällä on kaikki kolme taulukkoa valmiina tab-eroteltuna. Niitä ei tarvitse kirjoittaa koodiin eikä fixtureihin — ne liitetään sovellukseen live-testissä.

Testifixtureihin riittää muutama rivi kutakin.

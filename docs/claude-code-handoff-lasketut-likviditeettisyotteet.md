# Claude Code -tehtävä: Tilidata julkaisuputkeen — hoitokate ja 12 kk hoitokulu laskettuina

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `353e8a1`, ei avoimia PR:iä. **Suunnittelupainotteinen tehtävä** — palauta suunnitelma ja odota hyväksyntää. Tämä on isompi kuin edelliset: se koskee tietomallia ja julkaisuputkea.

Tämä tehtävä **korvaa** aiemman `docs/claude-code-handoff-likviditeetin-jakaja.md`:n ja sisältää sen. Poista tai merkitse se vanhentuneeksi osana tätä työtä.

## 0. Kaksi ongelmaa, yksi juurisyy

### Ongelma 1: kassapolun vuosikeräys on menoarvio tulopuolella

`LiquidityBaselineRecord.annualCollection` on **9 680 €/v**, vakiona vuodesta 2026 vuoteen 2057. Se on käsin syötetty seed-datasta, ja se on itse asiassa **Korjaukset-budjetti 2026** — eli arvio siitä paljonko korjauksiin *menee*, ei siitä paljonko rahaa *tulee*.

Sama luku on siis kassapolussa molemmilla puolilla, mutta vain toinen toteutuu. Seuraus: kassa kasvaa 22 208 € → yli 100 000 € horisontin aikana, mikä ei kuvaa taloyhtiötä. Taloyhtiö ei kerää varallisuutta; vastike asetetaan kattamaan kulut.

### Ongelma 2: 12 kk hoitokulu on kahtena eri lukuna

- **Kassa kuukausina -tunnusluku** (admin) laskee sen tilidatasta: **37 567,84 €**
- **Puskuritavoite ja kassapolku** lukevat käsin syötettyä `trailing12mOperatingCosts`ia: **34 029,46 €**

Visitor-puolella näkyy jälkimmäinen, ja se on ruudulla nähtävissä ("12 kk hoitokulut 34 029,46 €" likviditeetin oletuksissa).

### Juurisyy on sama

Molemmat luvut ovat laskettavissa tilidatasta, mutta **julkaistu snapshot ei sisällä tilidataa lainkaan**. `PublishedDataSnapshot` jättää `financialAccounts`, `financialEntries`, `groupBudgets` ja `groupActuals` pois, ja `publishedSnapshot.ts` rakentaa synteettisen adminin jossa ne ovat tyhjiä taulukoita.

Likviditeettimalli rakennetaan sekä adminille että visitorille samasta `CalculationSnapshot`-komposiitista, joten "laske vain adminille" tarkoittaisi että admin ja visitor näyttävät eri puskuritavoitteen ja eri kassapolun samasta yhtiöstä.

Siksi nämä tehdään yhdessä: sama muutos julkaisuputkeen korjaa molemmat, ja kahdesti tehtynä siitä tulisi kaksi kertaa riskialttiimpi.

## 1. Päätetty laskenta hoitokatteelle

```
vuosittain kassaan kertyvä
  = viimeisimmän toteumavuoden tulot
  − (saman vuoden kulut − saman vuoden KORJAUKSET)
```

Nykydatalla (2025): `43 906,75 − 34 029,46 = 9 877,29 €`

### Miksi korjaukset vähennetään kuluista

Korjaukset ovat kassapolussa jo omana rivinään ("Tunnetut kulut", jotka tulevat hyväksytyistä korjaustapahtumista). Jos ne olisivat myös tässä luvussa, ne laskettaisiin kahdesti.

Huomaa että `34 029,46` on **täsmälleen sama komponentti** kuin `computeTrailing12mOperatingCosts`in ytimessä ("vuoden 2025 kulut ilman korjauksia"). Sama laskenta, ja se on syytä jakaa eikä monistaa.

### Miksi viimeisin vuosi eikä keskiarvo

Korjauksissa keskiarvo on oikea, koska ne heiluvat satunnaisesti (yhtenä vuonna hajoaa, toisena ei). Vastikkeet ja hoitokulut eivät heilu — ne nousevat trendinomaisesti. Vastikkeita nostettiin 2023→2025 noin 18 %, joten keskiarvo vetäisi lukua systemaattisesti alaspäin ja kuvaisi mennyttä eikä nykytilaa.

### Vakio koko horisontin, mutta kerrottuna

Luku pysyy samana koko horisontin. **Ei inflaatiokorjausta.** Perustelut:

1. Inflaatio-oletus on arvaus ja uusi virhelähde.
2. Tulot ja kulut nousevat suunnilleen samaa tahtia, joten vaikutus **erotukseen** on pienempi kuin miltä kuulostaa.
3. Ratkaiseva: **korjauskustannukset kassapolussa ovat myös nykyhinnoissa.** Jos hoitokate indeksoitaisiin mutta korjaukset eivät, malli olisi epäjohdonmukainen väärään suuntaan — se näyttäisi kassan riittävän paremmin kuin se riittää.

Näkymän on kerrottava tämä: luku on viimeisimmän toteumavuoden tasossa eikä sisällä inflaatiota. Sama periaate kuin kunnossapitokatteessa — sovellus ei arvaa, mutta kertoo mitä olettaa.

### Nimi

"Vuosikeräys" on harhaanjohtava: se viittaa erilliseen korjauskeräykseen, jollaista tässä yhtiössä ei ole (vastikkeet kerätään neliöiden ja autopaikkojen perusteella yhtenä hoitovastikkeena). Ehdota parempi nimi sekä kassapolun sarakkeelle että visitor-lomakkeen kentälle. Vaihtoehtoja: "Kertyy kassaan", "Hoitokate", "Tulot − hoitokulut". Kerro valintasi ja perustelusi.

## 2. Päätetty laajuus julkaisuputkeen

Tilidata viedään julkaistuun snapshottiin niin, että sekä hoitokate että 12 kk hoitokulu lasketaan samalla tavalla admin- ja visitor-puolella.

Suunnitelmassa vastattava:

1. **Mikä viedään?** `financialAccounts` + `financialEntries` riittänevät molempiin laskentoihin, mutta `groupActuals` vaikuttaa tulojen kokonaissummaan (ryhmätason toteuma voittaa tilisumman — ks. PR #19). Tarkista tarvitaanko se, ja jos tarvitaan, vaikuttaako `groupBudgets` mihinkään. **Vie vähin mikä riittää**, älä koko tilidataa varmuuden vuoksi.

2. **Näkyykö tilidata osakkaille?** Tämä on tietoturvakysymys, ei tekninen. Nykyinen julkaisu jättää tilikohtaisen erittelyn pois — kuka isännöitsijä laskuttaa mitäkin, yksittäiset pankkikulut. Jos vienti tekee siitä osakkaiden nähtävää, kerro se selvästi suunnitelmassa. **Jos vaihtoehtona on viedä vain johdetut luvut** (laskettu hoitokate ja hoitokulu, ei raakadataa), arvioi sekin — se menettää jäljitettävyyden mutta säilyttää nykyisen rajauksen. Kerro kumpi on mielestäsi oikein ja miksi; tämä on päätös jonka haluan nähdä perusteltuna ennen hyväksyntää.

3. **`withDefaultedAdminCollections()`** (`src/database/postgresPublishingRepository.ts`) — jos kokoelmia lisätään julkaisupuolelle, oletusarvoistus + regressiotesti kirjoitettuna niin että se **failaa** jos defaultointi poistetaan. Tämä bugi on kaatanut työtilan latauksen kerran (3A) ja se on lähellä tätä muutosta.

4. **Fingerprint ja julkaisukelpoisuus.** `fingerprintPublishableContent` määrittää milloin julkaisussa on muutoksia. Jos tilidata tulee mukaan, tilidatan muutos tekee julkaisusta muuttuneen. Onko se toivottavaa? Kerro seuraus.

5. **Käsin syötetty `LiquidityBaselineRecord`.** Kun molemmat luvut lasketaan, jäävätkö `trailing12mOperatingCosts` ja `annualCollection` kentiksi lainkaan? Ehdota: poistetaanko, jätetäänkö ohitukseksi, vai jätetäänkö kuolleena kenttänä. **Jos jätetään ohitukseksi, se on näytettävä käyttäjälle** samaan tapaan kuin "Budjetin lähde" -sarake — muuten syntyy uusi hiljainen kahden luvun tila, eli täsmälleen se ongelma jota tämä PR poistaa.

6. **Visitor-lomake.** Visitorilla on kentät "Kassa €", "12 kk hoitokulut €", "Optimistic/Base/Stress keräys €/v". Jos luvut lasketaan, mitä näille tapahtuu? Skenaariokohtainen keräys on erikseen mietittävä: laskettu hoitokate on yksi luku, mutta lomake tarjoaa kolme. Kerro ehdotuksesi.

## 3. Mitä ei muuteta

- Korjaustapahtumat, kunnossapitokate, `forecastComplete` — omia tehtäviään.
- Tilikohtaiset näkymät (Kulut tileittäin, Kulut ryhmittäin, Tulot, Budjetti vs. toteuma) — ennallaan.
- Etumerkkikonventiot (kulut negatiivisina), DATA GAP -periaate.
- Ei auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita. Ei bundleria, ei jsdomia.

## 4. Testit

- Hoitokate tunnetulla datalla: 2025 → `9 877,29 €`; osat (tulot, kulut ilman korjauksia) palautuvat erikseen.
- Jaettu komponentti: "kulut ilman korjauksia" lasketaan yhdessä paikassa, ei kahdesti. Testi joka failaa jos ne erkaantuvat.
- Ryhmätason toteuma vaikuttaa tuloihin oikein (2023: 36 237,38 € eikä 3 527,50 € — ks. PR #19).
- Ei toteumavuosia / ei KORJAUKSET-ryhmää → DATA GAP -käsittely, **ei nollaa**. Sama linja kuin `computeTrailing12mOperatingCosts`issa: "—" ja huomautus.
- Admin ja visitor laskevat saman luvun samasta datasta. Tämä on koko PR:n pointti — testi joka ajaa molemmat polut ja vertaa.
- `withDefaultedAdminCollections`-regressio (§2.3).
- Julkaisun fingerprint käyttäytyy kuten §2.4:ssä päätetään.
- Regressio: kassapolun rakenne, puskuritavoite, `forecastComplete`, kunnossapitokate ennallaan — vain luvut muuttuvat.

## 5. Odotettu vaikutus lukuihin

Merkitse PR-kuvaukseen. Kassa kasvaa hitaammin kuin ennen (9 878 vs. 9 680 on lähellä, mutta 12 kk hoitokulu nousee 34 029 → 37 568, joten puskuritavoite kasvaa). Puskurivajeita voi ilmestyä vuosille joissa niitä ei ennen ollut. **Se on korjaus, ei regressio**, mutta se ei saa yllättää.

## 6. Työskentelytapa

1. Branch **`feature/calculated-liquidity-inputs`** tuoreesta mainista.
2. **Suunnitelma ensin, ei koodia.** Vastaa §1:n nimikysymykseen ja §2:n kuuteen kohtaan. §2.2 (näkyykö tilidata osakkaille) on se jonka haluan nähdä perusteltuna.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen, sekä admin- että visitor-puolelta.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen valmiusilmoitusta. `pkill -f wrangler` ei toimi (tappaa oman komentonsa) — `kill <PID>` ja curl-varmistus.

## 7. Muistutus testien sokeista pisteistä

`docs/testien-sokeat-pisteet.md` kirjaa kaksi peräkkäistä tapausta joissa testi näytti kattavan polun mutta ei kattanut (varjostava `PGliteSqlPool`, tasasekunti-aikaleimat). Ydinohje: **jos testi ei kaadu ilman korjausta, se ei testaa korjausta.** Tämä PR koskee samaa kerrosta (julkaisuputki, tietokanta), joten sovella sitä.

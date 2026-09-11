# Claude Code -tehtävä: Kassapolku uusiksi

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `42dc4c4`, ei avoimia PR:iä. **Suunnittelupainotteinen tehtävä** — palauta suunnitelma ja odota hyväksyntää.

Tämä ei ole korjaus vaan näkymän uudelleenmäärittely. Nykyinen taulukko korvataan; älä yritä säilyttää sitä.

## 0. Miksi

Kassapolku on ollut käytännössä lukukelvoton. Käyttäjä (hallituksen pj, ainoa käyttäjä) sanoi sen suoraan sparrauksessa: *"tuo kassapolku on kyllä hieman hölmö"* ja *"tämä on hyvin epäselvä systeemi ja tälle pitää tehdä jotain"*. Sama luku selitettiin neljä kertaa eikä se auennut — se on merkki esityksestä, ei lukijasta.

Kolme konkreettista vikaa:

1. **32 riviä joista 27 on tyhjiä.** Horisontti ulottuu 2057:ään, kunnossapitosuunnitelma kattaa 2030 asti. Katteen jälkeisillä riveillä kolme saraketta on "—" ja hoitokate näyttää tarkan luvun — oletus naamioituna dataksi.
2. **Hoitokate on sama luku 32 kertaa.** Se ei ole vuosikohtaista tietoa vaan yksi oletus, ja oletukset eivät kuulu taulukkoon riveinä. Lisäksi se on väärä oletus: hoitokate on ollut 4 321 / 10 010 / 9 877 € vuosina 2023–2025, ei vakio.
3. **Taulukko ei näytä mennyttä lainkaan.** Käyttäjällä on kolme vuotta toteumadataa jonka pohjalta hän voisi itse arvioida tulevaa, mutta sovellus näyttää vain ennusteen.

Vertailukohtana alan käytäntö: PTS laaditaan tyypillisesti **10 vuodelle**, ja laki (AsOYL 6:3) vaatii viiden vuoden kunnossapitotarveselvityksen. 32 vuoden kassaennuste ei vastaa mitään vakiintunutta käytäntöä.

## 1. Uusi taulukko

Seitsemän saraketta, tässä järjestyksessä:

| Vuosi | Avaava kassa | Hoitokate | Korjaukset | Päättävä kassa | Korjausbudjetti | vs. budjetti |
|---|---|---|---|---|---|---|
| 2023 | — | 4 321 | −1 385 | — | 3 000 | +267 |
| 2024 | — | 10 010 | −5 349 | 16 977 | 8 000 | +952 |
| 2025 | 16 977 | 9 877 | −3 882 | 22 208 | 9 400 | +1 226 |
| *2026* | 22 208 | *9 459* | *−4 300* | *27 367* | 9 680 | — |

**Sarakkeet ovat kahdessa ryhmässä eikä sekaisin:**

- **Viisi ensimmäistä ovat yksi yhtälö**, luettavissa vasemmalta oikealle: avaava + hoitokate − korjaukset = päättävä.
- **Kaksi viimeistä ovat vertailua**: paljonko korjauksiin oli varattu, ja miten hoitokate osui budjettiin.

**Puskuritavoite ja puskurivaje poistuvat** taulukosta. Ne olivat vakioita jokaisella rivillä. DATA GAP -sarake poistuu myös (aina 0).

### Kolme tiedon laatua, kolme esitystapaa

| Vuodet | Mistä | Esitys |
|---|---|---|
| 2023–2025 | toteuma (tilidata + tase) | normaali |
| 2026 | budjetti (talousarvio + suunnitellut korjaukset) | erottuu visuaalisesti, esim. kursiivi + merkintä |
| 2027→ | ei mitään | ei riviä lainkaan |

Raja siirtyy itsestään: kun 2027:n budjetti syötetään, rivi täyttyy. Kun 2026:n tilinpäätös tulee, rivi muuttuu toteumaksi.

**Tämä on tehtävän tärkein rakenteellinen vaatimus.** Budjettirivi ei saa näyttää samalta kuin toteumarivi — muuten lukija näkee neljä samannäköistä riviä joista kolme on totta ja yksi ennuste.

### Mihin taulukko loppuu

Kunnossapitokatteeseen (`maintenancePlanCoverageThroughYear`, nyt 2030). **Ei viivarivejä sen jälkeen.**

Perustelu: varaajien aikataulurivit ulottuvat optimistisessa skenaariossa 2039:ään, mikä tuottaisi 14 riviä joista useimmilla on vain yksi 1 800 €:n korjaus ja kaikki muut sarakkeet tyhjiä. Ne kuuluvat banneriin (§2), eivät laskelmaan.

### Laskenta

- **Hoitokate menneille vuosille:** kunkin vuoden omat toteumat, `tulot − (kulut − korjaukset)`. Ei vakiota, ei viimeisimmän vuoden lukua kaikille.
- **Hoitokate budjettivuodelle:** saman vuoden budjetista samalla kaavalla. 2026: `42 714,26 − (42 935,71 − 9 680,00) = 9 458,55`.
- **Korjaukset menneille:** KORJAUKSET-ryhmän toteuma.
- **Korjaukset budjettivuodelle:** hyväksytyistä korjaustapahtumista, valitun skenaarion mukaan (kuten nyt).
- **Avaava ja päättävä kassa:** taseen "Rahat ja pankkisaamiset" kyseiseltä vuodelta. Budjettivuodelle laskettu.
- **vs. budjetti:** toteutunut hoitokate − budjetoitu hoitokate. Vain toteumavuosille.

**Kassasarakkeet ovat "—" jos tasetta ei ole.** Nyt taseita on 2024 ja 2025, joten 2023:n avaava ja päättävä ovat tyhjiä ja 2024:n avaava. Käyttäjä on kertonut että 2022-tase löytyy paperiversiona ja se syötetään myöhemmin — silloin sarakkeet täyttyvät itsestään.

### Täsmäytysero

Menneillä riveillä yhtälö ei täsmää täysin. 2025: `16 977 + 9 877 − 3 882 = 22 972`, mutta taseen päättävä kassa on `22 208`. Ero **−764 €** on käyttöpääoman muutos (myyntisaamiset +310, ostovelat −337, ennakkomaksut −116): tulos ei ole sama kuin kassavirta, koska osa laskuista on maksamatta vuodenvaihteessa.

**Ei omaa saraketta.** Taulukon alle pieni selite, esim.:

> Päättävä kassa on taseesta. Se poikkeaa laskennallisesta hieman, koska osa laskuista on maksamatta vuodenvaihteessa.

## 2. Banneri: tiedossa olevat korjaukset

Taulukon alle, **seuraa valittua skenaariota** (samat välilehdet kuin taulukolla).

| Vuosi | Korjaus | Summa | Hinta |
|---|---|---|---|
| 2026 | Ilmanvaihdon puhdistus | 2 500 | arvio |
| 2026 | Varaajien uusiminen | 1 800 | arvio |
| 2027 | Julkisivujen huoltomaalaus | 15 000 | arvio |
| … | | | |
| **Yhteensä** | | **39 100** | |

- **Vuosi kerrallaan**, ei ryhmiteltynä rakennusosan mukaan. Ryhmittely kokeiltiin sparrauksessa ja hylättiin: se hävitti skenaarioiden välisen eron, joka on juuri se mitä varaajissa on olennaista.
- **Kaikki tiedossa olevat korjaukset**, myös kunnossapitokatteen ulkopuolelta (varaajat 2031–2039). Banneri on luettelo, ei laskelma, joten pitkä lista ei haittaa.
- **Hintatiedon laatu näkyy rivillä** (tarjous / arvio / DATA GAP). 15 000 € arviona on eri asia kuin tarjouksena.

### Toteutuneet

Bannerin alla oma osio, **suljettuna oletuksena** ("Näytä toteutuneet"). Sisältää tapahtumat joiden tila on `actual`.

Näyttää **vain toteutuneen hinnan** — ei arviota, ei vertailua arvion ja toteuman välillä. Käyttäjän perustelu: *"en halua vertailua, koska se voi olla epäreilu arvioijaa kohtaan"*. Arvio kolmen vuoden päähän on suuruusluokka, ei hinta, ja sen vertaaminen jälkikäteen ohjaisi tekemään arvioista varovaisia sen sijaan että ne olisivat rehellisiä.

**Tämä vaatii uuden kentän:** toteutuneella korjaustapahtumalla on oltava toteutunut hinta. Nyt sitä ei ole. Ehdota mihin se sijoittuu (`BuildingEvent.actual`-rakenteessa on jo `costEvidenceId` — katso sopiiko sinne) ja miten se syötetään. **Muista `withDefaultedAdminCollections()` + regressiotesti jos kenttiä lisätään.**

## 3. Mitä ei tehdä

- **Ei "muut korjaukset" -saraketta.** Sovellukseen kirjataan vain merkittävät korjaukset; pienet menevät korjausbudjetista eikä niitä kirjata (*"ei siinä ole mitään järkeä että merkkaan jokaisen pistorasian vaihdon"*). Korjaukset-sarake on siis tietoisesti vajaa, ja se on hyväksytty rajoite.
- **Ei erottelua "hoitotalouden korjaus" vs. "yhtiökokouksen päättämä".** Kaikki maksetaan kassasta jos rahat riittävät.
- **Ei inflaatiokorjausta.**
- **Ei muutoksia** Vastiketarve-näkymään, `forecastComplete`-logiikkaan, kunnossapitokatteeseen, hoitokatteen laskentaan likviditeettimallissa, Budjetti vs. toteuma -näkymään.

Huomaa: `buildLiquidityForecast` ja `projectCashPath` palvelevat myös Vastiketarve-näkymää ja visitor-puolta. **Jos rakennat uuden read modelin kassapolulle, älä riko niitä.** Kerro suunnitelmassa miten erottelu tehdään.

## 4. Suunnitelmassa vastattava

1. **Uusi read model vai olemassa olevan muokkaus?** `projectCashPath` tuottaa nykyisen rakenteen ja sitä käyttää myös `findFundingNeed`. Uusi taulukko tarvitsee toteumadataa jota nykyinen ei lue lainkaan.
2. **Mistä budjettivuoden hoitokate lasketaan?** `buildGroupedFinanceCore` antaa budjetit; tarkista että kaava toimii ryhmätason budjeteilla (`groupBudgets`) samoin kuin toteumilla.
3. **Miten kolme tiedon laatua merkitään** view-modelissa niin ettei renderöinti joudu päättelemään sitä (`rowKind: "actual" | "budget"` tai vastaava).
4. **Toteutuneen hinnan kenttä** (§2).
5. **Visitor-puoli:** näkyykö kassapolku siellä? Jos näkyy, tarvitaanko toteumadataa julkaisuun — se vietiin sinne PR #23:ssa, joten tarkista riittääkö se.

## 5. Testit

- Hoitokate lasketaan **kunkin vuoden omista luvuista**: 2023 → 4 321, 2024 → 10 010, 2025 → 9 877. Tämä on se testi joka estää paluun vakioon.
- Budjettivuoden hoitokate 2026 → 9 458,55.
- Taulukko loppuu kunnossapitokatteeseen; varaajien 2031–2039 rivit **eivät** tuota taulukkorivejä mutta **näkyvät bannerissa**.
- Kassasarake on "—" kun tasetta ei ole (2023), **ei nollaa**.
- Rivin laatu (`actual`/`budget`) on view-modelissa, ei renderöinnissä pääteltynä.
- Banneri seuraa skenaariota: optimistic 30 500 €, base 39 100 €, stress 39 100 €.
- Toteutuneet-osio on tyhjä kun `actual`-tapahtumia ei ole, eikä kaadu.
- Regressio: Vastiketarve, `forecastComplete`, kunnossapitokate, visitor-näkymä ennallaan.

## 6. Työskentelytapa

1. Branch **`feature/cashpath-rebuild`** tuoreesta mainista.
2. **Suunnitelma ensin, ei koodia.** Vastaa §4:n viiteen kysymykseen.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen valmiusilmoitusta. `pkill -f wrangler` ei toimi. `kill <PID>` ja curl-varmistus — `--remote` ei lataa `public/`-assetteja uudelleen tiedostomuutoksesta.

## 7. Muistutus

`docs/testien-sokeat-pisteet.md`: **jos testi ei kaadu ilman korjausta, se ei testaa korjausta.** Neljäs peräkkäinen tapaus oli PR #24:n `mode === "create"`, joka tyyppitarkistui ja luki oikein muttei suoriutunut kertaakaan. Tämä PR koskee samaa kerrosta (view-model + renderöinti), joten sovella sitä.

## 8. Jatkotyö (ei tähän PR:ään)

Sparrauksessa sovittiin oma näkymänsä kolmelle taulukolle, jotka ovat informatiivisia eivätkä laske mitään: tehdyt toimenpiteet, kunnossapitotarveselvitys, tekninen käyttöikä. Kaikki käsin muokattavia. Se on seuraava tehtävä, ja käyttäjällä on sisällöt valmiina.

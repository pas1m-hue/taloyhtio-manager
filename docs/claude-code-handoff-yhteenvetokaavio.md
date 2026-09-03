# Claude Code -tehtävä: Tulot ja kulut -pylväskaavio Yhteenveto-näkymään

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `e37fa80`, ei avoimia PR:iä. **Kevyt tehtävä** — PR #16 rakensi jo kaaviomekanismin, tämä käyttää sitä uudelleen. Tee lyhyt suunnitelma ennen koodausta, mutta se voi olla lyhyempi kuin edellisissä.

## 0. Tausta

PR #16 lisäsi ryhmädetaljin modaaliin pylväskaavion: `buildGroupChartModel()` (puhdas funktio `public/adminOperationPayloads.js`) + renderöinti `public/app.js`:ssä, inline-SVG ilman kirjastoa, teksti HTML:nä SVG:n alla.

Nyt sama mekanismi Yhteenveto-näkymään, mutta eri datalla: **tulot ja kulut rinnakkain vuosittain.**

Tämä kertoo asian jota missään ei nyt näy kaaviona: kehittyykö taloyhtiön talous suuntaan vai toiseen. Pylväiden korkeusero *on* hoitokate.

## 1. Päätetyt valinnat

Nämä on päätetty, älä ehdota vaihtoehtoja:

1. **Sijainti:** Yhteenveto-näkymä (Talous · Yhteenveto).
2. **Sisältö:** kaksi pylvästä per vuosi — tulot ja kulut. **Ei erillistä hoitokate-pylvästä**: se on niin pieni suhteessa (2025: 5 996 € vs. 43 907 €) että se katoaisi visuaalisesti, ja se näkyy joka tapauksessa pylväiden korkeuserona.
3. **Sama suunta molemmille.** Kulut tallennetaan negatiivisina, tulot positiivisina, mutta kaaviossa **molemmat piirretään ylöspäin** (kuluille itseisarvo). Vertailtavuus on tässä tärkeämpää kuin etumerkin visuaalinen esitys — vastakkaisiin suuntiin osoittavista pylväistä korkeuseroa ei hahmota. Lukuarvo labelissa säilyttää oikean etumerkin (kulut miinusmerkkisinä), kuten PR #16:ssa.
4. **DATA GAP samoin kuin PR #16:ssa:** puuttuva vuosi on akselilla mutta ilman pylvästä, merkintä "—", ei koskaan nollapylvästä.

## 2. Käytä olemassa olevaa, älä rakenna rinnakkaista

Tämä on tehtävän ydin. Kolme kohtaa:

- **Laskenta:** tulojen ja kulujen vuosisummat lasketaan jo jossain (`buildGroupedFinanceCore(..., "income" / "expense")` tai näkymämallit niiden päällä). Käytä olemassa olevaa summaa — älä summaa tilejä uudelleen. Jos kaavio laskisi omansa, kaksi laskentaa voisi erkaantua ja Yhteenveto näyttäisi eri lukuja kuin Tulot- ja Kulut-näkymät.
- **Kaaviomalli:** arvioi voiko `buildGroupChartModel()` yleistyä kahdelle sarjalle vai tarvitaanko rinnakkainen funktio. Kerro suunnitelmassa kumpi ja miksi. **Älä kopioi-liitä** olemassa olevaa funktiota uudella nimellä.
- **Renderöinti ja CSS:** sama `.group-chart`-rakenne, skaalaus, `preserveAspectRatio="none"` + kiinteä korkeus, HTML-labelit samalla sarakejaolla, `@media (max-width: 960px)` -sääntö. Nämä ovat jo olemassa ja testattu.

Muista PR #16:n opit: **ei heksavärejä app.js:ään** (`viewWiring.test.js`:n id-skanneri lukee `#fff`:n elementtiviittaukseksi ja kaatuu), värit vain `var(--…)`-muuttujista, ja labelien `grid-gap` on hoidettava niin että sarakkeiden keskikohdat osuvat pylväiden kohdalle.

## 3. Skaalaus

Nollasta suurimpaan itseisarvoon kaikista piirrettävistä pylväistä (sekä tulot että kulut). Molemmat sarjat samalle akselille — muuten korkeusero ei tarkoita hoitokatetta.

Zero-based, ei katkaistua akselia. Tässä datassa se toimii hyvin: tulot ja kulut ovat samaa suuruusluokkaa (43 907 vs. 37 911), joten ero näkyy ilman akselitemppuja.

## 4. Erottelu tulot vs. kulut

Kaksi sarjaa on erotuttava toisistaan, eikä pelkkä väri riitä (sama saavutettavuusperiaate kuin budjettipylväässä PR #16:ssa). Ehdota suunnitelmassa miten — esim. eri CSS-muuttuja + selite, ja labelrivi joka nimeää kumpi on kumpi.

Huomaa ettei tässä ole budjettipylvästä lainkaan, joten katkoviiva on vapaana käytettäväksi jos siitä on hyötyä.

## 5. Vuodet

Samat vuodet kuin muuallakin: vuodet joilla on toteumaa. Nykydatalla 2024 ja 2025 useimmilla, 2023 osittain (Henkilöstökulut ja kulutusperusteinen vastike).

**Huomaa epäsymmetria:** tuloilla on 2023-toteumaa (kulutusperusteinen vastike 3 527,50 €) ja kuluilla vain osittain. Vuosi 2023 voi siis olla akselilla niin että toinen pylväs piirtyy ja toinen ei. Tämä on oikein ja sen pitää toimia — molemmat sarjat eivät saa kadota siksi että toisesta puuttuu luku.

**Budjettivuosi 2026:** jätä pois tästä kaaviosta. Perustelu: budjetteja on sekä tilikohtaisia että ryhmätason, ja niiden yhteensovittaminen tässä avaisi saman etusijakysymyksen kuin Budjetti vs. toteuma -näkymässä. Tämä kaavio näyttää toteutuneen kehityksen.

## 6. Rajaus

Ei kosketa auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita, ei uusia kokoelmakenttiä. Ei kaaviokirjastoa, ei bundleria, ei jsdomia.

Yhteenveto-näkymän nykyinen sisältö **pysyy ennallaan** — kaavio tulee sen lisäksi. Ryhmädetaljin kaavio (PR #16) ei saa muuttua; jos yleistät `buildGroupChartModel()`ia, sen nykyiset testit on pysyttävä vihreinä muuttumattomina.

## 7. Testit

- Kaksi sarjaa, kaikki vuodet → oikeat korkeudet, yhteinen maksimi.
- Vuosi jolta toinen sarja puuttuu → toinen piirtyy, toinen on "—". **Tämä on tärkein uusi testi**, koska se on ainoa oikeasti uusi tilanne PR #16:een verrattuna.
- Puuttuva vuosi ei tuota nollapylvästä (sama sääntö, uusi konteksti).
- Kulujen itseisarvo pylvään korkeudessa, mutta lukuarvo säilyttää etumerkin.
- Regressio: `buildGroupChartModel()`in nykyiset testit ennallaan, ryhmädetaljin kaavio ennallaan, `viewWiring.test.js` ennallaan.

## 8. Työskentelytapa

1. Branch **`feature/summary-chart`** tuoreesta mainista.
2. **Lyhyt suunnitelma ensin.** Vastaa erityisesti §2:n kysymykseen: yleistetäänkö olemassa oleva funktio vai tarvitaanko uusi.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen — erityisesti vuosi 2023, jolta toisen sarjan luku puuttuu.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen kuin ilmoitat valmiudesta.

# Claude Code -tehtävä: Pylväskaavio ryhmädetaljin modaaliin

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `642de98`, ei avoimia PR:iä. Rajattu tehtävä, mutta tee lyhyt suunnitelma ennen koodausta — SVG-toteutuksessa on muutama valinta joita ei kannata tehdä kesken kirjoittamisen.

## 0. Tausta ja tavoite

Kulut ryhmittäin -näkymässä ryhmän "Näytä"-nappi avaa detaljimodaalin, jossa on tilikohtainen taulukko (sarakkeet Toteuma 2023 / 2024 / 2025 / Budjetti 2026). Taulukko kertoo tarkat luvut, mutta ei **muotoa** — nouseeko kulu, laskeeko, onko yksi vuosi poikkeama.

Lisätään modaaliin pylväskaavio, joka näyttää ryhmän kokonaissumman vuosittain.

**Rajoite joka on tiedossa ja hyväksytty:** useimmilla ryhmillä on tällä hetkellä vain kaksi toteumavuotta (2024, 2025), koska tilikohtaiset 2023-toteumat odottavat isännöitsijää. Kaavio on siis aluksi laiha. Tämä on tietoinen valinta: rakennetaan mekanismi nyt, sisältö täydentyy itsestään kun data tuodaan. **Älä rakenna erikoistapauksia ohuen datan varalle** — kaavion pitää toimia yhdellä, kahdella, kolmella tai kymmenellä vuodella samalla koodilla.

## 1. Päätetyt valinnat

Nämä on päätetty, älä ehdota vaihtoehtoja:

1. **Sijainti:** ryhmädetaljin modaali, Kulut ryhmittäin -näkymässä. Ei muihin näkymiin tässä PR:ssä.
2. **Sisältö:** ryhmän **kokonaissumma** vuosittain — ei tilikohtaisia pylväitä. Taulukko on jo tilitasolla tarkka; kaavion tehtävä on näyttää muoto.
3. **Puuttuva vuosi:** vuosi näkyy akselilla, mutta **pylvästä ei piirretä**. Tilalle merkintä joka kertoo että lukua ei ole ("—" tai vastaava). Vuotta ei jätetä pois akselilta.
4. **Budjetti erottuu toteumista** selvästi (eri väri tai kuviointi) + selite. Budjetti on ennuste, ei tapahtunut, eikä sitä saa lukea toteumana.

## 2. DATA GAP — kriittisin kohta

Tämä on koko tehtävän tärkein sääntö, ja se on helppo rikkoa vahingossa.

Puuttuva vuosi **ei saa** piirtyä nollan korkuisena pylväänä. Nollapylväs näyttää katsojalle "kuluja ei ollut", kun totuus on "lukua ei tiedetä". Sovelluksen läpi kulkeva periaate: tuntematonta ei koskaan korvata nollalla, tyhjä näytetään "—".

Huomaa että eri ryhmillä puuttuu eri vuosia: Henkilöstökuluilla on 2023-toteuma (−360,00 €), useimmilla muilla ei. Kaavion on kestettävä tämä ryhmäkohtaisesti.

Varmista myös ettei nolla ja puuttuva mene sekaisin toiseen suuntaan: jos jollain ryhmällä on aidosti 0,00 € jonain vuonna, se on eri asia kuin puuttuva ja saa piirtyä nollapylväänä.

## 3. Toteutustapa

**Inline-SVG, käsin kirjoitettuna. Ei kaaviokirjastoa.**

Projektissa ei ole bundleria, joten kirjasto tarkoittaisi joko CDN-skriptiä (uusi ulkoinen riippuvuus + CSP-mietintä) tai kirjaston kopiointia `public/`-kansioon. Kumpikin on ylimitoitettu yhdelle pylväskaaviolle, joka on käsin ehkä 60–80 riviä.

Rakenne, joka noudattaa talon nykyistä työnjakoa:

- **Laskenta puhtaana funktiona** `public/adminOperationPayloads.js`:ään — esim. `buildGroupChartModel(group, years)` → pylväiden arvot, korkeudet/koordinaatit, akselin vuodet, mikä on budjetti, mikä puuttuu. Vitest-testattavissa ilman DOM:ia, kuten muut view-model-funktiot.
- **Renderöinti** `public/app.js`:ssä: ottaa mallin ja tuottaa SVG:n. Ei laskentaa renderissä.

Näin kaavion logiikka on testattavissa ilman että SVG:tä pitää jäsentää testissä.

## 4. Suunnitelmassa vastattava

1. **Mistä kokonaissumma tulee?** Ryhmädetaljin view-model laskee ryhmäsummat jo jossain (`buildExpenseGroupViewModel` tai vastaava) — käytä olemassa olevaa, älä laske uudelleen. Kerro mitä käytät.
2. **Skaalaus.** Miten pylväiden korkeus suhteutetaan? Nollasta suurimpaan arvoon on suoraviivaisin. Huomaa että kulut ovat negatiivisia (`Math.abs` tähän on oikein — kyse on pylvään pituudesta, ei etumerkin piilottamisesta).
3. **Mitat ja responsiivisuus.** Modaali on leveä (`min(92vw, 1800px)`) ja ≤960 px:n leveydellä koko ruudun kokoinen. Miten SVG skaalautuu? `viewBox` + `width: 100%` on todennäköisesti riittävä, mutta kerro miten tekstit käyttäytyvät.
4. **Värit.** Käytä olemassa olevia CSS-muuttujia (`styles.css`), älä kovakoodaa uusia värejä. Budjetin erottelu ei saa nojata pelkkään väriin — kuviointi tai reunaviiva on saavutettavampi.
5. **Arvot näkyviin?** Kerro ehdotuksesi siitä näkyykö pylvään arvo lukuna kaaviossa vai vain akselilla. Taulukko on samassa modaalissa, joten toistoa kannattaa välttää.

## 5. Rajaus

Ei kosketa auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita, ei uusia kokoelmakenttiä (jos kuitenkin lisäät, muista `withDefaultedAdminCollections()` + regressiotesti — tämä bugi on osunut kerran). Ei kaaviokirjastoa, ei bundleria, ei jsdomia.

Tilikohtainen taulukko modaalissa **pysyy ennallaan** — kaavio tulee sen lisäksi, ei tilalle. Muut näkymät ja laskennat ennallaan. Etumerkkikonventiot ennallaan.

## 6. Testit

- `buildGroupChartModel`: kaikki vuodet olemassa; yksi vuosi puuttuu keskeltä; vain yksi vuosi dataa; ei dataa lainkaan.
- **Puuttuva vuosi ei tuota nollapylvästä** — tämä on se testi joka pitää kirjoittaa niin että se failaa jos joku myöhemmin "yksinkertaistaa" puuttuvan nollaksi.
- Aito 0,00 € tuottaa nollapylvään eikä mene sekaisin puuttuvan kanssa.
- Budjettipylväs merkitään erottuvaksi mallissa (ei renderöinnin varassa).
- Skaalaus: suurin arvo täyttää korkeuden, pienempi on suhteessa oikein.
- Regressio: modaalin tilitaulukko ja `viewWiring.test.js` ennallaan.

## 7. Työskentelytapa

1. Branch **`feature/group-chart`** tuoreesta mainista.
2. **Lyhyt suunnitelma ensin, ei koodia.** Vastaa §4:n viiteen kysymykseen.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen — erityisesti: ryhmä jolla 2023 puuttuu (esim. Hallintopalvelut) ja ryhmä jolla se on olemassa (Henkilöstökulut).
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen kuin ilmoitat valmiudesta — dev-palvelin ei ole tässä projektissa ottanut CSS/JS-muutoksia käyttöön ilman sitä.

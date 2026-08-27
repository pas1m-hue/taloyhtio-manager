# Claude Code -tehtävä: Ryhmätason budjettivertailu (Budjetti vs. toteuma ryhmätasolla)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Vaiheet 1–4B mergattu mainiin. Tämä lisää tuen **ryhmätason budjettivertailulle**. **Tämä on suunnittelupainotteinen tehtävä** — palauta ensin suunnitelma ja odota hyväksyntää, koska tässä on aito tietomalliratkaisu tehtävänä.

## 0. Tausta ja ongelma (todellinen käyttötilanne)

Taloyhtiön budjetti laaditaan **ryhmätasolla** (Hallintopalvelut, Vesi- ja jätevesi, Sähkö...), ei tilikohtaisesti. Toteumat sen sijaan kirjataan tilikohtaisesti (tilit 5300, 5301...). Käyttäjällä on budjetti+toteuma ryhmätasolla vuosille 2023, 2024, 2025 (lähde: tilinpäätösten budjettivertailut), mutta tilikohtaiset budjetit puuttuvat.

Nykyinen malli (`FinancialEntry`) sitoo budjetin ja toteuman **tiliin** (accountCode), ja `buildBudgetVsActualViewModel` + `deriveComparableYears` toimivat tilitasolla: vertailu vaatii saman vuoden budjetin JA toteuman **samalla tilillä**. Ryhmätason budjettia ei voi syöttää nykymalliin sotkematta tilikohtaisia näkymiä:
- Jos ryhmäbudjetti syötetään "edustustilinä" samaan ryhmään, `buildExpenseGroupViewModel` / `buildAccountCostsViewModel` laskevat ryhmäsumman kahteen kertaan (oikeat tilit + edustustili).
- Budjetti vs. toteuma tarvitsee siis tavan verrata **ryhmän budjettia** (ryhmätaso) **ryhmän toteumasummaan** (johdettu tilien summasta), ilman että ryhmäbudjetti vuotaa tilikohtaisiin summiin.

Tavoite: Budjetti vs. toteuma -näkymä toimii ryhmätasolla (kuten Excelin "Budjettitarkkuus"-välilehti: ryhmä, budjetti, toteuma, erotus € ja %), tilikohtaisten näkymien pysyessä oikeina.

## 1. Suunniteltava ratkaisu (palauta suunnitelma ensin)

Suunnittele tietomalli ja logiikka joka mahdollistaa **ryhmäkohtaisen budjetin** erillään tilikohtaisesta datasta. Mahdollisia lähestymistapoja (arvioi ja ehdota paras, perustele):

**Vaihtoehto A — uusi kevyt entiteetti `GroupBudget`:**
- `GroupBudget { group: string, kind: "income"|"expense", year: number, budgetAmount: number, sourceIds, notes? }`.
- Lisätään snapshotiin uutena kokoelmana (`groupBudgets`). **KRIITTINEN:** muista `withDefaultedAdminCollections` (`src/database/postgresPublishingRepository.ts`) — uusi kokoelmakenttä on oletusarvoistettava `[]`:ksi + regressiotesti, muuten vanha snapshot kaataa työtilan latauksen (tämä bugi on osunut jo 3A:ssa, ei saa toistua).
- Budjetti vs. toteuma -näkymä: ryhmän **toteuma** johdetaan tilien `actualAmount`-summasta (per vuosi), ryhmän **budjetti** luetaan `GroupBudget`ista. Erotus € ja % lasketaan näistä.
- Tilikohtaiset näkymät (Kulut tileittäin/ryhmittäin, Tulot) **eivät** lue `groupBudgets`ia → summat pysyvät oikeina.

**Vaihtoehto B — laajenna Budjetti vs. toteuma toimimaan ryhmätasolla nykydatalla:** jos tilikohtaisia budjetteja ei ole mutta ryhmätoteumat saadaan summattua, ja budjetti tuodaan erillään — arvioi onko tämä siistimpi kuin A. Todennäköisesti A on selkein; perustele valintasi.

Suunnitelmassa: valittu malli, miten Budjetti vs. toteuma -näkymä muuttuu (ryhmätaso: sarakkeet Ryhmä, Budjetti, Toteuma, Erotus €, Erotus % — Budjetti ennen Toteumaa, kuten §6.4), miten vuosivalinta toimii (mitkä vuodet vertailukelpoisia = ryhmätoteuma + GroupBudget samalle vuodelle), tuonti (uusi "Liitä ryhmäbudjetti" vai laajennus olemassa olevaan?), ja kulut-vs-tulot-etumerkkitulkinta (kulut tallentuvat negatiivisina — sama |actual| vs |budget| -logiikka kuin nykyisessä buildBudgetVsActualViewModelissa).

## 2. Tuontiformaatti (ehdotus, vahvista suunnitelmassa)

Sama tiukka liitä-malli kuin muuallakin. Ehdotus tab-eroteltu:
```
kind<TAB>ryhmä<TAB>vuosi<TAB>budjetti<TAB>toteuma
```
tai jos toteuma johdetaan tileistä automaattisesti, pelkkä budjetti riittää:
```
kind<TAB>ryhmä<TAB>vuosi<TAB>budjetti
```
Suositus: jälkimmäinen (toteuma johdetaan tilidatasta, ei syötetä kahdesti). Tiukka validointi + esikatselu kuten muut tuonnit. Tähän tulee myöhemmin oma ChatGPT-ohjeensa.

Käyttäjän ryhmäbudjettidata (Excelin Budjettitarkkuus) on saatavilla vuosille 2023/2024/2025, ryhmät esim.: Henkilöstökulut, Hallintopalvelut, Käyttö- ja huoltopalvelut, Ulkoalueiden hoitopalvelut, Vesi- ja jätevesi, Sähkö, Jätehuolto, Vahinkovakuutukset, Kiinteistövero, Korjaukset; tulot: Hoitovastikkeet, Vuokrat (autopaikat), Muut tuotot. **Ryhmänimien on täsmättävä tilidatan ryhmänimiin** jotta toteuma yhdistyy oikein — huomioi tämä (mäppäys tai validointi joka varoittaa jos ryhmänimi ei täsmää mihinkään tiliryhmään).

## 3. Rajaus

Ei kosketa auth/JWKS/Cloudflare/Hyperdrive-polkuja. Jos lisäät kokoelman, ainoa DB-kosketus on `withDefaultedAdminCollections` (ei migraatioita). Ei jsdomia/frameworkia. Säilytä kaikki nykyiset näkymät toimivina. Kulut tileittäin/ryhmittäin ja Tulot **eivät saa muuttua** (niiden summat pysyvät tilikohtaisina).

## 4. Testit

- Uuden entiteetin validointi + payload + jäsennin (tiukka, rivikohtaiset virheet).
- `withDefaultedAdminCollections`-regressio (vanha snapshot ilman uutta kenttää → ei kaadu).
- Ryhmätason Budjetti vs. toteuma: ryhmätoteuma summautuu tileistä oikein; erotus € = toteuma − budjetti; erotus % budjetti 0 → "—"; kulut vs. tulot -etumerkki oikein.
- Vertailuvuodet: vuosi mukaan vain jos ryhmällä on sekä toteumaa (tileistä) että GroupBudget.
- Tilikohtaiset näkymät eivät muutu (regressio: Kulut ryhmittäin -summat samat kuin ennen).

## 5. Työskentelytapa

1. Branch **`feature/group-budget`** tuoreesta mainista.
2. **Suunnitelma ensin, ei koodia.** Odota hyväksyntää (erityisesti tietomallivalinta A vs. B).
3. Committoi handoff ensimmäisenä. Pieniä committeja, testit joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen (liitä ryhmäbudjetti → Budjetti vs. toteuma näyttää ryhmävertailun; tilikohtaiset näkymät ennallaan).
5. **Luo PR** (base main). **Älä mergeä.**

## 6. Riippuvuus

Tämä on riippumaton tase-etumerkkikorjauksesta (`fix/balance-sheet-sign`) — voidaan tehdä ennen tai jälkeen. Jos molemmat auki yhtä aikaa, tee ne eri brancheissa mainista.

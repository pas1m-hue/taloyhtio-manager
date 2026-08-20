# Claude Code -tehtävä: Taloyhtiö Manager, UI-vaihe 4B (tase: vertailu, täsmäytys, tunnusluvut)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä prompt on itsenäinen. Vaiheet 1, 2A, 2B-1, 2B-2, 3A, 3B, 4A on toteutettu ja **mergattu mainiin**. Tämä on **vaihe 4B** — taseen viimeistely ja projektin viimeinen suunniteltu vaihe: kahden snapshotin vertailu, taseen täsmäytys, ja tunnusluvut.

## 0\. Lue ensin

Lähdedokumentit (repossa `docs/product-spec/`):

* `taloyhtio-manager-ui-ja-logiikka-spec.md` — §6.5 (Taloudellinen asema: "vertailee kahta tasesnapshotia"; näytettävät: pysyvät/vaihtuvat vastaavat, oma pääoma, velat, taseen täsmäytys, maksuvalmius, kassa kuukausina hoitokuluja, korollinen vieras pääoma).
* `taloyhtio\_terminaali.xlsx` — välilehti Taloudellinen asema (kaksi päivämäärää 31.12.2024 / 31.12.2025 — vertailun lähdemuoto).

Lue myös 4A:n tuotos, jonka päälle tämä rakentuu: `public/adminOperationPayloads.js` (`buildBalanceSheetViewModel`, `BALANCE\_SECTIONS`, section-mäppäys), `public/app.js` (`renderBalancePosition`, snapshot-valinta, Taloudellinen asema -näkymä), `src/readModels/adminDashboard.ts` (tarjoaa `balanceSheetSnapshots` JA `latestLiquidityBaseline`), `public/viewWiring.test.js`.

## 1\. Nykyinen toimiva tila — älä riko näitä

Mainissa on seitsemän valmista vaihetta. **4B on puhdas UI-vaihe:** se lukee `balanceSheetSnapshots` (4A) ja `latestLiquidityBaseline` (jo olemassa) ja lisää vertailun, täsmäytyksen ja tunnusluvut Taloudellinen asema -näkymään. **Ei uusia domain-tyyppejä, ei uusia admin-operaatioita, ei read-model-muutoksia, ei tietokantaa, ei migraatioita.** Pelkkää näkymälogiikkaa + laskentaa + testejä.

Älä muuta auth-, JWKS-, Cloudflare-, Hyperdrive- tai tietokantapolkuja. Ei jsdomia, Playwrightia, frameworkia, bundleria. Vanilla HTML/CSS/JS. UI-kieli suomi. **Säilytä 4A:n yhden snapshotin näkymä toimivana** — 4B laajentaa sitä, ei korvaa.

## 2\. Työskentelytapa

1. Luo branch **`feature/ui-balance-sheet-ratios`** tuoreesta mainista (`git checkout main \&\& git pull` ensin).
2. Ensimmäisessä vastauksessasi **älä koodaa** — palauta toteutussuunnitelma ja odota hyväksyntää.
3. Toteuta pieninä committeina. Aja `npm run typecheck` + `npm test` jokaisen jälkeen, lopuksi `npm run build:worker`.
4. Committoi tämä handoff (`docs/claude-code-handoff-ui-vaihe-4b.md`) branchin ensimmäisenä committina.

## 3\. Tehtävän rajaus: kolme lisäystä Taloudellinen asema -näkymään

Kaikki laskennat johdetaan olemassa olevasta datasta; mitään ei syötetä.

### 3.1 Kahden snapshotin vertailu

* Näkymään **toinen snapshot-valitsin** ("vertaa snapshotiin"): valitse vertailtava tase (esim. edellinen tilinpäätöspäivä). Oletus: toiseksi viimeisin snapshot jos useita; jos vain yksi snapshot, vertailu on pois käytöstä (näytä vain yksi snapshot kuten 4A).
* Kun kaksi snapshotia valittu: näytä erät **rinnakkain** molemmilta päivämääriltä + **Muutos €** -sarake (uudempi − vanhempi, esitettynä johdonmukaisesti positiivisuus-säännön kanssa — ks. alla).
* Osiosummat ja ylätason summat molemmille + niiden muutos.
* Erä joka on vain toisessa snapshotissa → toinen sarake tyhjä/"—", muutos = koko arvo.
* **Positiivisuus:** kaikki tasesummat näytetään positiivisina (`Math.abs`, 4A:n sääntö). Muutos lasketaan positiivisiksi normalisoiduista arvoista, ja sen etumerkki (kasvoi/laski) on merkityksellinen — näytä + tai − muutokselle.

### 3.2 Taseen täsmäytys

* Laske valitulle (uudemmalle) snapshotille: **VARAT − (OMA PÄÄOMA + VELAT)**.
* Näytä täsmäytysrivi/-kortti: jos `|erotus| < 0.01` → vihreä "Tase täsmää" (tai vastaava). Muuten → punainen/varoitus, näytä erotuksen suuruus (auttaa löytämään syöttövirheen).
* Pieni pyöristystoleranssi (esim. 0.01 €) — tilinpäätöksissä on usein sentin pyöristyseroja.
* Näytä molemmille snapshoteille jos vertailu käytössä, tai vähintään valitulle.

### 3.3 Tunnusluvut (kolme)

Laske valitulle (uudemmalle) snapshotille, näytä KPI-kortteina:

1. **Maksuvalmius** = vaihtuvat vastaavat (current\_assets-summa) / velat (liabilities-summa).

   * **Vahvistettu yksinkertaistus:** käytä koko `liabilities`-summaa jakajana (ei erillistä "lyhytaikaiset velat" -erottelua — mallissa on yksi velkaosio). Merkitse tarvittaessa että se on koko velkakanta.
   * Jos velat = 0 → näytä "—" (ei jakoa nollalla).
2. **Kassa kuukausina hoitokuluja** = rahat ja pankkisaamiset / kuukausittaiset hoitokulut.

   * Osoittaja: "Rahat ja pankkisaamiset" -erä (etsi current\_assets-osiosta; jos erän tunnistus epävarma, käytä koko current\_assets-summaa ja dokumentoi valinta).
   * **Jakaja (vahvistettu):** `latestLiquidityBaseline.trailing12mOperatingCosts / 12` (12 kk hoitokulut → kuukausitaso). Tämä luku on jo read-modelissa.
   * Jos `latestLiquidityBaseline` puuttuu tai `trailing12mOperatingCosts` = 0 → näytä "—" ja huomio "vaatii likviditeetin lähtötiedon". **Huom:** tämä luku on tuotannossa tällä hetkellä PAIKKAMERKKI (34 029,46 €) — tunnusluku on siis suuntaa-antava kunnes oikea 12 kk hoitokulu on syötetty. Voit näyttää pienen huomautuksen tästä jos paikkamerkki on tunnistettavissa (esim. baseline.notes sisältää "PLACEHOLDER"), muuten ei pakollista.
3. **Korollinen vieras pääoma** = korolliset velat.

   * **Vahvistettu yksinkertaistus:** käytä koko `liabilities`-summaa (ei erillistä korollisuus-erottelua). Merkitse että se on koko velkakanta.

Kaikki tunnusluvut valitulta snapshotilta; jos vertailu käytössä, voit näyttää myös vertailu-snapshotin arvon ja muutoksen (valinnainen, mutta hyödyllinen).

## 4\. Toteutus

* Laajenna `buildBalanceSheetViewModel` tai lisää uudet puhtaat funktiot `public/adminOperationPayloads.js`:ään (testattavat ilman DOMia):

  * `buildBalanceComparisonViewModel(newerSnapshot, olderSnapshot)` → erät rinnakkain + muutokset + osiosummat.
  * `computeBalanceReconciliation(snapshot)` → { assets, equityPlusLiabilities, difference, balances: boolean }.
  * `computeBalanceRatios(snapshot, latestLiquidityBaseline)` → { liquidity, monthsOfCash, interestBearingDebt } (kukin numero tai null jos ei laskettavissa).
* Renderöi `public/app.js`:ssä `renderBalancePosition`iä laajentaen: toinen snapshot-valitsin, vertailutaulukko, täsmäytyskortti, tunnusluku-KPI:t. Säilytä yhden snapshotin näkymä kun vertailua ei ole valittu.

## 5\. Testit

`public/adminOperationPayloads.test.js`:

* `computeBalanceReconciliation`: täsmäävä tase (ero < 0.01) → balances true; epätasapainoinen → false + oikea erotus; pyöristystoleranssi (ero 0.005 → täsmää).
* `computeBalanceRatios`: maksuvalmius = vaihtuvat/velat oikein; **velat = 0 → null (ei jakoa nollalla)**; kassa kuukausina = rahat / (trailing12m/12) oikein; **baseline puuttuu → monthsOfCash null**; korollinen vieras pääoma = velkasumma.
* `buildBalanceComparisonViewModel`: erät rinnakkain, muutos = uudempi − vanhempi; erä vain toisessa → toinen "—" + muutos koko arvo; positiiviset arvot; osiosummien muutokset.
* Reunatapaukset: vain yksi snapshot → vertailu ei kaadu (palauta yhden snapshotin muoto tai tyhjä vertailu).

`public/viewWiring.test.js`: toisen snapshot-valitsimen id + vertailun kytkennät ristiintarkistuksiin.

DOM-käyttäytyminen (toisen snapshotin valinta, vertailun näyttö/piilotus) → manuaaliset testipolut PR-kuvaukseen. Ei jsdomia.

## 6\. Valmis lopputulos — raportoi

Commit-lista, muutetut tiedostot, testitulokset, kolmen lisäyksen toteutus (vertailu, täsmäytys, tunnusluvut), tunnuslukujen kaavat + jakajien lähteet, velkojen yksinkertaistus (koko liabilities-summa), nollalla jaon reunatapaukset, paikkamerkki-huomio kassa-kuukausina-luvusta, automaattiset vs. manuaaliset testipolut, poikkeamat. **Luo PR** (base main). **Älä mergeä.**

## 7\. Tämän jälkeen

Tämä on projektin viimeinen suunniteltu toteutusvaihe. 4B:n jälkeen sovellus kattaa koko toiminnallisuuden: kunnossapito (rakennusosat, havainnot, kustannusnäytöt, korjaustapahtumat, lifecycle-skenaariot, kassapolku), talous (tulot, kulut tileittäin/ryhmittäin, budjetti vs. toteuma), ja tase (asema, vertailu, täsmäytys, tunnusluvut). Seuraava luonteva askel käyttäjälle on **oikean historiallisen datan syöttö** (2023–2025 tilinpäätökset + taseet) tuontinäkymien kautta, ei uutta koodia.


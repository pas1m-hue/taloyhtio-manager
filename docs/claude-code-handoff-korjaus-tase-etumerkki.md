# Claude Code -tehtävä: KORJAUS — taseen Math.abs vääristää negatiiviset erät

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä on **bugikorjaus**, ei uusi ominaisuus. Kaikki vaiheet 1–4B on mergattu mainiin, ja sovelluksessa on oikeaa dataa. Live-testissä oikealla taseella löytyi bugi.

## 0. Oire (havaittu tuotannossa oikealla datalla)

31.12.2024-tase näyttää Taloudellinen asema -näkymässä **"Tase ei täsmää — erotus −9 472,32 €"**, vaikka tase oikeasti täsmää (Excelin täsmäytys ~0). 31.12.2025-tase täsmää oikein.

## 1. Juurisyy (jäljitetty koodista)

`buildBalanceSheetViewModel` (`public/adminOperationPayloads.js`, n. rivi 2728) soveltaa `Math.abs`ia **jokaiseen tase-erään sokeasti**:

```js
amount: Math.abs(Number(entry.amount ?? 0)),
```

Tämä on väärin erille jotka voivat olla **aidosti negatiivisia**. Konkreettinen tapaus: "Kertyneet voittovarat" oli 31.12.2024 **−4 736,16 €** (kertynyt tappio). `Math.abs` muuttaa sen +4 736,16 €:ksi. Oman pääoman summa kasvaa siksi 2 × 4 736,16 = **9 472,32 €** liikaa, ja täsmäytys (VARAT − (OMA PÄÄOMA + VELAT)) menee −9 472,32 € pieleen. 2025 ei paljastanut bugia koska sen voittovarat oli jo positiivinen (+437,58 €).

**Vaikutusketju:** `assetsTotal` ja `equityAndLiabilitiesTotal` lasketaan näistä `Math.abs`-arvoista, ja `computeBalanceReconciliation` + `computeBalanceRatios` + `buildBalanceComparisonViewModel` nojaavat samoihin summiin. Yksi korjaus view-modelin muodostukseen korjaa koko ketjun.

**Miksi Math.abs alun perin lisättiin:** speksin sääntö "taseen summat esitetään UI:ssa positiivisina, vaikka lähdejärjestelmän etumerkkikäytäntö poikkeaisi". Tavoite oli oikea (varat/velat halutaan näyttää positiivisina vaikka lähde merkitsisi velat miinuksella), mutta toteutus on liian karkea: se murskaa myös aidosti negatiiviset erät joiden etumerkki on merkityksellistä tietoa.

## 2. Tehtävän rajaus

**Korjaa vain tämä etumerkkiongelma.** Ei uusia ominaisuuksia, ei tietomallimuutoksia, ei muita näkymiä. Puhdas korjaus + testit.

## 3. Vaadittu korjaus (suunnittele tarkka toteutus, mutta noudata tätä periaatetta)

**Ongelma on käsitteellinen:** "näytä positiivisena" ei saa tarkoittaa "ota itseisarvo". Oikea tulkinta speksin säännölle: **normalisoi lähdejärjestelmän etumerkkikäytäntö johdonmukaiseksi, mutta säilytä aito negatiivisuus siellä missä se on todellista tietoa** (kertynyt tappio, negatiivinen oma pääoma).

Suositeltu lähestymistapa — **säilytä erän todellinen etumerkki tallennus- ja laskentatasolla, poista sokea `Math.abs` view-modelin `amount`-kentästä:**

- Muuta rivi ~2728 niin, että `amount` **säilyttää etumerkkinsä**: `amount: Number(entry.amount ?? 0)` (ilman `Math.abs`). Tällöin osiosummat, ylätason summat, täsmäytys ja tunnusluvut laskevat oikein negatiivistenkin erien kanssa. Tämä yksin korjaa täsmäytysbugin.
- **Näyttö (UI, `renderBalancePosition` app.js:ssä):** jos halutaan yhä esittää useimmat luvut ilman turhia miinuksia, tee se **näyttötasolla** ja vain siellä missä se on oikein. **Turvallisin ja rehellisin ratkaisu: näytä kaikki erät todellisella etumerkillään** (negatiivinen voittovara näkyy miinuksena, kuten tilinpäätöksessä). Tämä on läpinäkyvin. Jos kuitenkin haluat säilyttää positiivisen esitystavan varoille/veloille, älä tee sitä `Math.abs`illa koko datalle vaan harkitusti — mutta **oletusehdotus on: näytä todelliset etumerkit**, koska se vastaa tilinpäätöstä ja estää tämän bugiluokan kokonaan.
- **Älä** siirrä `Math.abs`ia muualle niin että ongelma vain siirtyy (esim. täsmäytykseen tai vertailuun). Etumerkin on säilyttävä läpi koko laskennan.

**Vahvista suunnitelmassa** kumpi näyttötapa valitaan (todelliset etumerkit kaikkialla — suositus — vai positiivisuus vain varoille/veloille), ja perustele. Kerro myös vaikutus vertailunäkymään (`buildBalanceComparisonViewModel`) ja tunnuslukuihin (maksuvalmius jne. — nämä eivät saa mennä pieleen etumerkin muuttuessa; tarkista että esim. current_assets-summa pysyy oikeana).

## 4. Testit (kriittinen — tämä bugiluokka ei saa toistua)

`public/adminOperationPayloads.test.js`:
- **Regressiotesti joka olisi napannut tämän:** tase jossa "Kertyneet voittovarat" = −4 736,16 (ja muut erät kuten oikeassa 2024-datassa) → `computeBalanceReconciliation(...).balances === true` (täsmää). Tämä testi **epäonnistuu ennen korjausta, onnistuu korjauksen jälkeen** — varmista molemmat suunnat.
- `buildBalanceSheetViewModel`: negatiivinen erä säilyttää etumerkkinsä summissa; osiosumma ja ylätason summa laskevat oikein negatiivisen erän kanssa.
- `computeBalanceRatios`: maksuvalmius ja kassa-kk pysyvät oikein kun jokin oman pääoman erä on negatiivinen (varat/velat eivät saa vääristyä).
- `buildBalanceComparisonViewModel`: muutos-sarake laskee oikein kun erä on negatiivinen toisessa snapshotissa (esim. voittovarat −4 736,16 → +437,58, muutos +5 173,74 €).
- Käytä oikeita 2024/2025-lukuja testidatana (ne ovat tiedossa: 2024 voittovarat −4 736,16, 2025 +437,58; varat 2024 = 1 749 678,88, oma pääoma 2024 = 1 747 183,49, velat 2024 = 2 495,39).

`npm run typecheck` + `npm test` jokaisen commitin jälkeen, lopuksi `npm run build:worker`.

## 5. Työskentelytapa

1. Branch **`fix/balance-sheet-sign`** tuoreesta mainista (`git checkout main && git pull`).
2. Ensimmäisessä vastauksessa **suunnitelma, ei koodia** — erityisesti §3:n näyttötapa-valinta perusteltuna. Odota hyväksyntää.
3. Committoi tämä handoff (`docs/claude-code-handoff-korjaus-tase-etumerkki.md`) ensimmäisenä.
4. Pieniä committeja, testit jokaisen jälkeen.
5. **Manuaalinen live-testipolku PR-kuvaukseen:** lataa työtila, Taloudellinen asema → valitse 2024-tase → täsmäytyksen pitää näyttää vihreä "Tase täsmää" (ei enää −9 472,32 €). Tarkista myös että 2025 yhä täsmää ja tunnusluvut ovat järkeviä.
6. **Luo PR** (base main). **Älä mergeä.**

## 6. Live-testin varmistus (mitä käyttäjä tarkistaa ennen mergeä)

Tuotannossa on jo oikea data (2024- ja 2025-taseet). Korjauksen jälkeen 2024-taseen täsmäytyksen pitää muuttua punaisesta vihreäksi, ja 2024 "Kertyneet voittovarat" pitää näkyä oikein (−4 736,16 € todellisella etumerkillä, tai valitun näyttötavan mukaan). VARAT-, OMA PÄÄOMA- ja VELAT-summien pitää täsmätä Exceliin: 2024 VARAT 1 749 678,88 · OMA PÄÄOMA 1 747 183,49 · VELAT 2 495,39.

# Claude Code -tehtävä: Taloyhtiö Manager, UI-vaihe 4A (Taloudellinen asema — tase, malli + tuonti + perusnäkymä)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä prompt on itsenäinen. Vaiheet 1, 2A, 2B-1, 2B-2, 3A, 3B on toteutettu ja **mergattu mainiin**. Tämä on **vaihe 4A**: taseen tietomalli, "liitä tasedata" -tuonti, ja Taloudellinen asema -perusnäkymä (yksi snapshot osioittain summineen). Kahden snapshotin vertailu + tunnusluvut tulevat erikseen vaihe 4B:ssä.

## 0\. Lue ensin

Lähdedokumentit (repossa `docs/product-spec/`):

* `taloyhtio-manager-ui-ja-logiikka-spec.md` — §6.5 (Taloudellinen asema), §11 (BalanceSheetSnapshot + BalanceEntry -ehdotus, rivit 490–500), §12 vaihe 4.
* `taloyhtio\_terminaali.xlsx` — välilehti **Taloudellinen asema** (lähdeaineistoa; kertoo rakenteen).

Lue myös 3A:n tuotos, jonka kuviota tämä seuraa: `public/adminOperationPayloads.js` (talous-view-modelit, `parseFinancialPasteInput`-jäsennin, tuonnin rakennus), `public/app.js` (Liitä tilidataa -näkymä, Kulut tileittäin, `renderFinancePlaceholders`), `src/domain/types.ts` (FinancialAccount/FinancialEntry lisättiin tänne; ADMIN\_ENTITY\_TYPES, AdminDataOperation-unioni, AdminDataSnapshot, `withDefaultedAdminCollections`), `src/admin/adminDataValidation.ts`, `src/admin/applyAdminBatch.ts`, `src/database/postgresPublishingRepository.ts` (huom `withDefaultedAdminCollections` — uudet kokoelmakentät on lisättävä sinne oletusarvoistukseen!), `src/readModels/adminDashboard.ts`, `public/viewWiring.test.js`.

## 1\. Nykyinen toimiva tila — älä riko näitä

Mainissa on kuusi valmista vaihetta. Admin-data on **yksi JSONB-snapshot** → ei SQL-migraatioita. Uudet tase-tyypit menevät samaan snapshotiin uutena kokoelmakenttänä.

**KRIITTINEN — opittu vaihe 3A:sta:** kun lisäät uuden kokoelmakentän `AdminDataSnapshot`iin, se **täytyy** lisätä myös `withDefaultedAdminCollections()`-funktioon (`src/database/postgresPublishingRepository.ts`), joka oletusarvoistaa puuttuvat kentät `\[]`:ksi vanhoja tallennettuja snapshotteja luettaessa. Muuten tuotannon vanha snapshot (jossa uutta kenttää ei ole) kaataa työtilan latauksen (`values is not iterable`). Tämä bugi löytyi 3A:ssa live-testissä — älä toista sitä. Lisää `balanceSheetSnapshots` (tms.) sekä snapshot-tyyppiin ETTÄ oletusarvoistukseen samassa committissa, ja kata se testillä.

Älä muuta auth-, JWKS-, Cloudflare-, Hyperdrive-, migraatio- tai käyttöoikeuspolkuja. Ei jsdomia, Playwrightia, frameworkia, bundleria. Vanilla HTML/CSS/JS. UI-kieli suomi. Säilytä 3A/3B:n talousnäkymät ennallaan.

## 2\. Työskentelytapa

1. Luo branch **`feature/ui-balance-sheet`** tuoreesta mainista (`git checkout main \&\& git pull` ensin).
2. Ensimmäisessä vastauksessasi **älä koodaa** — palauta toteutussuunnitelma ja odota hyväksyntää.
3. Toteuta pieninä committeina. Aja `npm run typecheck` + `npm test` jokaisen jälkeen, lopuksi `npm run build:worker`.
4. Committoi tämä handoff (`docs/claude-code-handoff-ui-vaihe-4a.md`) branchin ensimmäisenä committina.

## 3\. Tehtävän rajaus: VAIN vaihe 4A

Toteutettavat asiat:

1. **Domain-tyypit** `BalanceSheetSnapshot` + `BalanceEntry` + admin-operaatio `save\_balance\_sheet\_snapshot` + validointi.
2. **Snapshot-kentän oletusarvoistus** `withDefaultedAdminCollections`iin (ks. §1 kriittinen huomio).
3. **Read-model-laajennus**: `balanceSheetSnapshots` mukaan `AdminDashboardReadModel`iin.
4. **"Liitä tasedata" -tuontinäkymä**: tekstialue → tiukka jäsennys → esikatselu → tallennus (sama kuvio kuin 3A:n Liitä tilidataa).
5. **Taloudellinen asema -perusnäkymä**: näyttää **yhden** snapshotin osioittain (VARAT/OMA PÄÄOMA/VELAT), erät + osiosummat, kaikki summat **positiivisina**. Snapshotin valinta pudotusvalikosta jos useita.

**EI tässä vaiheessa (4B):** kahden snapshotin vertailu (muutos-sarake), täsmäytystarkistus, tunnusluvut (maksuvalmius, kassa kuukausina, korollinen vieras pääoma). Nämä ovat 4B. Tässä vaiheessa näkymä esittää yhden valitun snapshotin.

## 4\. Domain-malli (speksin §11 mukaan)

**`BalanceSheetSnapshot`** (tase yhtenä päivänä):

* `id: string` — uniikki tunniste (esim. "balance\_2025")
* `asOfDate: string` — tilinpäätöspäivä (esim. "2025-12-31")
* `sourceIds: readonly string\[]` — ei-tyhjä
* `entries: readonly BalanceEntry\[]` — ei-tyhjä
* `notes?: string`

**`BalanceEntry`** (yksi tase-erä):

* `section: BalanceSection` — osio (ks. alla)
* `key: string` — erän tunniste (esim. "rahat\_ja\_pankkisaamiset")
* `name: string` — erän nimi (esim. "Rahat ja pankkisaamiset")
* `amount: number` — euromäärä, **säilytä sellaisenaan** (tallennus); näyttö positiivisena on näkymän vastuulla
* `notes?: string`

**`BalanceSection`** (osiot Excelin rakenteen mukaan — vahvista Excelistä):

* Pysyvät vastaavat, Vaihtuvat vastaavat (→ VARAT)
* Sidottu oma pääoma, Vapaa oma pääoma (→ OMA PÄÄOMA)
* Velat
* Ehdotus: käytä enum-tyyppisiä avaimia (esim. `fixed\_assets`, `current\_assets`, `restricted\_equity`, `unrestricted\_equity`, `liabilities`) + ryhmittele ylätasoihin (VARAT/OMA PÄÄOMA JA VELAT) näkymässä. Dokumentoi valinta.

Lisää `AdminDataSnapshot`iin `balanceSheetSnapshots: readonly BalanceSheetSnapshot\[]`, `AdminDataOperation`-unioniin `save\_balance\_sheet\_snapshot`, `ADMIN\_ENTITY\_TYPES`iin `balance\_sheet\_snapshot`, ja **`withDefaultedAdminCollections`iin oletusarvo `\[]`** (§1).

**Validointi:** id ei-tyhjä ja uniikki, asOfDate kelvollinen päivä, sourceIds ei-tyhjä, entries ei-tyhjä; jokainen entry: section ∈ sallitut, key + name ei-tyhjä, amount äärellinen luku. (Täsmäytys ei ole validointiehto tässä — tase voi olla epätasapainossa syöttövirheen takia, ja se on 4B:n täsmäytysnäytön tehtävä paljastaa, ei validoinnin hylätä.)

## 5\. Tuonti: "Liitä tasedata" (sama malli kuin 3A)

Uusi näkymä, sama kuvio kuin Liitä tilidataa. Tab-eroteltu, yksi rivi per erä per päivämäärä — TAI yksi snapshot kerrallaan (yksi asOfDate per liitos). **Suositus:** yksi snapshot per liitos (yksinkertaisempi kuin monta päivämäärää sekaisin). Formaatti:

```
section<TAB>key<TAB>name<TAB>amount
```

* Snapshotin `asOfDate` + `id` annetaan näkymän omissa kentissä (ei joka rivillä).
* `section`: sallittu osioarvo (suomeksi tai avaimena — päätä ja dokumentoi; suositus: suomenkielinen osionimi joka mäpätään enum-arvoon, esim. "Vaihtuvat vastaavat").
* `amount`: euromäärä, piste tai pilkku desimaalierottimena; **säilytä etumerkki** (Excelissä tase on jo positiivisina, mutta jos lähteessä on negatiivisia, älä käännä — näyttö hoitaa positiivisuuden).
* Otsikkorivi tunnistetaan ja ohitetaan.
* **Tiukka validointi + esikatselu** kuten 3A: väärä sarakemäärä, tuntematon section, ei-numeerinen amount → rivikohtainen virhe rivinumeroin. Esikatselu näyttää montako erää + osiosummat ennen tallennusta. Tallennus disabloitu jos virheitä.
* Tallennus: `save\_balance\_sheet\_snapshot`-operaatio, sendAdminOperations-polku, expectedRevision/409.

Puhdas jäsennin `parseBalanceSheetPasteInput(rawText, { id, asOfDate })` → { snapshot, errors\[] } `adminOperationPayloads.js`:ään, testattava ilman DOMia.

## 6\. Taloudellinen asema -perusnäkymä (§6.5, vain yksi snapshot 4A:ssa)

Korvaa nykyinen placeholder. Näyttää valitun snapshotin:

* **Snapshot-valinta**: pudotusvalikko asOfDaten mukaan jos useita; oletus viimeisin.
* **Osioittain ryhmiteltynä**: VARAT (Pysyvät + Vaihtuvat vastaavat) / OMA PÄÄOMA (Sidottu + Vapaa) / VELAT. Erät osion alla, osiosummat + ylätason summat (VARAT YHTEENSÄ, OMA PÄÄOMA JA VELAT YHTEENSÄ).
* **Kaikki summat positiivisina** (speksin sääntö): `Math.abs` näytössä, riippumatta tallennetusta etumerkistä.
* Suomalainen lukumuotoilu, tyhjä tila ("Ei vielä tasedataa. Tuo se Liitä tasedata -näkymästä.").
* **EI vielä** muutos-saraketta, täsmäytystä, tunnuslukuja (4B).

Puhdas view-model `buildBalanceSheetViewModel(snapshot)` → osiot + summat, `adminOperationPayloads.js`:ään.

## 7\. Testit

`public/adminOperationPayloads.test.js`:

* BalanceSheetSnapshot payload + validointi (tuntematon section, tyhjä entries, ei-numeerinen amount, tyhjä sourceIds, ei-uniikki id).
* `parseBalanceSheetPasteInput`: kelvollinen → oikea snapshot; otsikkorivin ohitus; pilkku/piste; virhesyötteet rivinumeroin; tuntematon section.
* `buildBalanceSheetViewModel`: osioittainen ryhmittely, osiosummat, ylätason summat, positiiviset arvot (myös jos syöte negatiivinen).
* Rakennettu operaatio `applyAdminBatch`in läpi test-snapshotissa → validoituu.

`src/database/postgresPersistence.test.ts` (tai vastaava): **vanha snapshot ilman `balanceSheetSnapshots`-kenttää → `withDefaultedAdminCollections` oletusarvoistaa `\[]`, ei kaadu** (§1 — sama kuvio kuin 3A:n regressiotesti).

`public/viewWiring.test.js`: uudet näkymä-id:t + tuonnin napit + snapshot-valinta ristiintarkistuksiin.

## 8\. Valmis lopputulos — raportoi

Commit-lista, muutetut tiedostot, testitulokset, tuontijäsentimen formaatti, section-enum-valinnat, positiivisuus-näyttö, `withDefaultedAdminCollections`-lisäys + sen testi, automaattiset vs. manuaaliset testipolut, poikkeamat. **Luo PR** (base main). **Älä mergeä.**

## 9\. Ulkopuolelle (vaihe 4B)

* **Kahden snapshotin vertailu**: Muutos-sarake (2024→2025), sarakkeet päivämäärittäin rinnakkain.
* **Täsmäytys**: VARAT − (OMA PÄÄOMA + VELAT) ≈ 0, näytä tarkistuksena (vihreä/punainen, pieni pyöristystoleranssi esim. |erotus| < 0.01).
* **Tunnusluvut**: Maksuvalmius (vaihtuvat vastaavat / lyhytaikaiset velat), **Kassa kuukausina hoitokuluja** (rahat ja pankkisaamiset / kuukausittaiset hoitokulut — huom: `LiquidityBaseline.trailing12mOperatingCosts` on jo olemassa ja voi toimia jakajana, /12 kuukausitasolle), Korollinen vieras pääoma. Näiden jakajien lähde (tase-erä vs. liquidity-data) päätetään 4B:n suunnittelussa.

Handoff 4B tehdään kun 4A on valmis ja testattu.


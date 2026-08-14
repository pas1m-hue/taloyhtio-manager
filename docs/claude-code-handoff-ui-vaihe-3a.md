# Claude Code -tehtävä: Taloyhtiö Manager, UI-vaihe 3A (talousmalli + datan tuonti)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä prompt on itsenäinen. Vaiheet 1, 2A, 2B-1, 2B-2 on toteutettu ja **mergattu mainiin**, ja seed on ajettu (tuotannossa dataa, adminRevision ≥ 5). Tämä on **vaihe 3A**: tilikohtainen talousmalli, "liitä tilikohtainen data" -tuontinäkymä, ja Kulut tileittäin -näkymä.

## 0. Lue ensin

Lähdedokumentit (repossa `docs/product-spec/`):
- `taloyhtio-manager-ui-ja-logiikka-spec.md` — erityisesti §6 (Talous-näkymät, rivit 162–260) ja §11 tietomalliehdotus (rivit 471–500: FinancialAccount, FinancialEntry)
- `taloyhtio_terminaali.xlsx` — välilehdet **Kulut tileittäin**, **Tulot** (lähdeaineistoa; kertoo datan rakenteen)

Lue myös: `src/domain/types.ts` (erityisesti nykyinen `FinancialYear`, `AdminDataOperation`-unioni, `AdminDataSnapshot`, `AdminDashboardReadModel`), `src/admin/adminDataValidation.ts`, `src/admin/applyAdminBatch.ts`, `src/readModels/adminDashboard.ts`, `public/adminOperationPayloads.js`, `public/app.js`, `public/index.html`, `public/viewWiring.test.js`.

## 1. Nykyinen toimiva tila — älä riko näitä

Mainissa on neljä valmista vaihetta. **KRIITTINEN ARKKITEHTUURIHAVAINTO:** admin-data tallennetaan **yhtenä JSONB-snapshotina** (`tm_admin_snapshots.payload`), EI erillisinä relaatiotauluina per entiteetti. **Vaihe 3A ei siis tarvitse SQL-migraatioita** — uudet talousmallin tyypit menevät samaan JSON-snapshotiin uusina kenttinä, täsmälleen kuten 2A/2B lisäsivät omansa. **Älä koske** `src/database/migrations/`-tiedostoihin, äläkä auth-, JWKS-, Cloudflare- tai Hyperdrive-polkuihin. Ei jsdomia, Playwrightia, frameworkia, bundleria. Vanilla HTML/CSS/JS. UI-kieli suomi.

## 2. Työskentelytapa

1. Luo branch **`feature/ui-finance-model`** tuoreesta mainista (`git checkout main && git pull` ensin).
2. Ensimmäisessä vastauksessasi **älä koodaa** — palauta toteutussuunnitelma ja odota hyväksyntää.
3. Toteuta pieninä committeina. Aja `npm run typecheck` + `npm test` jokaisen jälkeen, lopuksi `npm run build:worker`.
4. Committoi tämä handoff (`docs/claude-code-handoff-ui-vaihe-3a.md`) branchin ensimmäisenä committina.
5. Ei salaisuuksia committeihin.

## 3. Tehtävän rajaus: VAIN vaihe 3A

Toteutettavat asiat:
1. **Domain-tyypit** `FinancialAccount` + `FinancialEntry` + admin-operaatiot `save_financial_account`, `save_financial_entry` + validointi.
2. **Read-model-laajennus**: talousmallin data mukaan `AdminDashboardReadModel`iin.
3. **"Liitä tilikohtainen data" -tuontinäkymä**: tekstialue → tiukka jäsennys → esikatselu → tallennus batchina.
4. **Kulut tileittäin -näkymä**: näyttää syötetyn kulu-datan taulukkona, ryhmiteltynä.

**EI tässä vaiheessa** (vaihe 3B / 4): Tulot-, Kulut ryhmittäin-, Budjetti vs. toteuma -näkymät; Taloudellinen asema / tase (BalanceSheetSnapshot). Nämä näkymät jäävät toistaiseksi placeholdereiksi 3B:tä varten.

## 4. Domain-malli (speksin §11 mukaan)

**`FinancialAccount`** (tili tilikartassa):
- `accountCode: string` (esim. "5300") — uniikki tunniste
- `name: string` (esim. "Isännöintipalkkiot")
- `kind: "income" | "expense"`
- `group: string` (esim. "HALLINTOPALVELUT") — vapaa ryhmänimi
- `nature?: "maintenance" | "repair"` — valinnainen
- `controllability?: "fixed" | "variable" | "mixed"` — valinnainen
- `active: boolean`

**`FinancialEntry`** (yhden tilin yksi vuosi):
- `accountCode: string` — viittaa FinancialAccountiin (validoitava: tilin oltava olemassa)
- `year: number` (kokonaisluku)
- `budgetAmount?: number` — valinnainen (voi olla vain toteuma)
- `actualAmount?: number` — valinnainen (voi olla vain budjetti)
- `sourceIds: readonly string[]` — ei-tyhjä
- `notes?: string`

Lisää molemmat `AdminDataSnapshot`iin (esim. `financialAccounts: readonly FinancialAccount[]`, `financialEntries: readonly FinancialEntry[]`), `AdminDataOperation`-unioniin (`save_financial_account`, `save_financial_entry`), ja `validateAdminDataSnapshot`iin. **Säilytä olemassa oleva `FinancialYear` ennallaan** (sitä ei poisteta; se voi jäädä rinnalle).

**Validointisäännöt** (`adminDataValidation.ts`, samaan tapaan kuin muut entiteetit):
- FinancialAccount: accountCode ei-tyhjä, name ei-tyhjä, kind ∈ {income, expense}, group ei-tyhjä, nature (jos annettu) ∈ sallitut, controllability (jos annettu) ∈ sallitut, active boolean. accountCode uniikki snapshotissa.
- FinancialEntry: accountCode viittaa **olemassa olevaan** FinancialAccountiin (kuten costEvidence→asset -tarkistus), year kokonaisluku, budgetAmount/actualAmount (jos annettu) äärellinen luku, sourceIds ei-tyhjä. **Vähintään toinen** budgetAmount/actualAmount annettava (ei rivi jossa molemmat puuttuvat). Sama (accountCode, year) ei kahdesti (duplikaattitarkistus).
- **Sovella `applyAdminBatch`in ristiviittausjärjestystä:** FinancialEntry vaatii että sen FinancialAccount on jo luotu samassa tai aiemmassa batchissa → tuonti järjestää operaatiot: kaikki `save_financial_account` ennen `save_financial_entry`-operaatioita.

## 5. Read-model + payload-moduuli

**Read-model** (`adminDashboard.ts`): altista `financialAccounts` ja `financialEntries` (tai johdettu koontirakenne) `AdminDashboardReadModel`issa, jotta näkymät voivat lukea ne. Lisää tarvittavat testit.

**Payload-moduuli** (`public/adminOperationPayloads.js`): lisää jaettuun moduuliin (`// @ts-check` + JSDoc, ei kopiointia app.js:ään):
- `validateFinancialAccountInput` + `buildSaveFinancialAccountOperation`
- `validateFinancialEntryInput` + `buildSaveFinancialEntryOperation`
- entiteetti-vs-operaatio sourceIds -erottelu (kuten muillakin, `operationSourceIds`-virheavain)
- **jäsennin** (ks. 6): `parseFinancialPasteInput(rawText)` → { accounts[], entries[], errors[] } — puhdas, testattava funktio.

## 6. "Liitä tilikohtainen data" -tuontinäkymä (ydinosa)

Uusi näkymä Talous-osioon (esim. "Tuo tilidataa" tai osana Kulut tileittäin -näkymää). Toiminta:
- **Tekstialue**, johon käyttäjä liittää tab-erotellun datan.
- **Formaatti (TARKKA, tiukasti validoitava):** yksi rivi per (tili, vuosi). Sarakkeet tab-eroteltuina, tässä järjestyksessä:

  ```
  kind<TAB>ryhmä<TAB>tili<TAB>nimi<TAB>vuosi<TAB>budjetti<TAB>toteuma
  ```

  - `kind`: `kulu` tai `tulo` (→ expense/income)
  - `ryhmä`: ryhmänimi (esim. `HALLINTOPALVELUT`)
  - `tili`: tilinumero (esim. `5300`)
  - `nimi`: tilin nimi
  - `vuosi`: kokonaisluku (esim. `2025`)
  - `budjetti`: euromäärä tai tyhjä
  - `toteuma`: euromäärä tai tyhjä
  - Ensimmäinen rivi voi olla otsikkorivi (tunnistetaan ja ohitetaan jos se on em. sarakeotsikot).
  - Desimaalierotin: hyväksy sekä piste että pilkku (suomalainen data käyttää usein pilkkua); normalisoi luvuksi. Miinusmerkki sallittu (kulut usein negatiivisia lähteessä — säilytä etumerkki sellaisenaan, älä käännä).

- **Jäsennys tuottaa:**
  - Uniikit `FinancialAccount`it (yksi per tili: accountCode, name, kind, group). nature/controllability jätetään pois (ei tässä datassa) → active = true.
  - `FinancialEntry`t (yksi per rivi: accountCode, year, budgetAmount?, actualAmount?).
  - Sama tili usealla rivillä (eri vuodet) → yksi account + monta entryä. Jos saman tilin nimi/ryhmä/kind ristiriitainen eri riveillä → **virhe** (tiukka).

- **TIUKKA validointi esikatselulla** (projektin "ei hiljaisia oletuksia" -periaate):
  - Väärä sarakemäärä, tuntematon kind, ei-numeerinen vuosi, molemmat summat tyhjät, ei-numeerinen summa → **rivikohtainen virhe joka nimeää rivinumeron ja syyn**. Ei hiljaista ohitusta, ei arvausta.
  - **Esikatselu ennen tallennusta:** näytä taulukkona mitä tilejä (N kpl) ja rivejä (M kpl) syntyy, ja lista virheistä rivinumeroin. Tallennus-nappi disabloitu jos virheitä on.
- **Tallennus:** rakenna batch (accountit ensin, sitten entryt — ristiviittausjärjestys), lähetä `sendAdminOperations`-polulla, expectedRevision/409-käsittely (`interpretRevisionConflict` on jo moduulissa). Operaatiotason sourceIds + selitys omista kentistään.
- **Idempotenssi/duplikaatit:** jos tili tai (tili,vuosi) on jo olemassa snapshotissa, se on **päivitys** (save_* on upsert olemassa olevaan avaimeen) — mutta varo saman batchin sisäisiä duplikaatteja (applyAdminBatch hylkää ne). Jäsentimen tulee koota saman tilin rivit yhteen, ei tuottaa duplikaattioperaatioita.

## 7. Kulut tileittäin -näkymä

Korvaa nykyinen placeholder. Näyttää `FinancialEntry`t joiden tili on kind=expense, taulukkona (speksin §6.3):
- Ryhmiteltynä `group`-kentän mukaan (ryhmäotsikko + sen tilit).
- Sarakkeet: tili, nimi, ja vuosisarakkeet (toteuma per vuosi + budjetti-vuosi). Johda vuosisarakkeet datasta (älä kovakoodaa vuosia).
- Ryhmäkohtaiset summat + kokonaissumma jos luontevaa.
- Tyhjä tila jos ei dataa ("Ei vielä tilidataa. Tuo se Liitä-näkymästä.").
- **Budjetti näkyy ennen toteumaa** silloin kun molemmat esitetään (speksin läpi kulkeva sääntö, hyväksymiskriteeri koskee erityisesti Budjetti vs. toteuma -näkymää 3B:ssä mutta noudata samaa järjestystä tässäkin).

## 8. Testit

`public/adminOperationPayloads.test.js`:
- FinancialAccount/FinancialEntry payload + validointi (kaikki sääntörikkomukset: tuntematon kind, puuttuva sourceIds, molemmat summat tyhjät, entry ilman olemassa olevaa accountia, duplikaatti (tili,vuosi)).
- **`parseFinancialPasteInput`** kattavasti: kelvollinen syöte → oikeat account/entry-määrät; otsikkorivin ohitus; pilkku- ja pistedesimaalit; tyhjä budjetti tai toteuma; **virhesyötteet** (väärä sarakemäärä, tuntematon kind, ei-numeerinen vuosi/summa, ristiriitainen tilin nimi eri riveillä) → oikeat rivikohtaiset virheet; saman tilin monta vuotta → yksi account + monta entryä.
- Ristiviittausjärjestys: rakennettu batch ajetaan `applyAdminBatch`in läpi test-snapshotissa → validoituu (accountit ennen entryjä).

`public/viewWiring.test.js`: uudet näkymä-id:t + mahdolliset uudet disabled-napit + source-prefill-parit mukaan ristiintarkistuksiin.

DOM-käyttäytyminen (liitä → esikatselu → virhelista → tallennus) → manuaaliset testipolut PR-kuvaukseen. Ei jsdomia.

## 9. Valmis lopputulos — raportoi

Commit-lista, muutetut tiedostot, testitulokset, tuontijäsentimen tarkka formaatti (vahvista että se vastaa §6:ta), esikatselun ja tiukan validoinnin toiminta, ristiviittausjärjestys, automaattiset vs. manuaaliset testipolut, poikkeamat suunnitelmasta. **Luo PR** (base main). **Älä mergeä.**

## 10. Ulkopuolelle (myöhemmät vaiheet)

- **3B**: Tulot-, Kulut ryhmittäin-, Budjetti vs. toteuma -näkymät (jälkimmäinen laskee Erotus € = Toteuma − Budjetti ja Erotus % automaattisesti FinancialEntryistä — ei omaa dataa). Sarakejärjestys Budjetti → Toteuma → Erotus € → Erotus %.
- **Vaihe 4**: Taloudellinen asema / tase (BalanceSheetSnapshot, BalanceEntry) + tunnusluvut.

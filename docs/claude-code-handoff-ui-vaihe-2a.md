# Claude Code -tehtävä: Taloyhtiö Manager, UI-vaihe 2A (Havainnot + Kustannusnäyttö)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä prompt on itsenäinen. UI-vaihe 1 on jo toteutettu ja avattu PR:nä (#1) branchissa `feature/ui-shell-company-assets`. Tämä tehtävä on **vaihe 2A**, joka jatkaa siitä.

## 0. Lue ensin

Lähdedokumentit (repossa `docs/product-spec/`):
- `taloyhtio-manager-ui-ja-logiikka-spec.md` (§7 Kunnossapito, §11 tietomalli)
- `Taloyhtio_Manager_V2_8a_tietomalli_ja_laskentasaannot_REKONSTRUOITU.md`
- `taloyhtio-manager-ui-malli-ja-logiikka.xlsx` (Näkymäspesifikaatio, Toimintalogiikka L-001…L-015)
- `taloyhtio_terminaali.xlsx` (vain lähdeaineistoa, ei kopioida 1:1)

Lue myös vaihe 1:n tuotos: `public/app.js`, `public/index.html`, `public/adminOperationPayloads.js`, `src/readModels/adminDashboard.ts`, ja domain-tyypit `src/domain/types.ts` (erityisesti `Observation`, `CostEvidence`, `CostEvidenceStatus`, `PriceLevelConfirmation`, `AdminDataSnapshot`) sekä validointi `src/admin/adminDataValidation.ts`.

## 1. Nykyinen toimiva tila — älä riko näitä

Vaihe 1 tuotti jo (pysyvät koskemattomina, ellei tässä toisin sanota): sovelluskehys (sivupalkki/topbar/detaljipaneeli), Yleiskuva, Taloyhtiö-lomake, Rakennusosat-näkymä, `public/adminOperationPayloads.js` (jaettu payload-/validointimoduuli), read-modelin `observations`/`costEvidence`-laajennus, Visitor-polku, Julkaisu, Kehittäjäpaneeli.

Tuotannon perusta pysyy koskemattomana: Cloudflare Worker, Supabase Auth, ES256 JWT, JWKS, Hyperdrive/PostgreSQL, käyttöoikeudet. **Älä muuta** auth-, JWKS-, Cloudflare-, Hyperdrive- tai käyttöoikeuspolkuja. **Älä lisää debug-endpointteja.** **Älä lisää jsdomia, Playwrightia tai muuta selainajuria** (vaihe 1:n linjaus jatkuu). **Älä lisää raskasta frameworkia tai bundleria** — vanilla HTML/CSS/JS on oletus.

## 2. Työskentelytapa

1. Luo branch **`feature/ui-maintenance-observations-costs`** haarasta `feature/ui-shell-company-assets` (EI mainista — tämä rakentuu vaihe 1:n päälle, joka ei ole vielä mergattu).
   Tarkista lähtöhaara ensin: `git branch --show-current` pitäisi olla `feature/ui-shell-company-assets`.
2. Ensimmäisessä vastauksessasi **älä koodaa** — palauta toteutussuunnitelma ja odota hyväksyntää.
3. Toteuta pieninä, tarkistettavina committeina. Aja jokaisen jälkeen `npm run typecheck` ja `npm test`, lopuksi `npm run build:worker`.
4. Älä committoi salaisuuksia. Älä muuta tietokantadataa käsin tuotannossa.
5. UI-kieli suomi.

## 3. Tehtävän rajaus: VAIN vaihe 2A

Tämä PR toteuttaa **kaksi näkymää + yhden additiivisen read-model-laajennuksen**. Korjaustapahtumat, schedule-editori ja datamigraatiot **jäävät vaihe 2B:hen** — älä toteuta niitä tässä.

Toteutettavat asiat:
1. **Read-model-laajennus** (additiivinen): `priceLevelConfirmations` `AdminDashboardReadModel`iin.
2. **Havainnot-näkymä** (`Kunnossapito → Havainnot`): oikea listaus + lisäys/muokkaus, `save_observation`-operaatiolla.
3. **Kustannusnäyttö-näkymä** (`Kunnossapito → Kustannusnäyttö`): oikea listaus + lisäys/muokkaus, `save_cost_evidence`-operaatiolla, DATA GAP -käsittelyllä.

Nämä korvaavat vaihe 1:ssä tehdyt "tulossa vaiheessa 2" -placeholderit näille kahdelle näkymälle. **Korjaustapahtumat pysyy placeholderina** tässä PR:ssä.

## 4. Domain-malli on jo valmis — ei tietomallimuutoksia

Toisin kuin talous-PR (vaihe 3), vaihe 2A **ei tarvitse migraatioita eikä uusia domain-tyyppejä**. Kaikki on jo olemassa:

- `Observation { id, assetId, observedAt, description, sourceIds }`
- `CostEvidence { id, assetId?, eventId?, status, amount?, unit, quantity?, priceLevelYear, vatIncluded?, observedAt?, validUntil?, sourceUrl?, sourceId?, notes? }`
- `CostEvidenceStatus = "actual" | "quote" | "estimate" | "estimate_from_actual" | "data_gap"`
- `PriceLevelConfirmation { costEvidenceId, targetYear, confirmedAt, confirmedBy }`
- Operaatiot `save_observation`, `save_cost_evidence`, `save_price_level_confirmation` ovat jo `AdminDataOperation`-unionissa.

## 5. Toteutus

### 5.1 Read-model-laajennus (additiivinen)

`src/readModels/adminDashboard.ts`: lisää `AdminDashboardReadModel`iin `readonly priceLevelConfirmations: AdminDataSnapshot["priceLevelConfirmations"]` ja täytä se `buildAdminDashboardReadModel`issa samalla syväkopiointitavalla kuin `observations`/`costEvidence` (osana samaa `structuredClone`ia). Ei muita muutoksia. Ei auth-/kirjoituspolkumuutoksia. Lisää testi `src/readModels/adminDashboard.test.ts`:ään (samaan tyyliin kuin olemassa olevat: näkyy, on syväkopio, tyhjä pysyy tyhjänä listana).

### 5.2 Payload-moduulin laajennus (`public/adminOperationPayloads.js`)

Lisää samaan jaettuun moduuliin (yksi lähde totuudelle, `// @ts-check` + JSDoc, ei kopiointia app.js:ään), peilaten `src/admin/adminDataValidation.ts`:n TARKKOJA sääntöjä:

**`validateObservationInput` / `buildSaveObservationOperation`** — säännöt `validateObservation`ista:
- `id` ei-tyhjä, `assetId` ei-tyhjä (ja viittaa olemassa olevaan rakennusosaan — UI valitsee sen dropdownista, ei vapaa teksti), `observedAt` validi päivämäärä, `description` ei-tyhjä, entiteetin `sourceIds` ei-tyhjä.
- Operaatiotason `sourceIds` + `explanation` erikseen (sama kuvio kuin asseteilla vaihe 1:ssä: entiteetin lähteet vs. operaation lähteet omilla virheavaimilla).

**`validateCostEvidenceInput` / `buildSaveCostEvidenceOperation`** — säännöt `validateCostEvidence`ista, jotka ovat kriittisiä:
- `id` ei-tyhjä; `status ∈ {actual, quote, estimate, estimate_from_actual, data_gap}`; `unit` ei-tyhjä; `priceLevelYear` kokonaisluku.
- `assetId` JA/TAI `eventId` valinnaisia, mutta jos annettu, viittaavat olemassa olevaan (vaihe 2A:ssa vain `assetId`-kytkentä, koska eventejä ei vielä muokata täällä).
- `amount` (jos annettu) ei-negatiivinen; `quantity` (jos annettu) positiivinen kokonaisluku.
- Lähde pakollinen: **joko** `sourceId` **tai** `sourceUrl` on annettava (molemmat eivät saa puuttua).
- `observedAt` ja `validUntil` (jos annettu) validi päivämäärä.
- **DATA GAP -kriittinen sääntö (L-014):** kun `status === "data_gap"`, **`amount` EI SAA olla asetettu** — validointi hylkää `data_gap`in jolla on `amount`. UI:n on siis piilotettava/tyhjennettävä summakenttä kun status on data_gap. Tuntematon kustannus on nimetty DATA GAP, ei nolla eikä tyhjä summa muun statuksen alla.

### 5.3 Havainnot-näkymä

Korvaa placeholder oikealla toteutuksella (Näkymäspesifikaatio-välilehden mukaan):
- **Listaus**: havainnot rakennusosittain (assetId → rakennusosan nimi), sarakkeet: rakennusosa, havaintopäivä, kuvaus, lähteet. Tyhjä tila omalla viestillään (erillinen "ei vielä havaintoja", ei sama placeholder kuin ennen).
- **Lisäys/muokkaus-lomake**: rakennusosan valinta (dropdown olemassa olevista asseteista), havaintopäivä, kuvaus, entiteetin lähdetunnisteet + operaation lähdetunnisteet + selitys. Validointi, lataus/virhe/onnistumis-tilat, `expectedRevision`, 409-käsittely (`interpretRevisionConflict` on jo moduulissa).
- Rivin valinta voi avata detaljipaneelin (havainnon tiedot + lähteet + linkitetty rakennusosa). Havainnosta korjaustapahtuman luonti on **vaihe 2B**, ei tässä.

### 5.4 Kustannusnäyttö-näkymä

Korvaa placeholder oikealla toteutuksella:
- **Listaus**: costEvidence-rivit, sarakkeet: kohde (rakennusosa tai tapahtuma), status, summa (tai "DATA GAP" jos data_gap), yksikkö, määrä, hintatasovuosi, lähde. **DATA GAP -rivit korostettuina** (ei näytetä nollana). Tyhjä tila omalla viestillään.
- **Lisäys/muokkaus-lomake**: kohde (rakennusosan valinta dropdownista; eventId-kytkentä vaihe 2B), status (5 vaihtoehtoa), summa (piilotetaan/estetään kun status = data_gap), yksikkö, määrä, hintatasovuosi, ALV sisältyy, havaintopäivä, voimassaolo, lähde-URL tai lähdetunniste (toinen pakollinen), huomio. Validointi 5.2:n mukaan.
- **Hintatasovahvistus**: näytä kunkin rivin kohdalla, onko sille `priceLevelConfirmation` (read-modelin uudesta kentästä) — eli onko arvio vahvistettu projektion hintatasovuoteen. Vahvistuksen luonti (`save_price_level_confirmation`) voi olla tässä PR:ssä joko mukana kevyenä toimintona tai jätetty 2B:hen — ehdota kumpi, älä oleta.

## 6. Empty/missing-tilat (jatkuu vaihe 1:n linjasta)

Erottele edelleen neljä tilaa: oikeasti tyhjä (ei havaintoja/kustannuksia vielä) · tietomalli ei tue (ei koske näitä näkymiä, malli on olemassa) · näkymä tulossa (Korjaustapahtumat pysyy tässä) · laskenta ei mahdollinen / API-virhe. Älä käytä samaa geneeristä placeholderia kaikkeen.

## 7. Testit

Aja: `npm test`, `npm run typecheck`, `npm run build:worker`. Lisää automaattiset testit `public/adminOperationPayloads.test.js`:ään ja `src/readModels/adminDashboard.test.ts`:ään:
- Havainto-payloadin muoto + validointi (puuttuva assetId, tyhjä kuvaus, virheellinen päivämäärä → virhe).
- CostEvidence-payloadin muoto + validointi.
- **DATA GAP -sääntö**: `status="data_gap"` + `amount` annettu → validointivirhe; `data_gap` ilman `amount`ia → ok.
- Lähdepakko: ei `sourceId` eikä `sourceUrl` → virhe.
- `priceLevelConfirmations`-read-model-laajennus (näkyy, syväkopio, tyhjä pysyy tyhjänä).
- Entiteetin vs. operaation sourceIds-erottelu havainnoille.

DOM-käyttäytyminen (lomakkeiden renderöinti, dropdownit, status-ehtoinen summakenttä) kirjataan **manuaalisiksi testipoluiksi** PR-kuvaukseen + varmistetaan staattisella ID-/näkymä-ristiintarkistuksella kuten vaihe 1:ssä. Ei jsdomia.

## 8. Valmis lopputulos — raportoi

Kun valmis: commit-lista, muutetut tiedostot, testitulokset, read-modeliin tehty additiivinen muutos (`priceLevelConfirmations`), DATA GAP -säännön toteutus lomakkeessa, hintatasovahvistuksen ratkaisu (mukana vai 2B:hen), automaattiset vs. manuaaliset testipolut, poikkeamat suunnitelmasta. **Luo PR** (base: `feature/ui-shell-company-assets`, ei main, koska vaihe 1 ei ole vielä mergattu). **Älä mergeä.**

## 9. Ulkopuolelle (vaihe 2B, EI tässä)

Korjaustapahtumat-näkymä (suggested/approved/actual/cancelled + vuosi-/tila-/tyyppi-/rakennusosasuodattimet, "Kuluva kausi 2026" toteutuu tämän vuosisuodattimena — ei omaa näkymää), schedule-editori (`EventScheduleEntry`-rivit kolmeen skenaarioon), havainnosta tapahtuman luonti, "Kopioi rivi kaikkiin skenaarioihin" -apuri, sekä lämminvesivaraaja- ja Kuluva kausi 2026 -datan migraatiot (seed-skripti). Näihin tehdään erillinen vaihe 2B -handoff.

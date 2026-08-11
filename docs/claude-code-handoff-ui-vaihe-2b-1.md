# Claude Code -tehtävä: Taloyhtiö Manager, UI-vaihe 2B-1 (Korjaustapahtumat)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä prompt on itsenäinen. Vaihe 1, 2A on jo toteutettu ja **mergattu mainiin**. Tämä on **vaihe 2B-1**: Korjaustapahtumat-näkymä (UI). Datamigraatio (seed) tehdään erikseen vaihe 2B-2:na — **älä toteuta seedejä tässä.**

## 0. Lue ensin

Lähdedokumentit (repossa `docs/product-spec/`):
- `taloyhtio-manager-ui-ja-logiikka-spec.md` (§7 Kunnossapito)
- `Taloyhtio_Manager_V2_8a_tietomalli_ja_laskentasaannot_REKONSTRUOITU.md`
- `taloyhtio-manager-ui-malli-ja-logiikka.xlsx` (Näkymäspesifikaatio, Toimintalogiikka L-001…L-015)
- `taloyhtio_terminaali.xlsx` (vain lähdeaineistoa)

Lue myös vaihe 1+2A:n tuotos: `public/app.js`, `public/index.html`, `public/adminOperationPayloads.js`, `public/viewWiring.test.js`, `src/readModels/adminDashboard.ts`, domain-tyypit `src/domain/types.ts` (erityisesti `FutureBuildingEvent`, `ActualBuildingEvent`, `CancelledBuildingEvent`, `EventScheduleEntry`, `ActualEventEntry`, `EVENT_TYPES`, `EVENT_ORIGINS`, `SCENARIOS`) ja validointi `src/admin/adminDataValidation.ts` (`validateBuildingEventRuntime`).

## 1. Nykyinen toimiva tila — älä riko näitä

Mainissa on jo: sovelluskehys, Yleiskuva, Taloyhtiö, Rakennusosat (vaihe 1); Havainnot, Kustannusnäyttö, hintatasovahvistus, `priceLevelConfirmations` read-modelissa (vaihe 2A); jaettu `public/adminOperationPayloads.js` (payload-/validointimoduuli, `// @ts-check` + JSDoc); `public/viewWiring.test.js` (staattinen id/näkymä + disabled/enable -ristiintarkistus). **Korjaustapahtumat on tällä hetkellä placeholder** — tämä PR korvaa sen.

Tuotannon perusta pysyy koskemattomana: Cloudflare Worker, Supabase Auth, ES256 JWT, JWKS, Hyperdrive/PostgreSQL, käyttöoikeudet. **Älä muuta** auth-, JWKS-, Cloudflare-, Hyperdrive- tai käyttöoikeuspolkuja. **Älä lisää debug-endpointteja, jsdomia, Playwrightia, raskasta frameworkia tai bundleria.** Vanilla HTML/CSS/JS.

## 2. Työskentelytapa

1. Luo branch **`feature/ui-maintenance-events`** tuoreesta **mainista** (`git checkout main && git pull` ensin — vaihe 1+2A on jo mainissa, joten tämä EI ole enää PR-pino).
2. Ensimmäisessä vastauksessasi **älä koodaa** — palauta toteutussuunnitelma ja odota hyväksyntää.
3. Toteuta pieninä, tarkistettavina committeina. Aja jokaisen jälkeen `npm run typecheck` ja `npm test`, lopuksi `npm run build:worker`.
4. Committoi tämä handoff (`docs/claude-code-handoff-ui-vaihe-2b-1.md`) branchin ensimmäisenä committina.
5. Älä committoi salaisuuksia. UI-kieli suomi.

## 3. Tehtävän rajaus: VAIN vaihe 2B-1 (UI)

Toteutettavat asiat:
1. **Korjaustapahtumat-näkymä** (`Kunnossapito → Korjaustapahtumat`): oikea listaus + suodattimet + event-editori, korvaa nykyisen placeholderin.
2. **Schedule-editori**: `EventScheduleEntry`-rivien hallinta kolmeen skenaarioon (optimistic/base/stress).
3. **"Kopioi rivi kaikkiin skenaarioihin" -apuri** (ks. 5.4).
4. **Havainnosta tapahtuman luonti**: Havainnot-detaljipaneelin nappi joka avaa event-editorin esitäytettynä (ks. 5.5).

**EI tässä PR:ssä**: datamigraatio / seed-skriptit (lämminvesivaraajat, Kuluva kausi 2026) — ne ovat vaihe 2B-2. Tässä PR:ssä näkymä näyttää tyhjää dataa tyhjätiloineen, ja testataan käsin syöttämällä.

## 4. Domain-malli on jo valmis — ei tietomallimuutoksia, ei read-model-laajennusta

`events` on jo `AdminDashboardReadModel`issa (vaihe 1:stä). Operaatio `save_building_event` on jo unionissa. `validateBuildingEventRuntime` valvoo jo säännöt. **Ei migraatioita, ei uusia domain-tyyppejä, ei read-model-muutosta.**

Kolme event-varianttia (kaikki jakavat `id, assetId, title, type, origin, sourceIds, observationIds?, notes?`):
- **`FutureBuildingEvent`**: `status: "suggested" | "approved"`, pakollinen `schedule: EventScheduleEntry[]`
- **`ActualBuildingEvent`**: `status: "actual"`, `actual: ActualEventEntry`
- **`CancelledBuildingEvent`**: `status: "cancelled"`, `schedule?` valinnainen

`EventScheduleEntry`: `{ id, scenario, year, amount?, quantity?, costEvidenceId, explanation? }`
`ActualEventEntry`: `{ year, occurredAt?, amount?, quantity?, costEvidenceId }`
`EVENT_TYPES`: inspection, maintenance, repair, replacement, renewal, cleaning, study, other
`EVENT_ORIGINS`: initial_excel, manual, document_update (UI:sta luodut → `manual`)

## 5. Toteutus

### 5.1 Payload-moduulin laajennus (`public/adminOperationPayloads.js`)

Lisää jaettuun moduuliin (yksi lähde totuudelle, `// @ts-check` + JSDoc, ei kopiointia app.js:ään), peilaten `validateBuildingEventRuntime`in TARKKOJA sääntöjä:

**`validateBuildingEventInput` / `buildSaveBuildingEventOperation`**:
- Yhteiset: `id` ei-tyhjä, `assetId` ei-tyhjä (dropdown olemassa olevista asseteista), `title` ei-tyhjä, `type ∈ EVENT_TYPES`, `origin ∈ EVENT_ORIGINS` (UI asettaa `manual`), entiteetin `sourceIds` ei-tyhjä, `observationIds` (jos annettu) uniikkeja ei-tyhjiä.
- **suggested/approved**: `schedule` **vähintään yksi rivi** (validointi hylkää tyhjän). Jokainen rivi: `id` (uniikki eventin sisällä), `scenario ∈ SCENARIOS`, `year` kokonaisluku, `costEvidenceId` ei-tyhjä (linkki 2A:n kustannusnäyttöön), `amount` (jos annettu) ei-negatiivinen, `quantity` (jos annettu) positiivinen kokonaisluku.
- **actual**: `actual.year` kokonaisluku, `actual.costEvidenceId` ei-tyhjä, `actual.amount`/`quantity` samat säännöt.
- **cancelled**: schedule valinnainen; jos annettu, samat rivisäännöt.
- Operaatiotason `sourceIds` + `explanation` erikseen (sama entiteetti-vs-operaatio -erottelu kuin asset/observation/costEvidence, omilla virheavaimilla).

### 5.2 Korjaustapahtumat-näkymä (listaus + suodattimet)

Korvaa placeholder oikealla toteutuksella (Näkymäspesifikaatio):
- **Suodattimet**: vuosi, tila (suggested/approved/actual/cancelled), tyyppi (EVENT_TYPES), rakennusosa. **"Kuluva kausi 2026" toteutuu tämän vuosisuodattimena — ei omaa näkymää.** Vuosisuodattimen oletusarvoksi harkitse nykyistä vuotta (näyttää heti "tämän kauden" tapahtumat), mutta se saa olla myös tyhjä = kaikki.
- **Listaus**: sarakkeet rakennusosa, otsikko, tyyppi, tila, (future: skenaarioiden vuosihaarukka / actual: toteumavuosi). DATA GAP -korostus jos linkitetyllä costEvidencellä on data_gap. Neljä erillistä tyhjä/puuttuva-tilaa jatkuu (oikeasti tyhjä / ei laskettavissa / API-virhe; "tietomalli ei tue" ei koske tätä).
- **KPI:t**: harkitse esim. suggested/approved/actual/cancelled -lukumäärät (löytyvät jo read-modelin `counts`ista).
- Rivin valinta avaa detaljipaneelin (event + schedule-rivit skenaarioittain + linkitetyt havainnot + linkitetyt costEvidencet).

### 5.3 Event-editori

Lomake joka kattaa kaikki kolme varianttia tilan mukaan:
- Perustiedot: rakennusosa (dropdown), otsikko, tyyppi (dropdown EVENT_TYPES), tila (suggested/approved/actual/cancelled), notes, entiteetin lähdetunnisteet + operaation lähdetunnisteet + selitys, valinnainen observationIds-linkitys.
- **Tilan mukaan näytettävä osa**: suggested/approved → schedule-editori (5.4); actual → actual-entry-kentät (vuosi, occurredAt, amount, quantity, costEvidenceId); cancelled → valinnainen schedule.
- Validointi 5.1:n mukaan, lataus/virhe/onnistumis-tilat, `expectedRevision`, 409-käsittely (`interpretRevisionConflict` on jo moduulissa).

### 5.4 Schedule-editori + "Kopioi kaikkiin skenaarioihin" -apuri

- Schedule-rivit ryhmiteltynä kolmeen skenaarioon (optimistic / base / stress). Jokainen rivi: vuosi, määrä (quantity), summa (amount) valinnainen, **costEvidence-valinta dropdownista** (olemassa olevat kustannusnäytöt — pakollinen linkki).
- Rivin lisäys/muokkaus/poisto per skenaario.
- **"Kopioi rivi kaikkiin skenaarioihin" -apuri**: käyttäjä syöttää yhden rivin ja painaa apuria → sama rivi luodaan **pohjaksi** kaikkiin kolmeen skenaarioon (uniikit id:t per rivi). Käyttäjä muokkaa sen jälkeen skenaariokohtaiset erot käsin (esim. lämminvesivaraajissa 2028: base=1 kpl, stress=5 kpl). **Apuri ei koskaan päättele lukuja** — se vain monistaa lähtökohdan (L-003 / "ei automaattista generaattoria" -periaate). Rivien id:t generoidaan uniikeiksi.

### 5.5 Havainnosta tapahtuman luonti

- Lisää Havainnot-detaljipaneeliin (2A:sta) nappi **"Luo korjaustapahtuma"**.
- Nappi avaa event-editorin **esitäytettynä**: `assetId` = havainnon rakennusosa, `observationIds` = [havainnon id]. Loput (schedule, costEvidence) käyttäjä täyttää.
- Tämä toteuttaa 2A:n lupauksen ("Korjaustapahtuman luonti havainnosta toteutetaan vaiheessa 2B"). Poista 2A:n placeholder-teksti kun tämä on tehty.

## 6. Testit

Aja: `npm test`, `npm run typecheck`, `npm run build:worker`. Lisää automaattiset testit `public/adminOperationPayloads.test.js`:ään:
- Building event payload + validointi jokaiselle variantille (suggested/approved/actual/cancelled).
- **Future event ilman schedule-rivejä → validointivirhe** (kriittinen sääntö).
- Schedule-rivin säännöt: virheellinen scenario, ei-kokonaisluku year, puuttuva costEvidenceId → virhe; duplikaatti rivi-id → virhe.
- Actual event ilman `actual.costEvidenceId` → virhe.
- "Kopioi kaikkiin skenaarioihin" -apurin tuotos: tuottaa kolme riviä uniikein id:in, oikeilla skenaarioilla, muuten identtiset.
- Entiteetti-vs-operaatio sourceIds -erottelu eventeille.

Laajenna `public/viewWiring.test.js`:n tarkistuksia jos uusia disabled-oletusnappeja tai uusia näkymä-id:tä tulee (esim. event-editorin ja "Luo korjaustapahtuma" -napin kytkennät). DOM-käyttäytyminen (editorin tilanvaihto, apurin klikkaus) kirjataan **manuaalisiksi testipoluiksi** PR-kuvaukseen. Ei jsdomia.

## 7. Valmis lopputulos — raportoi

Commit-lista, muutetut tiedostot, testitulokset, event-editorin variantti­käsittely, "kopioi kaikkiin skenaarioihin" -apurin toteutus, havainto→tapahtuma-kytkentä, automaattiset vs. manuaaliset testipolut, poikkeamat suunnitelmasta. **Luo PR** (base: `main` — ei enää pinoa). **Älä mergeä.**

## 8. Ulkopuolelle (vaihe 2B-2, EI tässä)

Datamigraatio TypeScript-seed-skriptinä joka ajaa `save_*`-operaatiot oikeaa APIa vasten (sama validointi kuin UI):
- Lämminvesivaraaja-asset + costEvidence (1 800 €/kpl, "karkea arvio, tarkennettava") + FutureBuildingEvent "Varaajien uusiminen" + ~30 EventScheduleEntry-riviä (optimistic 5 kpl, base 12 kpl, stress 12 kpl; tarkat vuosiluvut Excelin "Pitkä aikaväli" -välilehdeltä, mm. 2028: base=1, stress=5).
- LiquidityBaseline: kassa 31.12.2025 = 22 208,49 €, korjausvaraus 9 680 €.
- Ilmanvaihdon puhdistus 2026 → DATA GAP costEvidence (ei hintaa; lähde: Hallituksen kunnossapitotarveselvitys 2024–2028).
Kaikki data on kertaluontoista aloitusdataa, jota voi vapaasti muokata UI:sta jälkikäteen. Tähän tehdään erillinen 2B-2 -handoff kun 2B-1 on valmis ja testattu.

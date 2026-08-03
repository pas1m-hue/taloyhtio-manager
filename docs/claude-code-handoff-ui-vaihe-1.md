# Claude Code -tehtävä: Taloyhtiö Manager, UI-vaihe 1 (hyväksytty suunnitelma)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä prompt on itsenäinen — se sisältää kaiken tarvittavan kontekstin ja kaikki jo tehdyt päätökset. Älä kysy uudelleen asioita, jotka on jo päätetty alla.

## 0. Lue ensin nämä lähdedokumentit

Liitteenä (tai reposta löytyvät, tarkista molemmat):

- `taloyhtio-manager-ui-ja-logiikka-spec.md`
- `Taloyhtio_Manager_V2_8a_tietomalli_ja_laskentasaannot_REKONSTRUOITU.md`
- `taloyhtio-manager-ui-malli-ja-logiikka.xlsx` (sisältää välilehdet: Yhteenveto, Sivukartta, Excel-mappaus, Näkymäspesifikaatio, Toimintalogiikka [säännöt L-001…L-015], Tietomallin muutokset, Toteutusvaiheet, Claude-handoff)
- `taloyhtio_terminaali.xlsx` (alkuperäinen Excel-hahmotelma — vain suunnittelun lähdeaineistoa, **ei kopioida yksi yhteen**)

Lue myös nykyinen repo kokonaisuutena ennen muutoksia: domain-malli (`src/domain/types.ts`), admin-validointi (`src/admin/adminDataValidation.ts`), admin-read-model (`src/readModels/adminDashboard.ts`), HTTP-reitit (`src/http/createHttpServer.ts`, `HTTP_API.md`), nykyinen frontend (`public/index.html`, `public/app.js`, `public/styles.css`, `public/auth-config.js`).

## 1. Nykyinen toimiva tila — älä riko näitä

Tuotannossa toimivat jo ja pysyvät koskemattomina:

- Cloudflare Worker -deploy (`src/cloudflare/worker.ts`)
- Supabase Auth, ES256 JWT -varmennus Web Cryptolla
- JWKS-haku Cloudflare-yhteensopivalla asetuksella
- Hyperdrive/PostgreSQL-yhteys
- admin-käyttöoikeuksien tarkistus (`tm_company_access_grants`)
- admin-työtilan lataus, Postgres-timestampien normalisoitu metadatavertailu
- visitor- ja admin-API-reitit
- nykyinen adminin osiorunko

**Älä muuta** auth-, JWKS-, Cloudflare-, Hyperdrive- tai käyttöoikeusratkaisuja ilman erikseen osoitettua pakkoa. **Älä lisää tai jätä debug-endpointteja.** Älä muuta domain-tietomallia (`src/domain/types.ts`) paitsi kohdan 2 additiivista read-model-laajennusta varten.

## 2. Tehtävän rajaus: vain UI-vaihe 1

Toteutettavat asiat:

- Selkeä, responsiivinen sovelluskehys: **vasen kiinteä sivupalkki** pääalueille + **topbar** (taloyhtiö, talousvuosi, skenaariohorisontti, kirjautunut käyttäjä, tallennus-/lataustila) + pääsisältö + **oikea detaljipaneeli**. Mobiilissa sivupalkki → hampurilaisvalikko, taulukot → korttilistat, detaljipaneeli → koko ruudun näkymä.
- Navigaatiorakenne (Sivukartta-välilehden mukaan): Yleiskuva / Talous (alanäkymät placeholderina paitsi kohdan 2.2 talousvuosivalitsin) / Kunnossapito → Rakennusosat (oikeana toteutuksena; Havainnot/Korjaustapahtumat/Kustannusnäyttö placeholderina) / Skenaariot ja likviditeetti (Skenaariot, Kassapolku, Vastiketarve — oikeana read-only-näkyminä) / Julkaisu (oikea, olemassa oleva toiminnallisuus siirrettynä uuteen runkoon) / Asetukset – Kehittäjäpaneeli.
- Oikea **Yleiskuva** olemassa olevan admin-workspace-read-modelin datasta.
- Oikea **Taloyhtiö-lomake**: nimi, huoneistomäärä, laskutettava pinta-ala, käyttöpuskurin kuukaudet, käyttöpuskurin euromääräinen override.
- Oikea **Rakennusosat-näkymä**: listaus, lisäys, muokkaus, aktiivinen/ei-aktiivinen, kategoria, lähdetunnisteet, ks. kohta 7 detaljipaneelista.
- Nykyinen manuaalinen JSON-batch piilotetaan **Kehittäjäpaneeliin** (ei poisteta).
- Muut päätason osiot: selkeä read-only- tai "ei vielä tietomallia" -näkymä, paitsi Skenaariot/Kassapolku/Vastiketarve (ks. kohta 3) — **ei koskaan keksittyä dataa**.
- Käyttöliittymän kieli: suomi.
- Kaikki kirjoitukset kulkevat nykyisen API:n ja admin-operaatioiden kautta (`save_housing_company`, `save_asset`). Ei suoraa tietokantakirjoitusta selaimesta.
- Talousmallia (FinancialAccount/FinancialEntry/BalanceSheetSnapshot/BalanceEntry) tai niihin liittyviä migraatioita **ei toteuteta tässä PR:ssä**.

## 3. Kahdeksan hyväksyttyä päätöstä — nämä ohittavat oletusarvot

### 3.1 Read-model-laajennus (vaihtoehto A, hyväksytty)

Laajenna `AdminDashboardReadModel` (`src/readModels/adminDashboard.ts`) **additiivisesti** palauttamaan:

- `observations`
- `costEvidence`

Muutos koskee **vain** read-only-admin-read-modelia ja sen testejä. Ei muutoksia auth-, JWKS-, Hyperdrive-, käyttöoikeus-, Worker- tai kirjoituspolkuihin.

Nykyisessä `Observation`-domain-mallissa ei ole avoin/suljettu-tilaa — **älä nimeä KPI:tä "Avoimet havainnot"**. Käytä nimeä **"Kirjatut havainnot"** (= observations-listan pituus).

**DATA GAP -rakennusosat** johdetaan `costEvidence`-riveistä, joilla `status === "data_gap"` ja joilla on `assetId` (uniikkien `assetId`-arvojen määrä).

Älä keksi observation-statusta äläkä muuta domain-mallia tämän lisäksi.

### 3.2 Talousvuosivalitsin topbarissa

Lisää talousvuosivalitsin topbariin **vain** näillä ehdoilla:

- Vaihtoehdot tulevat oikeasta `financialYears`-datasta (vuodet, joita snapshotissa on).
- Valinta vaikuttaa oikeasti Yleiskuvan valitun vuoden budjetti- ja toteumalukuihin (`budgetIncome`, `actualIncome`, `budgetCosts`, `actualCosts` valitulta `FinancialYear`-riviltä).
- Jos `financialYears` on tyhjä, valitsin näytetään pois käytöstä tai sitä ei näytetä lainkaan.
- Ei keksittyjä vuosia eikä keksittyjä talouslukuja.

Täydet Talous-näkymät (Tulot, Kulut ryhmittäin, Kulut tileittäin, Budjetti vs. toteuma, Taloudellinen asema) jäävät myöhempään talous-PR:ään — ks. kohta 8.

### 3.3 Skenaariot ja likviditeetti — pidetään oikeana toteutuksena

Säilytä nämä vaiheessa 1 **oikeina read-only-näkyminä**, koska laskenta ja data ovat jo käytettävissä `AdminDashboardReadModel.calculations`-kentässä:

- Skenaariot (`calculations.projection`, optimistic/base/stress, DATA GAP -horisonttiluokittelu `before/within/after`)
- Kassapolku (`calculations.liquidity`, vuosittaiset rivit)
- Vastiketarve (`calculations.liquidity`-pohjainen `requiredCollection`/`fundingNeed`)

**Älä siirrä olemassa olevaa toimivaa laskentanäkymää placeholderiksi.** Kun `calculations.liquidity.status === "unavailable"`, näytä selkeä tyhjä tila ja listaa puuttuvat lähtökentät (`missingFields` tms. olemassa olevasta rakenteesta).

### 3.4 Payload-builderien sijoitus — yksi lähde totuudelle

**Ei saa syntyä samaa logiikkaa kahdessa paikassa.** Suositeltu ratkaisu:

- Luo `public/adminOperationPayloads.js` ES-moduulina, joka sisältää `buildSaveHousingCompanyOperation`, `buildSaveAssetOperation`, `validateCompanyInput`, `validateAssetInput` (peilaten `src/admin/adminDataValidation.ts`:n sääntöjä: taloyhtiö — `name` ei-tyhjä, `apartmentCount` kokonaisluku > 0, `chargeableAreaM2` jos annettu > 0, `bufferMonths` jos annettu > 0, `userOverride` jos annettu ≥ 0; rakennusosa — `id`/`name` ei-tyhjiä, `category ∈ {hvac, envelope, structures, yard, safety, other}`, `active` boolean, entiteetin `sourceIds` ei-tyhjä lista, plus operaatiotason `sourceIds` + `explanation`).
- `public/app.js` importtaa **samat** funktiot tästä moduulista (`import { ... } from "./adminOperationPayloads.js"`).
- Vitest testaa **täsmälleen tätä samaa moduulia** (esim. `public/adminOperationPayloads.test.js` tai vastaava, lisättynä `vitest.config.ts`:n `include`-listaan jos tarpeen).

Vaihtoehtoisesti perusteltu kevyt build-vaihe on sallittu, mutta **ei raskasta frameworkia äläkä monimutkaista bundleria**. Payload-logiikkaa ei missään tapauksessa saa kopioida erikseen `app.js`:ään ja johonkin toiseen testattavaan moduuliin.

### 3.5 Visitor-näkymä säilyy kokonaan

Säilytä nykyinen Visitor-toiminnallisuus kokonaisuudessaan. Adminin uusi sivupalkki on vain admin-työtilaa varten — Visitor-näkymää ei tarvitse pakottaa sen alle. Vaiheessa 1 nykyinen Visitor/Admin-siirtymä voidaan säilyttää sellaisenaan tai toteuttaa selkeänä sovellustilan vaihtona, kunhan kaikki toimivat edelleen:

- visitor-session luonti
- visitor-session lataus
- visitor-muutokset (tapahtumarivin vuosi/summa/määrä/ohitus)
- visitor-reset
- likviditeettioletusten muokkaus
- custom event -lisäys

### 3.6 Yleiskuvan sallitut KPI:t

Rakenna Yleiskuva **vain** oikeasta read-model-datasta. Sallitut KPI:t tässä vaiheessa:

- työrevisio (`adminRevision`)
- julkaisuversio (`publication.latestPublicationVersion`)
- aktiiviset rakennusosat (`assets.filter(a => a.active).length`)
- kirjatut havainnot (`observations.length` — ks. 3.1 nimeäminen)
- DATA GAP -rakennusosat (ks. 3.1 johdanto)
- hyväksytyt tapahtumat (`counts.approvedEvents`)
- tunnetut kustannukset valitulla horisontilla (`calculations.projection`-summat)
- ensimmäinen puskurivaje skenaarioittain (`calculations.liquidity.forecast.scenarios[x].fundingNeed.firstFundingNeedYear`, jos saatavilla)
- julkaisua odottavat muutokset (`publication.publishableChanges`, `publication.unpublishedAuditEntryCount`)
- valitun talousvuoden budjetti/toteuma vain `financialYears`-datasta (ks. 3.2)

**Älä näytä kassaa tai puskuritavoitetta numeerisena**, jos `calculations.liquidity.status === "unavailable"` — näytä tyhjä tila sen sijaan.

### 3.7 Rakennusosan detaljipaneeli

Näytä valitulle rakennusosalle oikealla detaljipaneelilla, kaikki read-only-datana nykyisestä admin-workspacesta:

- nimi
- tunniste (`id`)
- kategoria
- aktiivisuus
- lähdetunnisteet (`sourceIds`)
- siihen liittyvät havainnot (`observations.filter(o => o.assetId === asset.id)`)
- siihen liittyvät tapahtumat (`events.filter(e => e.assetId === asset.id)`)
- siihen liittyvät `costEvidence`-rivit ja DATA GAP -tila (`costEvidence.filter(c => c.assetId === asset.id)`, korosta `status === "data_gap"`)

## 4. Muut Excel-mappauksen ja toimintalogiikan pakolliset säännöt

(Näkyy myös lähdedokumenteissa, toistetaan koska ne ovat kriittisiä eivätkä saa unohtua toteutuksessa:)

- Excel-välilehtiä **ei kopioida yksi yhteen** sovelluksen navigaatioksi — käytä Excel-mappaus-välilehden päätöksiä.
- **Ei automaattista elinkaarisykliä**, korjausvälin päättelyä tai muuta tapahtumageneraattoria. Tapahtumat ja skenaariorivit ovat aina eksplisiittisiä.
- "Pitkä aikaväli" (lämminvesivaraajat) poistetaan konseptina vasta datamigraation jälkeen — **ei tässä PR:ssä**, koska vaihe 1 ei koske Kunnossapidon tapahtumapuolta.
- "Kuluva kausi 2026" ei ole oma sivu — korvataan myöhemmin (vaihe 2) Korjaustapahtumat-näkymän vuosi-/tilasuodattimilla; vaiheessa 1 tätä näkymää ei vielä toteuteta muutoin kuin placeholderina.
- Tuntematon kustannus on aina nimetty **DATA GAP**, ei koskaan hiljainen nolla.
- Budjetti vs. toteuma -sarakejärjestys (kun se joskus toteutetaan): **Budjetti → Toteuma → Erotus € → Erotus %**. Ei koske vaihetta 1 suoraan, mutta talousvuosivalitsimen näyttämien lukujen tulkinta on hyvä pitää samana logiikkana etukäteen: kuluissa positiivinen erotus = ylitys = epäedullinen, tuloissa positiivinen erotus = suotuisa, nollabudjetissa prosentti jätetään tyhjäksi (ei jaeta nollalla) — tätä ei kuitenkaan lasketa/näytetä vielä vaiheessa 1, koska talousvuosivalitsin näyttää vain budjetin ja toteuman, ei erotusta.

## 5. Työskentelytapa

1. Luo feature branch: **`feature/ui-shell-company-assets`**. Älä työskentele suoraan main-haarassa.
2. Tutki repo kokonaisuutena ennen muokkaamista (ks. kohta 0).
3. Toteuta pieninä, tarkistettavina committeina.
4. Älä lisää uutta frameworkia tai raskasta riippuvuutta ilman vahvaa perustelua. Nykyinen vanilla HTML/CSS/JS on oletus.
5. Älä committoi salaisuuksia, tokeneita tai Supabase-avaimia.
6. Älä muuta tietokantadataa käsin tuotannossa.

## 6. Toteutuksen laatukriteerit

- Ei regressiota kirjautumisessa, "Lataa työtila" -toiminnossa, Visitor-sessiossa eikä julkaisussa.
- Kaikki kirjoitukset kulkevat nykyisen API:n ja admin-operaatioiden kautta.
- Taloyhtiön ja rakennusosien lomakkeissa: kenttävalidointi, lataustila, virhetila, onnistumisilmoitus, `expectedRevision`-käyttö. Optimistista lukitusta ei kierretä — 409 (`ADMIN_REVISION_CONFLICT`) näyttää selkeän "tiedot muuttuivat, lataa uudelleen" -tilan, ei hiljaista ohitusta.
- Semanttinen HTML, näppäimistökäyttö toimii, lomakkeiden labelit ja virheviestit ymmärrettäviä (`label for`, `aria-describedby`, `aria-invalid`, `role="status" aria-live="polite"` toastille).
- Mobiili- ja desktop-layout toimivat (360px asti).
- Manuaalinen JSON-editori ei ole normaalin käyttäjän ensisijainen käyttöliittymä (se on Kehittäjäpaneelissa).
- Tyhjä data näytetään selkeänä tyhjän tilan viestinä. Ei keksittyjä talous- tai kunnossapitotietoja missään.

## 7. Testit ja tarkistukset

Aja vähintään:

- olemassa olevat testit (`npm test`)
- TypeScript-tarkistus (`npm run typecheck`)
- Worker-build (`npm run build:worker`)
- uuden `public/adminOperationPayloads.js`-moduulin testit (ks. 3.4)

Repossa ei ole erillistä lint-skriptiä eikä ESLint/Prettier-konfiguraatiota — ei tarvitse lisätä sitä tässä PR:ssä, ellei se ole triviaalia.

Lisää testit ainakin seuraaville:

- Taloyhtiö-operaation request payload -muoto.
- Rakennusosan lisäys ja muokkaus (payload molemmille).
- Revision conflict -virheen käsittely (409 → selkeä uudelleenlataus-polku).
- Tyhjän rakennusosaluettelon renderöinti (tyhjätilan viesti, ei riviä).
- Virheellisen huoneistomäärän validointi (0, negatiivinen, desimaali → virhe).
- Kirjautumattoman adminin toimintojen estäminen (ei tokenia → operaatiota ei lähetetä; palvelin palauttaa 401).
- Nykyisen visitor-polun säilyminen (olemassa olevat visitor-testit vihreinä).
- Read-modelin `observations`/`costEvidence`-laajennuksen oikeellisuus (ks. 3.1).

## 8. Erillinen ehdotus myöhempää talous-PR:ää varten (ei toteuteta nyt)

Tuota **vain ehdotus**, ei koodia, seuraaville — käytä pohjana rekonstruoidun tietomallidokumentin §16 ja Excel-työkirjan "Tietomallin muutokset" -välilehteä:

- domain-tyypit: `FinancialAccount`, `FinancialEntry`, `BalanceSheetSnapshot`, `BalanceEntry` + uudet `AdminDataOperation`-variantit
- validaatio näille (peilaten `adminDataValidation.ts`-tyyliä)
- PostgreSQL-migraatiot (reversiibeli/turvallinen forward-migraatio, joka toimii sekä tyhjään että nykyiseen demo-dataan — ei datan häviämistä)
- repositoryt
- admin-operaatiot
- API-read modelit (Tulot, Kulut ryhmittäin, Kulut tileittäin, Budjetti vs. toteuma sarakejärjestyksellä Budjetti→Toteuma→Erotus €→Erotus %, Taloudellinen asema)
- testit (poikkeamalogiikka nollabudjetilla, tili/entry-validointi, migraatiotestit, repository-eheys)

## 9. Valmis lopputulos — raportoi lopuksi

Kun toteutus on valmis, näytä yhteenveto joka sisältää:

- tehdyt commitit (lista + lyhyt kuvaus kustakin)
- muutetut tiedostot
- testitulokset (`npm test`, `npm run typecheck`, `npm run build:worker`, uuden payload-moduulin testit)
- read-modeliin tehdyt additiiviset muutokset (tarkka diff-kuvaus `AdminDashboardReadModel`:iin)
- mahdolliset poikkeamat tästä hyväksytystä suunnitelmasta (ja miksi)
- manuaalisesti testattavat käyttöpolut (askel askeleelta: kirjautuminen → Yleiskuva → Taloyhtiö-lomake → Rakennusosat-lisäys/muokkaus/detaljipaneeli → talousvuosivalitsin → Skenaariot/Kassapolku/Vastiketarve → Visitor-polku → Julkaisu → Kehittäjäpaneeli)
- luo pull request tarkistettavaksi

**Älä mergeä PR:ää ilman erillistä hyväksyntää.**

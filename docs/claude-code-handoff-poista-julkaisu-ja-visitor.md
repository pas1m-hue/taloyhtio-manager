# Claude Code -tehtävä: Poista julkaisuputki ja visitor-puoli

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. **Suunnittelupainotteinen tehtävä** — palauta suunnitelma ja odota hyväksyntää. Tämä on iso poisto, ja §2 sisältää sen kohdan jossa voi mennä pieleen.

> §2:n riippuvuuskartta on tarkistettu importtaajatasolla `main` @ `d8f04d0` vasten (22.10.2026). Rivinumerot ja kutsujalistat ovat tuosta commitista. Jos main on edennyt, tarkista uudelleen — mutta älä hylkää karttaa vain siksi että se tuli valmiina.

## 0. Päätös ja perustelu

Sovellus on yhden käyttäjän työkalu (taloyhtiön hallituksen pj). Visitor-puoli ja julkaisuputki rakennettiin oletuksella että sovellus näyttää jotain muille, mutta sitä ei ole koskaan tapahtunut: visitor-näkymä on skenaariolaskuri jossa ei näy tilinpäätösdataa, ja julkaisuja on tehty kaksi, molemmat testiksi.

**Päätetty: poistetaan molemmat.**

Perustelu on empiirinen. Suuri osa tämän projektin vaikeimmista vioista on tullut tästä koneistosta:

| Vika | Missä |
|---|---|
| RLS kaatoi julkaisun (PR #21) | `tm_publications`, `tm_visitor_sessions`, `tm_visitor_session_access` — RLS oli päällä tasan näillä kolmella |
| Aikaleimojen millisekunnit katosivat (PR #22) | `postgresSessionRepository` — esti visitor-session luonnin |
| Fingerprint rikkoi vanhat julkaisut (PR #29) | 822 vihreää testiä eivät nähneet sitä |
| Fingerprintin kolme rivipolvea (PR #31) | Syntyi vain siksi että #29 teki niin |

Neljä vikaa ominaisuudesta jota kukaan ei käytä. Kattavuus kertoo saman asian toisin päin: koko poistettava koneisto on noin 6 % testitapauksista (§4 kohta 5).

**Myöhempi vaihe, ei tämä PR:** kun hallituksen jäsenille joskus annetaan katseluoikeus, se tehdään **roolina samassa sovelluksessa** — muokkaus- ja liittämistoiminnot piilotetaan, näkymät ovat samat. Se on eri asia kuin nykyinen visitor (erillinen näkymä, julkaistu snapshot, oma sessiokoneisto), ja siksi nykyisen säilyttäminen ei säästä sitä työtä.

**Tiedostettu menetys:** julkaisu oli myös arkisto — muuttumaton versio siitä mitä yhtiökokouksessa esitettiin. Se katoaa. Hyväksytty.

## 1. Mitä poistetaan

Kartoita tarkka lista itse; tämä on lähtökohta.

**Näkymät ja UI**
- Visitor-näkymä kokonaisuudessaan (`public/app.js`, `public/index.html`, `public/styles.css`)
- Julkaisuvalmius-näkymä ja sen sivupalkkiryhmä
- Admin/Visitor-vaihtokytkin yläpalkissa

**Palvelin — poistuvat tiedostot** (kaikkien importtaajat ovat itsekin tällä listalla)
- `src/publishing/publishedSnapshot.ts`
- `src/publishing/visitorPublishedView.ts`
- `src/publishing/publishAdminData.ts`
- `src/readModels/visitorScenarioView.ts`
- `src/readModels/publishedOverview.ts`
- `src/session/` — `buildSessionLiquidity.ts`, `buildVisitorSessionModel.ts`, `applySessionChanges.ts`, `sessionWorkspace.ts`, `sessionRepository.ts`, `sessionService.ts`
- `src/database/postgresSessionRepository.ts`
- `src/auth/protectedSessionRepository.ts`, `src/auth/sessionCredential.ts`, `src/auth/inMemoryProtectedSessionRepository.ts` (vahvista: näkyvät vain visitor-sessiopolulla ja `auth/index.ts`:n vienneissä)
- `src/application/publicVisitorFacade.ts`, `visitorApplicationService.ts`, `protectedVisitorApplicationService.ts`, `publishingApplicationService.ts`, `authorizedPublishingApplicationService.ts`

**Palvelin — muokattavat, EI poistettavat**
- `src/publishing/publicationRepository.ts` — ks. §2, tämä on tehtävän ansa
- `src/database/postgresPublishingRepository.ts` — hoitaa myös admin-snapshotit
- `src/domain/legacyFieldNames.ts` — yksi kolmesta funktiosta jää, ks. §2
- `src/readModels/adminDashboard.ts` — julkaisustatus-lohko poistuu
- `src/application/securedAdminFacade.ts`, `authorizedAdminApplicationService.ts`, `adminApplicationService.ts` — tyypitys muuttuu, ks. §2
- `src/http/runtime/createRuntime.ts`, `createPostgresRuntime.ts`, `devServer.ts`, `src/cloudflare/worker.ts` — sessiorepositorion kytkentä pois

**Julkiset HTTP-reitit** (`src/http/createHttpServer.ts`) — neljä, kaikki autentikoimattomia, joten poisto on myös tietoturvaparannus:
- `GET /api/v1/public/companies/:id/overview`
- `POST /api/v1/public/companies/:id/sessions`
- `GET /api/v1/public/sessions/:id`
- `POST /api/v1/public/sessions/:id` ja `/reset`

Lisäksi admin-reitin `/api/v1/admin/companies/:id/(workspace|preview|publications)` **`publications`-haara** poistuu. `workspace` ja `preview` jäävät.

**Tietokanta**
- Taulut `tm_publications`, `tm_visitor_sessions`, `tm_visitor_session_access` — ks. §3

## 2. KRIITTINEN: mikä on jaettua, mikä visitor-vain

Tässä on tehtävän ainoa aito riski. Osa koodista palvelee **sekä** adminia että visitoria, ja sen poistaminen rikkoisi admin-puolen hiljaa. Alla tarkistettu kartta.

### 2.1 Ansa: `src/publishing/publicationRepository.ts`

Tiedosto on julkaisunimisessä kansiossa, mutta **koko admin-kerroksen repositoriotyyppi kulkee sen läpi**:

```ts
export interface PublishingRepository
  extends AdminDataRepository, PublicationRepository {}
```

`PublishingRepository` on se tyyppi jota `securedAdminFacade`, `authorizedAdminApplicationService` ja `adminApplicationService` käyttävät. Jos tiedosto poistetaan, admin-kerros menettää repositoriotyyppinsä.

Oikea toimenpide:
- `PublicationRepository` (metodit `loadCurrent`, `loadVersion`, `listVersions`, `publish`) poistuu.
- `PublishingRepository` supistuu `AdminDataRepository`:ksi (`src/admin/adminRepository.ts`, jää ennalleen). Kerro suunnitelmassa kummalla tavalla teet sen: (a) poistat `PublishingRepository`-nimen ja tyypität kuusi kutsupaikkaa suoraan `AdminDataRepository`:lle, vai (b) jätät sen aliakseksi. **Suosittelen (a)** — alias jättäisi nimen joka lupaa julkaisua jota ei ole.
- `InMemoryPublishingRepository` säilyy admin-tilaa varten; julkaisuhistoria-osa (`#versions`, versiojatkuvuuden tarkistus, `validatePublishedDataSnapshot`-kutsu konstruktorissa) poistuu. Tätä luokkaa käytetään laajasti testeissä.

### 2.2 `src/domain/legacyFieldNames.ts` — yksi kolmesta jää

| Funktio | Kutsujat | Kohtalo |
|---|---|---|
| `withoutLegacyBaselineFields` | `postgresPublishingRepository.ts:318` (admin-polku, `withDefaultedAdminCollections`), `:406` (julkaisupolku) | **jää** |
| `withRenamedOverrideField` | vain `postgresSessionRepository.ts:359` | poistuu |
| `withStoredBaselineHashKeys` | vain `publishedSnapshot.ts:438` | poistuu |

Tiedosto siis jää, mutta älä jätä kahta kuollutta funktiota sinne. `withoutLegacyBaselineFields` on pakko säilyttää: vanhat admin-snapshotit sisältävät PR #29:ssä ja #31:ssä poistettuja kenttiä, ja ilman sitä työtilan lataus kaatuu niillä riveillä.

### 2.3 Laskentapolku — jaettu, haarautuu vasta visitorissa

Tarkistettu importtaajatasolla:

```
admin-palvelut → calculationReadModel.ts → buildLiquidityForecast.ts → projectCashPath.ts
visitor        → buildSessionLiquidity.ts ───────────────────────────↗
```

- `projectCashPath.ts` — importtaajat tasan kaksi: `buildLiquidityForecast.ts` ja `buildSessionLiquidity.ts`. **Jää.**
- `buildLiquidityForecast.ts` — importtaaja tasan yksi: `calculationReadModel.ts`. **Jää.**
- `calculationReadModel.ts` (`buildSnapshotCalculations`, `latestLiquidityBaseline`) — importtaajat: `securedAdminFacade`, `authorizedAdminApplicationService`, `adminApplicationService`, `adminDashboard` **ja** `publishedOverview`. Vain viimeinen poistuu. **Jää.**
- `cashPathTable.ts`, `findFundingNeed`, `calculateRequiredCollection`, `forecastCompleteness`, `operatingBuffer`, `money` — admin-polulla. **Jäävät.**

### 2.4 `adminDashboard.ts` — tasan yksi kutsupaikka

Yksi import julkaisukoneistosta: `fingerprintAdminPublishableContent` (`publishedSnapshot.ts`), käytössä rivillä 87 lipun `workspaceChangedSincePublication` laskennassa. Koko `AdminPublicationStatus`-lohko (`latestPublicationVersion`, `latestPublishedAdminRevision`, `latestPublishedAt`, `workspaceChangedSincePublication`, `publishableChanges`) poistuu. Tarkista ettei mikään muu lue näitä kenttiä — erityisesti `public/app.js`.

### 2.5 Julkaisuhistoria on admin-ominaisuus joka katoaa

`securedAdminFacade.ts` importtaa tyypit `PublicationHistoryItem` ja `PublicationHistoryReadModel` tiedostosta `readModels/publishedOverview.ts`, ja `loadAuthorizedPublicationHistory`-metodin `authorizedPublishingApplicationService.ts`:stä. Nämä poistuvat admin-rajapinnasta. Sano se PR-kuvauksessa ääneen — se on admin-puolen ominaisuuden poisto, ei pelkkä visitor-siivous.

### 2.6 Muu

- `SessionLiquidityOverrides` — visitorin omat ohitukset, poistuu. Tarkista ettei adminissa ole samannimisiä käyttöjä.
- `withDefaultedAdminCollections` (`postgresPublishingRepository.ts:312`) — **admin-puolta, ei poistu.** Sen vastinpari julkaisupuolella (`:381`) poistuu.
- `src/admin/`, `src/events/`, `src/updates/`, `src/projection/`, `src/finance/` — ei kosketa.

**Suunnitelmassa vaadittava:** vahvista tai korjaa yllä oleva kartta omalla jäljityksellä, ja kerro jokaisesta poistettavaksi merkitystä tiedostosta kuka sitä kutsuu. Jos kutsujia on jäljelle jäävällä admin-puolella, tiedosto ei poistu vaan sen julkaisuhaara poistuu.

Typecheck nappaa suurimman osan — mutta ei kaikkea. Jos poistat kentän jota admin-näkymä lukee valinnaisena, se muuttuu hiljaa `undefined`:ksi ja koodi kääntyy.

## 3. Tietokanta: pudotetaanko taulut?

Kerro kantasi suunnitelmassa, mutta **älä aja migraatiota tässä PR:ssä.**

**Vaihtoehto A — migraatio 005 pudottaa taulut.** Siistein lopputulos, ja se poistaa ne kolme taulua joilla RLS-ongelma oli. Mutta `DROP TABLE` on peruuttamaton, ja julkaisu 2 (tuotannossa) katoaa sen mukana.

**Vaihtoehto B — jätä taulut, poista vain koodi.** Data säilyy, mutta kantaan jää kuolleita tauluja joita mikään ei lue.

**Päätetty järjestys: koodi ensin, taulut erikseen myöhemmin.** Eli tässä PR:ssä B. A tehdään omana migraationaan sen jälkeen kun admin-puolen on nähty toimivan. Kerro silti kantasi ja miten ajo tehtäisiin (DATABASE_URL ei ole tässä ympäristössä).

Huomaa migraatioiden tila: migraatio 004 ajettiin Supabasen konsolista eikä `tm_schema_migrations`iin ole kirjattu sitä riviä. Se korjautuu kun migraatiot seuraavan kerran ajetaan oikein.

## 4. Suunnitelmassa vastattava

1. **§2:n kartoituksen vahvistus tai korjaus** — tärkein kohta. Erityisesti 2.1: miten tyypität admin-kerroksen uudelleen.
2. **Tietokanta** — kantasi A/B:hen, tietoisena että tässä PR:ssä tehdään B.
3. **Autentikointi** — jääkö sovellukseen yhtään reittiä joka toimii ilman Bearer-tokenia? Jos jää, nimeä ne ja kerro miksi. `GET /api/v1/health` ja staattiset assetit ovat odotettuja; muu ei.
4. **`adminDashboard`** — vahvista §2.4, ja tarkista `public/app.js`:n lukupolut näille kentille.
5. **Testit.** Varmasti poistuvat: `src/publishing/publishing.test.ts` (24 tapausta) ja `src/session/session.test.ts` (26) = 50. Osittain koskevat: `src/http/httpApi.test.ts` (14), `src/database/postgresPersistence.test.ts` (33), `src/application/application.test.ts` (18), `src/readModels/adminDashboard.test.ts` (8), `public/viewWiring.test.js` (30). Kokonaismäärä on noin 805 `it()`-lohkoa. Kerro paljonko lopulta poistuu ja **mitä admin-puolen kattavuutta jää niiden tilalle** — jos vastaus on "ei mitään uutta", se on hyväksyttävä vastaus mutta se pitää sanoa.
6. **Mitä `postgresPublishingRepository.ts`:ään jää** ja kannattaako se nimetä uudelleen (esim. `postgresAdminRepository.ts`). Jos nimeäminen on mekaaninen, tee se; jos se koskee tallennusmuotoa, älä. Sama kysymys kansiosta `src/publishing/`.

## 5. Rajaus

Ei muutoksia: laskentaan, näkymien lukuihin, tilidataan, korjaustapahtumiin, Selvityksiin, kunnossapitokatteeseen, `forecastComplete`-logiikkaan.

**Admin-puolen pitää näyttää täsmälleen samat luvut ennen ja jälkeen.** Se on tämän PR:n hyväksymiskriteeri: mitään ei saa muuttua paitsi että visitor, julkaisu ja julkaisuhistoria katoavat.

Ei auth/JWKS/Cloudflare/Hyperdrive-polkuja — paitsi julkisten reittien ja visitor-sessioiden poisto, joka on osa tehtävää.

## 6. Testit

- **Regressio: admin-näkymät ennallaan.** Kassan kehitys, Vastiketarve, Skenaariot, Taloudellinen asema, Budjetti vs. toteuma — samat luvut.
- Työtilan lataus toimii vanhalla snapshotilla (`withoutLegacyBaselineFields` jää).
- `withDefaultedAdminCollections` ennallaan.
- Poistetut HTTP-reitit palauttavat 404 eivätkä kaadu.
- Jäljelle jäävät reitit vaativat autentikoinnin (paitsi `/api/v1/health` ja staattiset assetit).

## 7. Työskentelytapa

1. Branch **`refactor/remove-publishing`** tuoreesta mainista.
2. **Suunnitelma ensin, ei koodia.** Vastaa §4:n kuuteen kohtaan, §2 ensimmäisenä.
3. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `npm run build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Live-tarkistus:** jos ajat pilvi-istunnossa, sinulla **ei ole** tuotannon Hyperdrive/Supabase-salaisuuksia eikä selainta, joten `wrangler dev --remote` ei ole käytettävissä. Älä väitä live-tarkistusta tehdyksi. Kirjaa PR-kuvaukseen erillinen **"Vaatii paikallisen tarkistuksen"** -lohko: täsmälliset näkymät ja luvut jotka pitää silmäillä selaimessa, ja mitä niissä pitäisi näkyä. Jos ajat paikallisesti, käynnistä wrangler uudelleen ennen valmiusilmoitusta: `pkill -f wrangler` ei toimi, käytä `kill <PID>`, tarkista `ss -ltnp` ettei orpo workerd pidä porttia 8787, ja varmista curlilla — `--remote` ei lataa `public/`-assetteja uudelleen tiedostomuutoksesta.

## 8. Muistutus

`docs/testien-sokeat-pisteet.md`: **jos testi ei kaadu ilman korjausta, se ei testaa korjausta.** Viisi tapausta kirjattuna, joista kaksi viimeisintä koskivat juuri tätä koneistoa.

Poistotyössä sama sääntö kääntyy toisin päin: **testi joka menee läpi poiston jälkeen ei todista että admin-puoli toimii, jos se testasi poistettua koodia.** 50 tapausta poistuu varmasti; vihreä sarja poiston jälkeen on siksi heikompi todiste kuin ennen. Siksi §6:n regressio tarkistetaan selaimessa, ei pelkästään testeillä.

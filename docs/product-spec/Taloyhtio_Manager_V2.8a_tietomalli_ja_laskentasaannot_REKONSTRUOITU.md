# Taloyhtiö Manager V2.8a – tietomalli ja laskentasäännöt

**Status:** rekonstruoitu dokumentti nykyisen lähdekoodin, Excel-hahmotelman ja keskustelussa hyväksyttyjen linjausten pohjalta. Tämä ei ole alkuperäinen Word-tiedosto, vaan korvaava lähdedokumentti Claude Code -handoffia ja jatkokehitystä varten.

**Päivitetty:** 2026-07-27

\---

## 1\. Tarkoitus

Taloyhtiö Manager on taloyhtiön kunnossapidon, korjaustapahtumien, talouden ja skenaarioiden hallintasovellus. Sen ydinajatus on erottaa pysyvä admin-data, julkaistu immutable-versio ja visitorin väliaikainen skenaariosessio toisistaan.

Sovellusta ei rakenneta Excel-välilehtien yksi yhteen -kopioksi. Excel toimii lähdeaineistona, mutta sovelluksen rakenne perustuu käyttäjän tehtäviin:

* mitä taloyhtiössä on,
* mitä havaintoja rakennusosista on,
* mitä korjauksia suunnitellaan,
* millä kustannusnäytöllä arviot perustellaan,
* miten optimistic/base/stress-skenaariot vaikuttavat kassaan,
* mitä julkaistaan osakkaiden tai visitor-näkymän käyttöön.

\---

## 2\. Pääperiaatteet

### 2.1 Kolme data- ja käyttötilaa

|Tila|Kuvaus|Muuttuvuus|Käyttäjä|
|-|-|-|-|
|Admin-työversio|Pysyvä muokattava työtila|muuttuva revision kautta|kirjautunut admin|
|Julkaisu|Immutable versio yhdestä admin-revisiosta|ei muutu luonnin jälkeen|public/visitor|
|Visitor-sessio|Väliaikainen mallinnus julkaistun version päällä|muuttuu session sisällä|visitor/osakas|

Admin-työversiota muokataan domain-operaatioilla. Jokainen muutos käyttää optimistista lukitusta `expectedRevision`-kentällä. Julkaisu luodaan vain admin-työversion perusteella. Visitor-sessio ei koskaan kirjoita admin-dataan eikä muuta julkaistua versiota.

### 2.2 Ei automaattisia elinkaarisyklien päätelmiä

Rakennusosa ei itsessään generoi tulevia korjausvuosia. Kaikki tapahtumat ovat eksplisiittisiä. Sovellus ei päättele korjausvälejä, resetoi elinkaarta tai rakenna automaattisia sykliä ilman käyttäjän tai hyväksytyn lähteen antamaa tapahtumariviä.

Tietovirta:

`Rakennusosa → havainto → korjaustapahtuma → kustannusnäyttö → optimistic/base/stress-rivit → kassapolku ja vastiketarve`

### 2.3 DATA GAP -periaate

Tuntematon kustannus ei muutu hiljaisesti nollaksi. Puuttuva summa käsitellään nimettynä DATA GAPina. Skenaario ja kassapolku saavat näyttää tunnetut kustannukset, mutta niiden on ilmoitettava, jos ennuste ei ole täydellinen DATA GAPien takia.

### 2.4 Revision ja audit

Admin-data on versionoitu `revision`-arvolla. Jokainen hyväksytty muutos kasvattaa revisionia. Audit trail kertoo, mitä entiteettiä muutettiin, kuka muutti, milloin ja millä lähdeviitteillä.

\---

## 3\. Keskeiset domain-tyypit

### 3.1 Skenaariot

Sallitut skenaariot:

* `optimistic`
* `base`
* `stress`

Skenaariot ovat eksplisiittisiä rivejä tapahtumien aikataulussa. Sama tapahtuma voi sisältää useita eri skenaario- ja vuosirivejä.

### 3.2 Rakennusosakategoriat

Sallitut rakennusosakategoriat:

* `hvac`
* `envelope`
* `structures`
* `yard`
* `safety`
* `other`

Rakennusosa on kuvailevaa metadataa. Se ei itsessään ole tapahtuma eikä laskentamoottori.

### 3.3 Tapahtumatyypit

Sallitut tapahtumatyypit:

* `inspection`
* `maintenance`
* `repair`
* `replacement`
* `renewal`
* `cleaning`
* `study`
* `other`

### 3.4 Tapahtuman tilat

Sallitut tilat:

* `suggested`
* `approved`
* `actual`
* `cancelled`

Julkaisuun pääsevät vain hyväksytyt tulevat tapahtumat ja toteutunut historia. Suggested- ja cancelled-rivejä ei näytetä visitorille julkaistuna korjaussuunnitelmana, ellei käyttöliittymä erikseen näytä niitä adminille.

### 3.5 Kustannusnäytön statukset

Sallitut statukset:

* `actual`
* `quote`
* `estimate`
* `estimate\_from\_actual`
* `data\_gap`

Kustannusnäyttö voi liittyä rakennusosaan, tapahtumaan tai molempiin. `data\_gap`-statuksella ei saa olla euromäärää.

### 3.6 Hintatasovuosi

Kustannukset vahvistetaan projektion hintatasoon. Nykyinen projektion hintatasovuosi on `2026`.

\---

## 4\. AdminDataSnapshot

Adminin pysyvä työtila tallennetaan yhtenä snapshotina.

Pakollinen rakenne:

|Kenttä|Tyyppi|Kuvaus|
|-|-|-|
|`companyId`|string|Taloyhtiön tunniste|
|`revision`|number|Työversion revision, kokonaisluku >= 0|
|`housingCompany`|object|Taloyhtiön perustiedot|
|`financialYears`|array|Vuositason taloustiedot|
|`liquidityBaselines`|array|Kassan ja hoitokulujen lähtötiedot|
|`assets`|array|Rakennusosat|
|`observations`|array|Havainnot|
|`costEvidence`|array|Kustannusnäyttö|
|`priceLevelConfirmations`|array|Hintatasovahvistukset|
|`events`|array|Rakennustapahtumat|
|`auditTrail`|array|Admin-muutoshistoria|
|`updatedAt`|string|ISO-aikaleima|
|`updatedBy`|string|Muokkaaja|

Metadataehdot:

* `companyId` ei saa olla tyhjä.
* `housingCompany.id` on sama kuin `companyId`.
* `revision` on kokonaisluku ja vähintään 0.
* `updatedAt` ja `updatedBy` ovat pakollisia.
* Tietokantarivin metadata ja payloadin metadata vastaavat toisiaan.

\---

## 5\. Entiteetit ja validointi

### 5.1 HousingCompany

|Kenttä|Pakollinen|Sääntö|
|-|-:|-|
|`id`|kyllä|ei tyhjä|
|`name`|kyllä|ei tyhjä|
|`apartmentCount`|kyllä|kokonaisluku > 0|
|`chargeableAreaM2`|ei|jos annettu, numero > 0|
|`operatingBuffer.bufferMonths`|ei|jos annettu, numero > 0|
|`operatingBuffer.userOverride`|ei|jos annettu, numero >= 0|

### 5.2 FinancialYear

|Kenttä|Sääntö|
|-|-|
|`year`|kokonaisluku|
|`budgetIncome`, `actualIncome`, `budgetCosts`, `actualCosts`|jos annettu, numero >= 0|
|vähintään yksi euromäärä|pakollinen|
|`sourceIds`|vähintään yksi ei-tyhjä lähde|

Nykyinen `FinancialYear` tukee vain vuosittaisia kokonaissummia. Excelin mukaiset tilikohtaiset tulot, kulut ja budjetti-toteuma-erittely vaativat myöhemmin uuden talousmallin.

### 5.3 LiquidityBaselineRecord

|Kenttä|Sääntö|
|-|-|
|`id`|ei tyhjä|
|`asOfDate`|kelvollinen päivämäärä|
|`currentCash`|numero >= 0|
|`trailing12mOperatingCosts`|numero >= 0|
|`currentAnnualRepairCollection`|numero >= 0|
|`sourceIds`|vähintään yksi lähde|

### 5.4 Asset

|Kenttä|Sääntö|
|-|-|
|`id`|ei tyhjä ja uniikki|
|`name`|ei tyhjä|
|`category`|yksi sallituista rakennusosakategorioista|
|`sourceIds`|vähintään yksi lähde|
|`active`|boolean|

### 5.5 Observation

|Kenttä|Sääntö|
|-|-|
|`id`|ei tyhjä ja uniikki|
|`assetId`|viittaa olemassa olevaan rakennusosaan|
|`observedAt`|kelvollinen päivämäärä|
|`description`|ei tyhjä|
|`sourceIds`|vähintään yksi lähde|

### 5.6 CostEvidence

|Kenttä|Sääntö|
|-|-|
|`id`|ei tyhjä ja uniikki|
|`status`|sallittu kustannusnäytön status|
|`unit`|ei tyhjä|
|`priceLevelYear`|kokonaisluku|
|`assetId`|jos annettu, viittaa olemassa olevaan rakennusosaan|
|`eventId`|jos annettu, viittaa olemassa olevaan tapahtumaan|
|`amount`|jos annettu, numero >= 0|
|`quantity`|jos annettu, kokonaisluku > 0|
|`sourceId` tai `sourceUrl`|vähintään toinen pakollinen|
|`observedAt`, `validUntil`|jos annettu, kelvollinen päivämäärä|

Jos `status = data\_gap`, `amount` ei saa olla annettu.

### 5.7 PriceLevelConfirmation

|Kenttä|Sääntö|
|-|-|
|`costEvidenceId`|viittaa olemassa olevaan kustannusnäyttöön|
|`targetYear`|2026|
|`confirmedAt`|kelvollinen päivämäärä|
|`confirmedBy`|ei tyhjä|

### 5.8 BuildingEvent

Yhteiset kentät:

|Kenttä|Sääntö|
|-|-|
|`id`|ei tyhjä ja uniikki|
|`assetId`|ei tyhjä|
|`title`|ei tyhjä|
|`type`|sallittu tapahtumatyyppi|
|`origin`|`initial\_excel`, `manual` tai `document\_update`|
|`sourceIds`|vähintään yksi lähde|
|`observationIds`|jos annettu, viittaa saman rakennusosan havaintoihin|

Future-tapahtuma (`suggested` tai `approved`) tarvitsee vähintään yhden schedule-rivin, ellei tapahtuma ole cancelled. Schedule-rivillä on:

* `id`
* `scenario`
* `year`
* `costEvidenceId`
* valinnainen `amount`
* valinnainen `quantity`
* valinnainen `explanation`

Actual-tapahtumalla on `actual`-rakenne, jossa on vuosi ja kustannusnäytön tunniste.

Cancelled-tapahtuma voi sisältää vanhat schedule-rivit mutta ei vaadi niitä.

### 5.9 AdminAuditEntry

Audit-riviltä vaaditaan:

* `id`
* `revision` > 0 ja enintään snapshotin revision
* `entityType`
* `entityKey`
* `operation`
* `actorId`
* `occurredAt`
* `sourceIds`
* `explanation`
* `after`

\---

## 6\. Projektio ja skenaariolaskenta

### 6.1 Projektion syöte

Projektio käyttää:

* rakennusosia,
* hyväksyttyjä tulevia tapahtumia,
* toteutunutta historiaa,
* kustannusnäyttöä,
* hintatasovahvistuksia,
* valittua horisonttia.

Suggested-tapahtumat validoidaan adminissa laskentarajan yli hyväksyttyinä kopioina, jotta virheelliset kustannusviitteet havaitaan jo ennen hyväksyntää.

### 6.2 ProjectedCostEvent

Laskennan tulosrivi sisältää:

* tapahtuman tunnisteen,
* schedule-rivin tunnisteen,
* rakennusosan,
* otsikon,
* tapahtumatyypin,
* alkuperän,
* skenaarion,
* vuoden,
* summan,
* määrän,
* kustannusnäytön tunnisteen,
* havaintoviitteet,
* selityksen.

### 6.3 HorizonPosition

DATA GAP tai tapahtuma voi olla horisonttiin nähden:

* `before`
* `within`
* `after`

Yleiskuva ja skenaariot painottavat erityisesti horisontin sisällä olevia DATA GAPeja.

### 6.4 Skenaariokohtainen tulos

Jokaiselle skenaariolle lasketaan:

* vuosirivit,
* tapahtumamäärä,
* määräsumma,
* euromäärä,
* horisonttia edeltävät kustannukset,
* horisontin jälkeiset kustannukset,
* DATA GAP -listat.

\---

## 7\. Likviditeetti ja vastiketarve

### 7.1 Lähtötiedot

Likviditeettimalli tarvitsee vähintään:

* nykyinen kassa,
* 12 kk hoitokulut,
* nykyinen vuosittainen korjauskeräys.

Jos nämä puuttuvat, likviditeetti on `unavailable`, ja näkymän on kerrottava puuttuvat kentät.

### 7.2 Operating buffer

Oletuspuskuri on 3,5 kuukautta. Admin tai visitor voi antaa:

* puskurikuukaudet,
* euromääräisen override-arvon.

### 7.3 Kassapolku

Kassapolku lasketaan vuosittain:

* avauskassa,
* vuosittainen korjauskeräys,
* tunnetut korjauskulut,
* päätöskassa,
* puskuritavoite,
* kassa yli puskurin,
* puskurivaje,
* DATA GAPit.

### 7.4 Rahoitustarvesignaali

Jokaiselle skenaariolle määritetään:

* riittääkö oma keräys tunnetuille kustannuksille,
* onko ennuste täydellinen,
* ensimmäinen rahoitustarvevuosi,
* maksimipuskurivaje,
* pienin päätöskassa,
* blocking DATA GAPit.

### 7.5 Vastiketarve

Lasketaan vähimmäinen tasainen vuosikeräys tunnetuille kustannuksille. Tuloksessa näytetään:

* nykyinen vuosikeräys,
* tarvittava vuosikeräys,
* lisätarve vuodessa,
* nykyinen kuukausikeräys,
* tarvittava kuukausikeräys,
* lisätarve kuukaudessa,
* mahdolliset m2- ja huoneistokohtaiset luvut.

Tuntemattomia DATA GAP -kustannuksia ei lasketa nollaksi. Jos DATA GAP estää täydellisen ennusteen, `forecastComplete = false`.

\---

## 8\. Julkaisu

### 8.1 PublishedDataSnapshot

Julkaisu on immutable snapshot. Se sisältää:

* `companyId`
* `publicationVersion`
* `sourceAdminRevision`
* `contentFingerprint`
* taloyhtiön perustiedot
* talousvuodet
* likviditeetin lähtötiedot
* rakennusosat
* havainnot
* kustannusnäytöt
* hintatasovahvistukset
* vain julkaistavat tapahtumat
* `publishedAt`
* `publishedBy`
* `sourceIds`
* `explanation`

### 8.2 Julkaisun ehdot

Julkaisussa tarkistetaan:

* admin-data löytyy,
* admin revision vastaa odotettua,
* viimeisin julkaisuversio vastaa odotettua,
* julkaistava versio on seuraava numero,
* sisältö muuttuu aiemmasta julkaisusta,
* snapshot läpäisee published-data-validaation.

Jos sisältö ei ole muuttunut, palautetaan `NO\_PUBLICATION\_CHANGES`.

\---

## 9\. Visitor-sessio

Visitor-sessio on väliaikainen delta julkaistun version päällä. Se sisältää:

* session tunnisteen,
* yhtiön,
* julkaisuversion,
* publication fingerprintin,
* revisionin,
* luonti-, päivitys- ja vanhenemisajat,
* horisontin,
* tapahtumaoverride-rivit,
* custom-tapahtumat,
* likviditeettiarvojen override-rakenteen.

Visitor voi:

* muuttaa yksittäisen tapahtumarivin vuotta,
* muuttaa summaa,
* muuttaa määrää,
* ohittaa tapahtumarivin,
* lisätä väliaikaisen tapahtuman,
* muuttaa likviditeettioletuksia,
* muuttaa horisonttia,
* palauttaa session julkaistuun lähtötilaan.

Visitor ei voi muuttaa admin-dataa tai julkaisua.

\---

## 10\. Admin-operaatiot

Sallitut admin-operaatiot:

* `save\_housing\_company`
* `save\_financial\_year`
* `save\_liquidity\_baseline`
* `save\_asset`
* `save\_observation`
* `save\_cost\_evidence`
* `save\_price\_level\_confirmation`
* `save\_building\_event`

Jokainen operaatio sisältää:

* `type`
* `value`
* `sourceIds`
* `explanation`

Palvelin lisää tekijän ja aikaleiman. UI ei saa kirjoittaa suoraan tietokantaan.

\---

## 11\. API-palvelut

Keskeiset sovelluspalvelut:

|Palvelu|Tarkoitus|
|-|-|
|`loadAdminWorkspace`|Lataa adminin read modelin ja laskennan|
|`applyAdminChanges`|Tallentaa admin-operaatiot revision kautta|
|`publishAdminRevision`|Luo uuden julkaisuversion|
|`loadPublishedOverview`|Lataa public/visitor-lähtönäkymän|
|`createVisitorSession`|Luo visitor-session julkaistusta versiosta|
|`loadVisitorSession`|Lataa visitor-session nykytilan|
|`applyVisitorSessionChanges`|Tallentaa visitor-session delta-operaatiot|
|`resetVisitorSession`|Palauttaa visitor-session julkaistuun lähtötilaan|

HTTP-taso käyttää JSONia. Admin-reitit vaativat Bearer-tokenin. Visitor-session reitit käyttävät session credentialia.

\---

## 12\. Persistenssi

### 12.1 PostgreSQL-taulut

Nykyinen ydinpersistenssi:

* `tm\_admin\_snapshots`
* `tm\_publications`
* `tm\_visitor\_sessions`
* `tm\_company\_access\_grants`

### 12.2 Admin snapshot

`tm\_admin\_snapshots` sisältää:

* `company\_id`
* `revision`
* `payload` JSONB
* `updated\_at`
* `updated\_by`

Repository tarkistaa, että sarakkeiden metadata vastaa payloadin metadataa. Timestamp-vertailun pitää normalisoida Postgresin ja JSONin aikamuodot samaan ISO-muotoon.

### 12.3 Access grants

`tm\_company\_access\_grants` sisältää ainakin:

* `company\_id`
* `subject\_id`
* `role`
* `active`
* `granted\_at`
* `granted\_by`
* `revoked\_at`
* `revoked\_by`

Admin-oikeus vaatii aktiivisen `admin`-roolin yhtiölle ja tokenin subjectille.

\---

## 13\. Autentikointi ja valtuutus

Admin-auth käyttää Supabase JWT:tä. Workerissä JWT varmennetaan JWKS-avaimella Web Crypton avulla. Auth-konteksti sisältää ainakin:

* subject id,
* provider,
* expires at.

Virheet:

* `UNAUTHENTICATED`: token puuttuu tai ei kelpaa.
* `ACCESS\_DENIED`: identiteetti löytyy, mutta yhtiökohtainen admin-grant puuttuu tai ei ole aktiivinen.
* `INVALID\_AUTH\_CONTEXT`: tunnistetut claimit eivät muodosta kelvollista admin-identiteettiä.

\---

## 14\. Excelistä sovellukseen tehdyt linjaukset

|Excel-välilehti|Päätös|Uusi sijainti|
|-|-|-|
|Ohje|Korvataan kontekstuaalisilla ohjeilla|Sivukohtaiset info-laatikot|
|Kulut|Supistetaan trendinäkymäksi|Talous → Kulut ryhmittäin|
|Rakennusosat|Säilytetään ja normalisoidaan|Kunnossapito → Rakennusosat|
|Kuluva kausi 2026|Ei oma pysyvä sivu|Korjaustapahtumat + vuosisuodatin|
|Pitkä aikaväli|Poistetaan konseptina|Varaajat asset/event/schedule-malliin|
|Skenaariot|Uudistetaan tapahtumapohjaiseksi|Skenaariot ja likviditeetti|
|Kulut tileittäin|Säilytetään|Talous → Kulut tileittäin|
|Tulot|Supistetaan trendinäkymäksi|Talous → Tulot|
|Taloudellinen asema|Säilytetään|Talous → Taloudellinen asema|
|Budjettitarkkuus|Säilytetään ja järjestetään|Talous → Budjetti vs. toteuma|

Budjetti vs. toteuma -näkymän sarakejärjestys:

`Budjetti → Toteuma → Erotus € → Erotus %`

\---

## 15\. UI-tavoiterakenne

Päänavigaatio:

* Yleiskuva
* Talous

  * Yhteenveto
  * Tulot
  * Kulut ryhmittäin
  * Kulut tileittäin
  * Budjetti vs. toteuma
  * Taloudellinen asema
* Kunnossapito

  * Rakennusosat
  * Havainnot
  * Korjaustapahtumat
  * Kustannusnäyttö
* Skenaariot ja likviditeetti

  * Skenaariot
  * Kassapolku
  * Vastiketarve
* Julkaisu
* Asetukset / kehittäjäpaneeli

Ensimmäisessä UI-vaiheessa toteutetaan täysi runko, Yleiskuva, Taloyhtiö-lomake ja Rakennusosat-näkymä. Talousosion tarkka tilikohtainen tietomalli toteutetaan myöhemmin.

\---

## 16\. Tuleva talousmallin laajennus

Nykyinen `FinancialYear` ei riitä Excelin mukaisiin talousnäkymiin. Tarvitaan myöhemmässä PR:ssä ainakin:

### 16.1 FinancialAccount

* account id
* tilinumero
* nimi
* tyyppi: income/expense/asset/liability/equity
* ryhmä
* ohjattavuus
* aktiivisuus
* lähteet

### 16.2 FinancialEntry

* account id
* vuosi
* budget amount
* actual amount
* notes
* sourceIds

### 16.3 BalanceSheetSnapshot

* vuosi tai päiväys
* vastaavaa/vastattavaa-erät
* lähteet

### 16.4 BalanceEntry

* tase-erän tunniste
* nimi
* määrä
* luokka
* lähteet

Näillä voidaan toteuttaa:

* Tulot
* Kulut ryhmittäin
* Kulut tileittäin
* Budjetti vs. toteuma
* Taloudellinen asema

\---

## 17\. Virhekoodit ja käsittely

Keskeiset domain-virheet:

* `INVALID\_ADMIN\_DATA`
* `INVALID\_ADMIN\_OPERATION`
* `ADMIN\_DATA\_NOT\_FOUND`
* `ADMIN\_DATA\_ALREADY\_EXISTS`
* `ADMIN\_REVISION\_CONFLICT`
* `PUBLISHED\_DATA\_NOT\_FOUND`
* `PUBLISHED\_VERSION\_CONFLICT`
* `INVALID\_PUBLISHED\_DATA`
* `NO\_PUBLICATION\_CHANGES`
* `INVALID\_SESSION\_DATA`
* `SESSION\_NOT\_FOUND`
* `SESSION\_REVISION\_CONFLICT`
* `SESSION\_EXPIRED`
* `DATABASE\_INTEGRITY\_ERROR`
* `UNAUTHENTICATED`
* `ACCESS\_DENIED`

UI:n pitää näyttää virheet käyttäjälle ymmärrettävinä, mutta tekniset sisäiset debug-tiedot eivät kuulu tuotantoon.

\---

## 18\. Hyväksymissäännöt

### 18.1 Admin

* Kirjautumaton käyttäjä ei voi ladata tai muuttaa admin-työtilaa.
* Admin voi ladata työtilan vain, jos active admin grant löytyy.
* Tallennus käyttää `expectedRevision`-arvoa.
* Revision conflict näyttää käyttäjälle päivitystarpeen.
* Validaatiovirhe kertoo, mitä kenttää pitää korjata.

### 18.2 Julkaisu

* Julkaisu luo uuden version vain, jos admin-revisio vastaa odotettua.
* Sama sisältö ei luo uutta julkaisua.
* Julkaisu ei sisällä suggested/cancelled-admin-dataa normaalina visitor-datana.

### 18.3 Visitor

* Visitor-session muutokset ovat väliaikaisia.
* Visitor voi palauttaa lähtötilan.
* Session vanheneminen näytetään selkeästi.
* Visitor ei saa admin-oikeuksia.

### 18.4 DATA GAP

* Puuttuva kustannus ei muutu nollaksi.
* DATA GAP listataan ja vaikuttaa forecastComplete-arvoon.
* Skenaario- ja kassapolkunäkymät ilmoittavat, jos ennuste on epätäydellinen.

\---

## 19\. Testisuunnitelma

Vähintään seuraavat testit pitää säilyttää tai lisätä:

* admin snapshotin validointi,
* rakennusosan lisäys ja muokkaus,
* havaintojen asset-viitteet,
* kustannusnäytön data\_gap-säännöt,
* event schedule -rivin validointi,
* optimistic/base/stress-projektiot,
* DATA GAPien horisonttiluokittelu,
* likviditeetin unavailable-tila,
* required collection -laskenta,
* julkaisun revision conflict,
* visitor-session reset,
* admin access grant -tarkistus,
* JWT-authin happy path ja virhepolut,
* Postgres repositoryn metadata/payload-eheys.

\---

## 20\. Claude Code -handoff

Claude Codelle annettava ensisijainen rajaus:

1. Älä muuta toimivaa auth-, Cloudflare-, Hyperdrive- tai access-grant-ratkaisua.
2. Älä palauta debug-endpointteja.
3. Älä toteuta Excel-välilehtiä yksi yhteen.
4. Toteuta UI-vaihe 1: sovelluskehys, Yleiskuva, Taloyhtiö-lomake ja Rakennusosat-näkymä.
5. Piilota raw JSON-batch kehittäjäpaneeliin.
6. Käytä nykyisiä admin-operaatioita.
7. Älä tee vielä tilikohtaista talousmallia.
8. Tee talousmallista erillinen ehdotus myöhempään PR:ään.
9. Aja testit ja build.
10. Luo PR, älä mergeä ilman hyväksyntää.


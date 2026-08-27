# Taloyhtiö Manager – UI-malli ja toimintalogiikka

## 1. Tavoite

Tämän dokumentin tarkoitus on toimia Taloyhtiö Managerin käyttöliittymän ja toimintalogiikan hyväksyttynä lähtötasona ennen Claude Code -toteutusta.

Lähdepohja:

- `taloyhtio terminaali.xlsx`
- nykyinen V2.8a-domain ja validaatiosäännöt
- toimiva Cloudflare Worker + Supabase Auth + Hyperdrive/PostgreSQL
- keskustelussa tehdyt rakennepäätökset

Keskeinen periaate: **sovellusta ei rakenneta Excel-välilehtien yksi yhteen -kopioksi**, vaan käyttäjän tehtävien ympärille.

---

## 2. Tuotteen kolme data- ja käyttötilaa

### 2.1 Admin-työversio

- Pysyvä muokattava tietosisältö.
- Jokaisella tallennuksella on `expectedRevision`.
- Muutokset tehdään domain-operaatioina.
- Raaka JSON-batch jää vain piilotettuun kehittäjäpaneeliin.

### 2.2 Julkaisu

- Muuttumaton versio yhdestä admin-revisiosta.
- Julkaisu sisältää lähdetunnisteet ja selityksen.
- Julkinen näkymä lukee aina julkaistua versiota, ei admin-työtilaa.

### 2.3 Visitor-sessio

- Väliaikainen työtila julkaistun version päällä.
- Visitor voi kokeilla vuosia, kustannuksia, poistoja ja likviditeettioletuksia.
- Visitor-muutokset eivät koskaan muuta admin-dataa tai julkaistua versiota.
- Sessio voidaan palauttaa julkaistuun lähtötilaan.

---

## 3. Päänavigaatio

### 3.1 Yleiskuva

Dashboard, jonka tarkoitus on kertoa yhdellä silmäyksellä:

- nykyinen kassa
- toimintapuskurin tavoite
- tunnetut korjauskustannukset seuraavan 5 vuoden aikana
- DATA GAP -rivien määrä
- budjetin ja toteuman kokonaispoikkeama
- työrevisio ja viimeisin julkaisuversio
- ensimmäinen mahdollinen puskurivaje skenaarioittain

Yleiskuva ei ole muokkauslomake. Jokainen poikkeama tai puute toimii linkkinä oikeaan näkymään.

### 3.2 Talous

Alanäkymät:

1. **Yhteenveto**
2. **Tulot**
3. **Kulut ryhmittäin**
4. **Kulut tileittäin**
5. **Budjetti vs. toteuma**
6. **Taloudellinen asema**

### 3.3 Kunnossapito

Alanäkymät:

1. **Rakennusosat**
2. **Havainnot**
3. **Korjaustapahtumat**
4. **Kustannusnäyttö**

### 3.4 Skenaariot ja likviditeetti

Alanäkymät:

1. **Skenaariot**
2. **Kassapolku**
3. **Vastiketarve**

### 3.5 Julkaisu

- julkaisuvalmius
- työversion ja viimeisimmän julkaisun erot
- DATA GAP -varoitukset
- julkaisuversiohistoria
- public-preview

### 3.6 Asetukset / kehittäjäpaneeli

Normaalikäyttäjältä piilotettu alue:

- health check
- raw admin-batch JSON
- tekniset tunnisteet
- mahdolliset import-diagnostiikat

---

## 4. Yleinen layout

### Desktop

- Vasen kiinteä sivupalkki pääalueille.
- Yläpalkissa:
  - taloyhtiön valinta
  - talousvuosi
  - skenaariohorisontti
  - kirjautunut käyttäjä
  - tallennus-/lataustila
- Pääsisältö:
  - sivuotsikko
  - kuvaava apurivi
  - suodattimet
  - KPI-kortit
  - taulukko, aikajana tai lomake
  - valitun rivin detaljipaneeli oikealla

### Mobiili

- Sivupalkki muuttuu hamburger-valikoksi.
- Taulukot vaihtuvat korttilistoiksi tai vaakavieritettäviksi.
- Detaljipaneeli avautuu koko ruudun näkymäksi.

### Tila- ja virhenäytöt

Jokaisessa näkymässä on oltava:

- loading skeleton
- tyhjä tila ja selkeä ensimmäinen toiminto
- virhetila
- käyttöoikeusvirhe
- revision conflict -tila
- tallennettu / tallennetaan -indikaattori

---

## 5. Excel-välilehtien lopullinen käsittely

| Excel-välilehti | Päätös | Uusi sijainti |
|---|---|---|
| Ohje | Korvataan sivukohtaisilla ohjeilla | Kontekstuaaliset info-laatikot |
| Kulut | Supistetaan | Talous → Kulut ryhmittäin |
| Rakennusosat | Säilytetään ja normalisoidaan | Kunnossapito → Rakennusosat |
| Kuluva kausi 2026 | Yhdistetään | Korjaustapahtumat + vuosisuodatin |
| Pitkä aikaväli | Poistetaan | Varaajat asset/event/schedule-malliin |
| Skenaariot | Uudistetaan | Skenaariot ja likviditeetti |
| Kulut tileittäin | Säilytetään | Talous → Kulut tileittäin |
| Tulot | Supistetaan | Talous → Tulot |
| Taloudellinen asema | Säilytetään | Talous → Taloudellinen asema |
| Budjettitarkkuus | Säilytetään ja järjestetään | Talous → Budjetti vs. toteuma |

---

## 6. Talousnäkymien logiikka

### 6.1 Tulot

Tarkoitus: näyttää mistä raha tulee ja miten tulot kehittyvät.

Päänäkymän sarakkeet:

1. Ryhmä
2. Toteuma 2023
3. Toteuma 2024
4. Toteuma 2025
5. Budjetti 2026
6. Muutos 2024 → 2025
7. Osuus tuloista
8. Huomio

Historiallisia budjetteja ei näytetä tässä näkymässä. Ne kuuluvat Budjetti vs. toteuma -näkymään.

Tilitason hoitovastike-erittely avautuu ryhmän detaljissa tai omassa alataulukossa.

### 6.2 Kulut ryhmittäin

Tarkoitus: näyttää mihin raha menee ja miten kulut kehittyvät.

Päänäkymän sarakkeet:

1. Ryhmä
2. Luonne: hoito / korjaus
3. Ohjattavuus: kiinteä / muuttuva / sekä
4. Toteuma 2023
5. Toteuma 2024
6. Toteuma 2025
7. Budjetti 2026
8. Muutos 2024 → 2025
9. Huomio

Poistetaan tästä näkymästä:

- Budjetti 2023
- Budjetti 2024
- Budjetti 2025
- Poikkeama 2025

### 6.3 Kulut tileittäin

Säilytettävä ydinrakenne:

1. Tili
2. Nimi
3. Toteuma 2023
4. Toteuma 2024
5. Toteuma 2025
6. Budjetti 2026
7. Budjetti 2026 vs. Toteuma 2025
8. Huomio

Toiminnot:

- haku tilinumerolla tai nimellä
- ryhmäsuodatin
- rivin lähteet ja vuosikohtaiset muistiinpanot detaljissa

### 6.4 Budjetti vs. toteuma

Tämä on ainoa näkymä, jossa historiallista budjettia verrataan toteumaan.

Luonnollinen lukusuunta:

1. Budjetti
2. Toteuma
3. Erotus €
4. Erotus %
5. Huomio

Vuosi valitaan suodattimella, eikä kaikkia vuosia näytetä yhdessä erittäin leveässä taulukossa.

Kaava:

`Erotus = Toteuma − Budjetti`

Tulkinta:

- kulut: positiivinen erotus = ylitys = epäedullinen
- tulot: positiivinen erotus = budjetin ylitys = suotuisa
- jos budjetti on 0, erotusprosentti jätetään tyhjäksi

Yläosan KPI:t:

- kokonaisbudjetti
- kokonaistoteuma
- nettoerotus
- kategorioiden keskimääräinen absoluuttinen poikkeama

### 6.5 Taloudellinen asema

Näkymä vertailee kahta tasesnapshotia.

Näytettävät kokonaisuudet:

- pysyvät vastaavat
- vaihtuvat vastaavat
- oma pääoma
- velat
- taseen täsmäytys
- maksuvalmius
- kassa kuukausina hoitokuluja
- korollinen vieras pääoma

Taseen erät ja summat näytetään UI:ssa todellisella etumerkillään, kuten tilinpäätöksessä. Tämä ei tarkoita itseisarvon ottamista: aidosti negatiivinen erä (esim. kertynyt tappio "Kertyneet voittovarat") näkyy miinuksena, koska etumerkki on siinä merkityksellistä tietoa. Sääntö "esitetään positiivisina" kuvaa normaalitapausta, jossa lähdedatassa ei ole etumerkkikummallisuuksia — ei ohjetta pakottaa kaikki erät positiivisiksi (`Math.abs`), sillä se vääristäisi täsmäytyksen ja tunnusluvut aidosti negatiivisilla erillä.

---

## 7. Kunnossapidon logiikka

### 7.1 Rakennusosat

Rakennusosa on kuvaileva tietue, ei automaattinen tapahtumageneraattori.

Peruskentät:

- nimi
- kategoria
- aktiivinen
- viimeisin toimenpide ja vuosi
- arvioitu käyttöikä / arvioikkuna
- tietolähteen taso
- lähdetunnisteet
- huomio

Tärkeä sääntö: käyttöikä tai arvioikkuna saa antaa käyttäjälle vihjeen, mutta järjestelmä ei luo automaattisesti korjaustapahtumaa tai toistuvaa sykliä.

### 7.2 Havainnot

Havainto kuuluu aina rakennusosaan.

Kentät:

- rakennusosa
- havaintopäivä
- kuvaus
- lähteet

Havainnosta voidaan luoda korjaustapahtuma. Linkitys säilytetään.

### 7.3 Korjaustapahtumat

Tilat:

- suggested
- approved
- actual
- cancelled

Päänäkymä sisältää suodattimet:

- vuosi
- tila
- tyyppi
- rakennusosa
- DATA GAP / kustannus tiedossa

`Kuluva kausi 2026` ei ole oma sivu. Vastaava sisältö saadaan oletussuodattimella `Vuosi = nykyinen vuosi`.

Future-event vaatii vähintään yhden skenaariorivin, paitsi cancelled-event.

### 7.4 Kustannusnäyttö

Kustannuksen lähteet:

- actual
- quote
- estimate
- estimate_from_actual
- data_gap

Kentät:

- rakennusosa tai tapahtuma
- summa
- yksikkö
- määrä
- hintatasovuosi
- ALV sisältyy
- havaintopäivä
- voimassaolo
- lähde-URL tai lähdetunniste
- huomio

Tuntematon kustannus on nimetty DATA GAP, ei nolla.

---

## 8. Pitkä aikaväli -välilehden migraatio

Välilehti poistetaan vasta, kun tiedot on siirretty.

Lämminvesivaraajat mallinnetaan näin:

1. `Asset`: Lämminvesivaraajat
2. `CostEvidence`: yksikköhinta 1 800 €/kpl, status estimate, lähde ja hintatasovuosi
3. `BuildingEvent`: Varaajien uusiminen
4. `EventScheduleEntry`: tarkat vuodet, määrät ja skenaariot

Skenaariot eivät perustu piilotettuihin Varma/Perus/Paha-summauksiin.

Käyttöliittymän aputoiminto:

- “Kopioi rivi kaikkiin skenaarioihin” varmaa kustannusta varten
- käyttäjä voi sen jälkeen muuttaa perus- ja stressiriviä erikseen

Skenaarioiden nimet:

- optimistic / Optimistinen
- base / Perusura
- stress / Stressi

---

## 9. Skenaariot ja likviditeetti

### 9.1 Skenaarionäkymä

Lähdedata:

- hyväksytyt korjaustapahtumat
- tarkat skenaariorivit
- kustannusnäyttö
- hintatasovahvistukset

Näytetään:

- vuosittaiset tunnetut kustannukset
- tapahtumamäärä
- määrä
- DATA GAPit
- ennen horisonttia, horisontissa ja horisontin jälkeen olevat tapahtumat

### 9.2 Kassapolku

Lähtötiedot:

- lähtökassa
- 12 kuukauden hoitokulut
- nykyinen vuosittainen korjauskeräys
- puskurikuukaudet tai käyttäjän euromääräinen override

Vuosirivit:

- avaava kassa
- vuosikeräys
- tunnetut korjauskustannukset
- päättävä kassa
- puskuritavoite
- puskurin ylitys/alitus
- DATA GAPit

### 9.3 Vastiketarve

Näytetään skenaarioittain:

- tunnetuille kustannuksille vaadittu vuosikeräys
- nykyinen vuosikeräys
- lisäkeräystarve
- kuukausisummaa
- €/asunto/kk
- €/m²/kk, jos pinta-ala tunnetaan
- ensimmäinen rahoitustarpeen vuosi
- forecast complete / incomplete

---

## 10. Julkaisulogiikka

Julkaisuikkuna näyttää:

- työrevisio
- viimeisin julkaisuversio
- muutetut kokonaisuudet
- validointituloksen
- DATA GAP -varoitukset
- lähdetunnisteen
- selityksen

Julkaisun portit:

- rikkinäinen viite tai invalidi snapshot estää julkaisun
- nimetty DATA GAP ei muutu nollaksi
- DATA GAP voi olla julkaistava varoitus, mutta ennuste merkitään puutteelliseksi

Julkaisu on aina muuttumaton. Korjaus tehdään uuteen admin-revisioon ja julkaistaan uutena versiona.

---

## 11. Tarvittavat tietomallilaajennukset

Nykyinen backend kattaa jo:

- taloyhtiön perustiedot
- rakennusosat
- havainnot
- korjaustapahtumat
- kustannusnäytön
- hintatasovahvistukset
- likviditeetin lähtötiedot
- skenaariot
- julkaisut
- visitor-session

Nykyinen `FinancialYear` sisältää vain vuositason kokonaisluvut. Excelin talousnäkymiä varten tarvitaan uusi tilitason malli.

### Ehdotus: FinancialAccount

- accountCode
- name
- kind: income / expense
- group
- nature: maintenance / repair
- controllability: fixed / variable / mixed
- active

### Ehdotus: FinancialEntry

- accountCode
- year
- budgetAmount
- actualAmount
- sourceIds
- notes

### Ehdotus: BalanceSheetSnapshot

- asOfDate
- sourceIds
- entries

### Ehdotus: BalanceEntry

- section
- accountCode tai key
- name
- amount
- notes

Vuositason `FinancialYear` voidaan säilyttää johdettuna tai cachettuna koontina.

---

## 12. Toteutusvaiheet

### Vaihe 1 – UI-runko ja pienet lomakkeet

- vasen navigaatio ja topbar
- Yleiskuva
- Taloyhtiö-lomake
- Rakennusosat-lomake
- raw batch kehittäjäpaneeliin

Hyväksymiskriteeri: normaalikäyttö ei vaadi JSONin kirjoittamista perustietojen tai rakennusosien tallentamiseen.

### Vaihe 2 – Kunnossapito ja skenaariot

- havainnot
- korjaustapahtumat
- kustannusnäyttö
- likviditeetti
- skenaariot
- Kuluva kausi 2026 -datan migraatio
- Pitkä aikaväli -datan migraatio

Hyväksymiskriteeri: lämminvesivaraajien skenaariot syntyvät normaalista asset/event/cost evidence -mallista.

### Vaihe 3 – Talousmalli

- tietomalli ja migraatiot tileille ja vuosiriveille
- Tulot
- Kulut ryhmittäin
- Kulut tileittäin
- Budjetti vs. toteuma

Hyväksymiskriteeri: Budjetti näkyy ennen toteumaa ja budjettivertailu on keskitetty yhdelle sivulle.

### Vaihe 4 – Taloudellinen asema ja julkaistava talousdata

- tasesnapshotit
- tunnusluvut
- julkaisumallin laajennus
- visitor-talouden yhteenveto

### Vaihe 5 – Viimeistely

- responsiivisuus
- saavutettavuus
- import-toiminto Excel-/CSV-aineistolle
- kattavat testit
- audit trail
- loading/error/empty states

---

## 13. Claude Code -rajat

Claude Codelle annettavat pakolliset rajat:

1. Älä muuta toimivaa Cloudflare-, Supabase-, Hyperdrive-, JWT- tai access-grant-polkuja ilman erillistä hyväksyntää.
2. Älä kopioi Excel-välilehtiä yksi yhteen.
3. Älä tee automaattista elinkaaritapahtumageneraattoria.
4. Poista Pitkä aikaväli vasta datamigraation jälkeen.
5. Korvaa Kuluva kausi -sivu tapahtumasuodattimella.
6. Budjettitarkkuuden järjestys on Budjetti → Toteuma → Erotus.
7. Tuntematon kustannus on DATA GAP, ei nolla.
8. Tee skeemamuutokset migraatioina ja lisää repository-/domain-testit.
9. Työskentele feature-branchilla ja avaa PR.
10. Aja typecheck, testit ja worker build ennen PR:ää.

---

## 14. Ensimmäisen Claude Code -tehtävän suositeltu rajaus

Ensimmäisessä PR:ssä tehdään vain vaihe 1:

- uusi app shell
- navigaatio
- Yleiskuva
- Taloyhtiö-lomake
- Rakennusosat-lomake
- nykyisen admin-workspace endpointin käyttö
- domain-operaatiot nykyiseen `/changes`-endpointiin
- raw JSON-batch piilotetaan kehittäjäpaneeliin
- nykyinen auth ja julkaisu säilytetään

Talousmallia tai tietokantamigraatioita ei vielä tehdä ensimmäisessä PR:ssä.

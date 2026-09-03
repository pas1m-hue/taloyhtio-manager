# Claude Code -tehtävä: laskettu 12 kk hoitokulu myös likviditeettimalliin

Seurantatehtävä PR:lle *feature/trailing-12m-operating-costs*. Ei kiireellinen,
mutta **ei saa unohtua** — se jättää jälkeensä tiedossa olevan
epäjohdonmukaisuuden, joka ilman tätä dokumenttia raportoidaan myöhemmin bugina
ja selvitetään uudelleen alusta.

## 0. Tiedossa oleva epäjohdonmukaisuus — lue tämä ensin

Sovelluksessa on tällä hetkellä **kaksi eri 12 kk hoitokulua rinnakkain**:

| Missä | Mikä luku | Mistä |
|-|-|-|
| Tunnusluku "Kassa kuukausina hoitokuluja" (Taloudellinen asema) | **38 644,50 €** | laskettu tilidatasta, `computeTrailing12mOperatingCosts()` |
| Puskuritavoite ja kassapolku (likviditeettimalli, sekä admin- että visitor-näkymä) | **34 029,46 €** | tallennettu `LiquidityBaselineRecord.trailing12mOperatingCosts`, käsin syötetty |

**Tämä on tietoinen ja hyväksytty tila, ei bugi.** Se on seurausta siitä, että
edellinen tehtävä rajattiin tarkoituksella tunnuslukuun. Tämän tehtävän tarkoitus
on poistaa se.

Jos huomaat että puskuritavoite ei vastaa tunnusluvun jakajaa: se on tässä
kuvattu tilanne. Älä "korjaa" sitä kirjoittamalla laskettua lukua käsin
lähtötietueeseen — se palauttaisi täsmälleen sen vikatilan (käsin syötetty luku,
joka vanhenee huomaamatta) jonka poistamiseksi laskenta rakennettiin.

## 1. Miksi tätä ei tehty samalla kertaa

Estävä syy on rakenteellinen, ei ajanpuute:

- `PublishedDataSnapshot` (`src/domain/types.ts:592`) **ei sisällä**
  `financialAccounts`- eikä `financialEntries`-kokoelmia. Julkaistu data ei siis
  tunne tilidataa lainkaan.
- `CalculationSnapshot` (`src/readModels/calculationReadModel.ts:40`) poimii vain
  `housingCompany`, `liquidityBaselines`, `assets`, `events`, `costEvidence` ja
  `priceLevelConfirmations`. Sama laskenta-komposiitti palvelee sekä admin- että
  julkaisupuolta, joten sitä ei voi ruokkia tilidatalla vain toisella puolella
  ilman että admin ja visitor alkavat näyttää eri lukuja.

Laajennus koskisi siis tietomallia, julkaisuputkea, `validateAdminDataSnapshot`ia
ja `withDefaultedAdminCollections()`ia — ja muuttaisi kassapolun lukuja kaikissa
näkymissä. Edellisen handoffin §7 rajasi sen nimenomaisesti ulos.

## 2. Mitä pitää tehdä

1. Lisää `financialAccounts` ja `financialEntries` `PublishedDataSnapshot`iin ja
   julkaisuputkeen (`src/publishing/`), sekä `CalculationSnapshot`in poimintaan.
2. **`withDefaultedAdminCollections()` (`src/database/postgresPublishingRepository.ts:305`)
   ja sen julkaisupuolen vastine:** uudet kokoelmat on oletusarvoistettava
   tyhjäksi taulukoksi. Tämä bugi on osunut jo kahdesti (3A, ja
   financialAccounts/financialEntries oikeaa Supabase-dataa vasten) — JSONB-blob
   ei migratoidu, joten vanha rivi yksinkertaisesti puuttuu avaimen.
   Regressiotesti pakollinen.
3. Siirrä `computeTrailing12mOperatingCosts()`in logiikka jaettuun muotoon.
   Nykyinen toteutus on `public/adminOperationPayloads.js`:ssä (selainpuolen
   moduuli); `src/liquidity/`-puoli tarvitsee saman laskennan. **Älä kopioi sitä**
   — kaksi toteutusta erkanee. Joko siirrä laskenta `src/`-puolelle ja tuo se
   selainmoduuliin, tai päinvastoin; ratkaise se koodin todellisen
   riippuvuussuunnan mukaan.
4. Kytke laskettu arvo `buildSnapshotCalculations()`in ja
   `buildSessionLiquidityModel()`in (`src/session/buildSessionLiquidity.ts`)
   käyttämäksi jakajaksi `latest.trailing12mOperatingCosts`in sijaan.
5. Päätä mitä `LiquidityBaselineRecord.trailing12mOperatingCosts`-kentälle
   tapahtuu. Vaihtoehdot: kenttä poistuu (silloin tarvitaan siirtymä vanhoille
   riveille), tai se jää mutta lakkaa olemasta laskennan lähde. Suositus:
   jälkimmäinen ensin, poisto vasta kun mikään ei enää lue sitä.
6. DATA GAP -käsittely pysyy: jos laskenta palauttaa `status: "unavailable"`,
   likviditeetti on `unavailable` puuttuvine kenttineen — **ei nollaa eikä
   paluuta käsinsyötettyyn arvoon.**

## 3. Mitä EI tarvitse selvittää uudelleen

- **Poistot eivät sisälly kulutoteumiin.** Tämä on tarkistettu ja suljettu
  (edellisen handoffin §4). Todiste: 2025 hoitokate 43 906,75 − 37 911,01 =
  5 995,74, kertyneiden voittovarojen muutos 5 173,74, erotus täsmälleen 822,00 €
  = rakennusten poisto (tase 1 593 017,83 → 1 592 195,83). Poisto vähennetään
  hoitokatteen alapuolella, ei kuluryhmissä. Perustelu on kirjattu
  `computeTrailing12mOperatingCosts()`in doc-kommenttiin — lue se sieltä, älä
  johda uudelleen.
- **Kaava on päätetty:** viimeisimmän toteumavuoden kulut ilman korjauksia +
  korjaustoteumien keskiarvo kaikilta vuosilta joilla on toteumaa. Epäsymmetria
  on tarkoituksellinen.
- **Ohut otos on hyväksytty rajoite.** Ei erikoistapauksia sen varalle.

## 4. Testit

- Puskuritavoite ja kassapolku käyttävät laskettua jakajaa, admin ja visitor
  samaa lukua.
- Julkaisu kantaa tilidatan mukanaan; vanha julkaisurivi ilman uusia avaimia
  latautuu kaatumatta (`withDefaultedAdminCollections()`).
- Laskennan `unavailable` → likviditeetti `unavailable`, ei nollaa.
- Regressio: tunnusluku "Kassa kuukausina" pysyy samana (se laskee jo oikein),
  eikä laskentaa ole enää kahdessa paikassa.

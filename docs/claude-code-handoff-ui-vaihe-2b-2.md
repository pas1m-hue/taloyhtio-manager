# Claude Code -tehtävä: Taloyhtiö Manager, vaihe 2B-2 (datan seed-skripti)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä prompt on itsenäinen. Vaihe 1, 2A, 2B-1 on jo toteutettu ja **mergattu mainiin**. Tämä on **vaihe 2B-2**: kertakäyttöinen seed-skripti joka syöttää alkuperäisen Excel-datan (lämminvesivaraajat + Kuluva kausi 2026) tietokantaan sovelluksen oman APIn kautta.

## 0. Lue ensin

Lähdedokumentit (repossa `docs/product-spec/`):
- `taloyhtio_terminaali.xlsx` — välilehdet **"Pitkä aikaväli"** (lämminvesivaraajat) ja **"Kuluva kausi 2026"** (tarkat luvut alla, mutta lue Excel varmistukseksi)
- `Taloyhtio_Manager_V2_8a_tietomalli_ja_laskentasaannot_REKONSTRUOITU.md`

Lue myös: domain-tyypit `src/domain/types.ts` (`Asset`, `CostEvidence`, `Observation`, `FutureBuildingEvent`, `EventScheduleEntry`, `LiquidityBaselineRecord`, `AdminDataOperation`), validointi `src/admin/adminDataValidation.ts`, batch-sovellus `src/admin/applyAdminBatch.ts`, ja HTTP-kontrakti `HTTP_API.md` (`POST /admin/companies/:companyId/changes`).

## 1. Nykyinen toimiva tila — älä riko näitä

Mainissa on kolme valmista vaihetta (1, 2A, 2B-1). Kaikki näkymät toimivat. Tuotannon perusta (Cloudflare Worker, Supabase Auth, Hyperdrive/PostgreSQL, käyttöoikeudet) pysyy **täysin koskemattomana**. Tämä tehtävä **ei muuta yhtään olemassa olevaa tiedostoa** paitsi lisää uuden `scripts/`-kansion ja mahdollisesti dokumentaation — se on erillinen työkalu, ei osa sovellusta eikä Worker-buildia.

## 2. Työskentelytapa

1. Luo branch **`feature/seed-initial-data`** tuoreesta mainista (`git checkout main && git pull` ensin).
2. Ensimmäisessä vastauksessasi **älä koodaa** — palauta toteutussuunnitelma ja odota hyväksyntää.
3. Toteuta pieninä committeina. Aja `npm run typecheck` ja `npm test` jokaisen jälkeen.
4. Committoi tämä handoff (`docs/claude-code-handoff-ui-vaihe-2b-2.md`) branchin ensimmäisenä committina.
5. **Älä committoi salaisuuksia eikä admin-tokenia.** Token luetaan ympäristömuuttujasta ajohetkellä (ks. 4).

## 3. Tehtävän rajaus

Toteutettava: **yksi idempotentti seed-skripti** `scripts/seed-initial-data.ts`, joka syöttää lämminvesivaraaja- ja Kuluva kausi 2026 -datan `housing_company_demo`-yhtiöön kutsumalla `POST /admin/companies/:companyId/changes` -endpointtia yhtenä atomisena batchina.

Ei UI-muutoksia. Ei domain-muutoksia. Ei migraatioita. Ei tuotantokoodin muutoksia.

## 4. Miten seed toimii (vahvistettu koodista)

- Seed kutsuu `POST /admin/companies/housing_company_demo/changes` -endpointtia admin-tokenilla, rakenteella `{ expectedRevision, horizon, operations[] }` — sama polku ja validointi kuin UI (hyväksytty vaihtoehto: sovelluksen oman APIn kautta, ei suoraa DB-kirjoitusta).
- **Autentikointi (hyväksytty vaihtoehto A):** admin-token luetaan **ympäristömuuttujasta** ajohetkellä (esim. `TM_ADMIN_TOKEN`). Ei kovakoodattu, ei committoitu. Skripti kaatuu selkeällä virheellä jos muuttuja puuttuu. Kohde-URL (esim. `https://taloyhtio-manager.pas1m.workers.dev` tai `http://127.0.0.1:8787`) myös ympäristömuuttujasta tai argumentista.
- **`expectedRevision`:** seed hakee ensin nykyisen työtilan (`GET .../workspace`) saadakseen ajantasaisen `adminRevision`in ja käyttää sitä batchissa.

### 4.1 Operaatioiden järjestys on pakollinen (ristiviittausvalidointi)

`applyAdminBatch` ajaa operaatiot **peräkkäin kertyvään snapshotiin** ja validoi ristiviittaukset heti: havainto/costEvidence vaatii että sen `assetId` on jo luotu; building event -schedule-rivi vaatii että `costEvidenceId` viittaa olemassa olevaan kustannusnäyttöön; event joka linkittää havaintoon vaatii että havainto on olemassa ja koskee samaa rakennusosaa. **Operaatiot on siis järjestettävä riippuvuusjärjestykseen samassa `operations[]`-taulukossa:** ensin assetit → sitten costEvidencet → sitten (mahd.) observationit → sitten building eventit (jotka viittaavat costEvidenceen).

### 4.2 Idempotenssi (hyväksytty: turvatarkistus + kieltäytyminen)

`applyAdminBatch` hylkää duplikaatit (`DUPLICATE_ADMIN_OPERATION`), ja optimistinen lukitus tarkoittaa että **seedin voi ajaa turvallisesti vain kerran.** Siksi:
- Seed **hakee ensin nykyisen työtilan** ja tarkistaa onko seed-data jo olemassa (esim. onko lämminvesivaraaja-asset `assetId`llä jo `assets`-listassa).
- Jos on → seed **kieltäytyy ajamasta** ja tulostaa selkeän viestin ("Seed on jo ajettu, ei tehdä mitään"), poistuen ilman muutoksia. **Ei "poista ja luo uudelleen"** — se voisi pyyhkiä käsin tehtyjä muutoksia.
- Jos ei → seed ajaa koko batchin.
- Skripti tulostaa selkeän yhteenvedon: mitä luotiin, uusi revisio.

### 4.3 Yksi atominen batch

Koko seed (kaikki assetit, costEvidencet, event, ~30 schedule-riviä, liquidity baseline) menee **yhteen `operations[]`-taulukkoon**, joka joko onnistuu tai epäonnistuu kokonaan. Ei osittaista tilaa.

## 5. Syötettävä data (Excelin tarkat luvut)

Kaikki data on **kertaluontoista aloitusdataa**, jota käyttäjä voi vapaasti muokata UI:sta jälkikäteen (rakennusosat, kustannukset, schedule-rivit). `sourceIds` ja `explanation` annetaan jokaiselle operaatiolle (esim. sourceId "excel_terminaali_2026", explanation kuvaa mistä data tulee).

### 5.1 Lämminvesivaraajat
- **Asset**: id esim. `asset_lammin_vesi_varaajat`, name "Lämminvesivaraajat", category `hvac`, active true.
- **CostEvidence**: id esim. `cost_varaaja_yksikko`, assetId sama, status `estimate`, amount 1800, unit "kpl", priceLevelYear 2026, notes "Karkea arvio (ei muistettu tarkkaa summaa) — tärkeä tarkentaa seuraavan vaihdon yhteydessä". Lähde pakollinen (sourceId).
- **FutureBuildingEvent**: id esim. `event_varaajien_uusiminen`, assetId sama, title "Varaajien uusiminen", type `replacement`, status `suggested`, origin `initial_excel`.
- **Schedule-rivit** (jokainen: scenario, year, quantity, costEvidenceId = `cost_varaaja_yksikko`, uniikki id). Excelin "Pitkä aikaväli" -taulukon mukaan (vain rivit joissa kpl > 0):
  - **optimistic** (A, yht. 5 kpl): 2027=1, 2030=1, 2033=1, 2036=1, 2039=1
  - **base** (B, yht. 12 kpl): 2026=1, 2027=1, 2028=1, 2029=2, 2030=2, 2031=2, 2032=1, 2033=1, 2034=1
  - **stress** (C, yht. 12 kpl): 2028=5, 2029=2, 2030=2, 2031=2, 2032=1
  - **Tarkista nämä luvut Excelistä ennen syöttöä** — ne ovat mallin ydin. amount per rivi voidaan jättää pois (johdetaan costEvidencestä) tai asettaa quantity × 1800; noudata domain-mallin sallimaa muotoa (amount on valinnainen schedule-rivillä).

### 5.2 Kuluva kausi 2026
- **LiquidityBaseline**: id esim. `liquidity_2026`, asOfDate "2025-12-31", currentCash **22208.49**, currentAnnualRepairCollection **9680**, `trailing12mOperatingCosts` = **DATA GAP** (ks. alla), sourceIds pakollinen.
  - **⚠ trailing12mOperatingCosts puuttuu Excelistä.** Domain-malli vaatii sen (ei-negatiivinen). Excelin "Kuluva kausi 2026" ei anna 12 kk hoitokuluja. **Älä keksi lukua.** Tämä on nimenomainen DATA GAP — nosta se suunnitelmassa esiin ja **kysy käyttäjältä oikea arvo** (tai vahvistus jostain toisesta lähteestä, esim. tilinpäätöksestä) ennen seedin ajoa. Jos arvoa ei ole, seed ei voi luoda kelvollista liquidity baselinea.
- **Ilmanvaihto-asset**: id esim. `asset_ilmanvaihto`, name "Ilmanvaihto", category `hvac`, active true.
- **Ilmanvaihdon puhdistus -costEvidence**: id esim. `cost_ilmanvaihto_puhdistus`, assetId `asset_ilmanvaihto`, status **`data_gap`** (EI amount-kenttää — L-004), unit esim. "erä", priceLevelYear 2026, notes/lähde "Hallituksen kunnossapitotarveselvitys 2024–2028". Tämä on oppikirja-DATA GAP: suunniteltu korjaus ilman hintaa.

## 6. Testit

Aja: `npm test`, `npm run typecheck`. Lisää testit seedin **puhtaalle logiikalle** (ei verkkokutsulle):
- Seed-operaatioiden **rakentaja** (funktio joka tuottaa `operations[]`-taulukon) erotetaan puhtaaksi, testattavaksi funktioksi. Testaa: oikea määrä operaatioita, oikea järjestys (assetit ennen niihin viittaavia), schedule-rivien lukumäärät per skenaario (optimistic 5, base 12, stress 12), data_gap-costEvidencellä ei amountia.
- Idempotenssitarkistuksen logiikka (annettu työtila jossa asset jo on → seed kieltäytyy; tyhjä → seed etenee) puhtaana funktiona.
- Jos mahdollista, aja rakennettu `operations[]` `applyAdminBatch`in läpi test-snapshotissa varmistaaksesi että se validoituu (kelvollinen data, oikeat ristiviittaukset) ilman oikeaa verkkoa/DB:tä.

**Älä** kirjoita testiä joka tekee oikean verkkokutsun tuotanto-APIin.

## 7. Ajo-ohje

Kirjoita `scripts/seed-initial-data.ts`:n alkuun tai erilliseen `scripts/README.md`:hen selkeä ajo-ohje: mitkä ympäristömuuttujat tarvitaan (`TM_ADMIN_TOKEN`, kohde-URL), miten token hankitaan (kirjautuneen adminin sessio), ja että se ajetaan **kerran**. Korosta ettei tokenia saa committoida.

## 8. Valmis lopputulos — raportoi

Commit-lista, luodut tiedostot, testitulokset, seedin rakentaman batchin sisältö (montako operaatiota, mitä), idempotenssitarkistuksen toteutus, ajo-ohje. **Nosta esiin `trailing12mOperatingCosts`-DATA GAP** ja kerro miten se on ratkaistava ennen ajoa. **Luo PR** (base main). **Älä mergeä. Älä aja seediä oikeaa tietokantaa vasten** — sen ajaa käyttäjä itse hallitusti kun DATA GAP on ratkaistu.

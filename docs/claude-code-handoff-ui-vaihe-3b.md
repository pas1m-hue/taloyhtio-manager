# Claude Code -tehtävä: Taloyhtiö Manager, UI-vaihe 3B (Tulot, Kulut ryhmittäin, Budjetti vs. toteuma)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Tämä prompt on itsenäinen. Vaiheet 1, 2A, 2B-1, 2B-2, 3A on toteutettu ja **mergattu mainiin**. Tämä on **vaihe 3B**: kolme jäljellä olevaa Talous-näkymää.

## 0. Lue ensin

Lähdedokumentit (repossa `docs/product-spec/`):
- `taloyhtio-manager-ui-ja-logiikka-spec.md` — erityisesti §6.1 (Tulot), §6.2 (Kulut ryhmittäin), §6.4 (Budjetti vs. toteuma), ja hyväksymiskriteeri "Budjetti näkyy ennen toteumaa" (§ lopun lista).
- `taloyhtio_terminaali.xlsx` — välilehdet Tulot, Kulut tileittäin, Budjettitarkkuus (lähdeaineistoa).

Lue myös 3A:n tuotos, jonka päälle tämä rakentuu: `public/app.js` (erityisesti `buildAccountCostsViewModel` ja Kulut tileittäin -näkymä, `renderFinancePlaceholders`, `DETAIL_PANEL_VIEWS`, `KNOWN_VIEWS`), `public/adminOperationPayloads.js` (talous-view-modelit ja jäsennin), `public/index.html` (finance-näkymien sektiot), `src/readModels/adminDashboard.ts` (tarjoaa jo `financialAccounts` + `financialEntries`), `public/viewWiring.test.js`.

## 1. Nykyinen toimiva tila — älä riko näitä

Mainissa on viisi valmista vaihetta. **3B on puhdas UI-vaihe:** se lukee `financialAccounts`/`financialEntries` (jotka read-model jo tarjoaa 3A:sta) ja esittää ne kolmena näkymänä. **Ei uusia domain-tyyppejä, ei uusia admin-operaatioita, ei read-model-muutoksia, ei tietokantaa, ei migraatioita.** Pelkkää näkymälogiikkaa + laskentaa + testejä.

Älä muuta auth-, JWKS-, Cloudflare-, Hyperdrive- tai tietokantapolkuja. Ei jsdomia, Playwrightia, frameworkia, bundleria. Vanilla HTML/CSS/JS. UI-kieli suomi. Säilytä olemassa olevat näkymät (ertyisesti 3A:n Kulut tileittäin ja Liitä tilidataa) ennallaan.

## 2. Työskentelytapa

1. Luo branch **`feature/ui-finance-views`** tuoreesta mainista (`git checkout main && git pull` ensin).
2. Ensimmäisessä vastauksessasi **älä koodaa** — palauta toteutussuunnitelma ja odota hyväksyntää.
3. Toteuta pieninä committeina. Aja `npm run typecheck` + `npm test` jokaisen jälkeen, lopuksi `npm run build:worker`.
4. Committoi tämä handoff (`docs/claude-code-handoff-ui-vaihe-3b.md`) branchin ensimmäisenä committina.

## 3. Tehtävän rajaus: kolme näkymää

Korvaa kolme placeholderia oikeilla näkymillä. **Kaikki data luetaan olemassa olevasta `financialEntries`/`financialAccounts`ista; kaikki johdetut luvut lasketaan — mitään ei syötetä.**

Yhteiset periaatteet:
- Vuosisarakkeet **johdetaan datasta** (älä kovakoodaa vuosia 2023–2026; jos data sisältää muita vuosia, ne näkyvät).
- Tyhjä arvo (ei dataa) esitetään "—", ei nollana (erottele puuttuva ja nolla, DATA GAP -henki).
- Suomalainen lukumuotoilu (pilkkudesimaali, €, tuhaterotin) kuten 3A:n Kulut tileittäin.
- Tyhjä tila jos ei talousdataa lainkaan ("Ei vielä talousdataa. Tuo se Liitä tilidataa -näkymästä.").
- Näkymät ovat vain-luku (ei muokkausta); data tulee tuonnista.

### 3.1 Tulot (§6.1)

Näyttää `kind=income`-tilit ryhmiteltyinä. Päänäkymän sarakkeet:
1. Ryhmä
2. Toteuma (per vuosi datasta, esim. 2023, 2024, 2025)
3. Budjetti (viimeisin budjettivuosi, esim. 2026)
4. **Muutos edellinen→viimeisin toteumavuosi** (esim. 2024→2025): laskettu erotus € ja/tai %. Käytä kahta viimeisintä peräkkäistä toteumavuotta joilta dataa on.
5. **Osuus tuloista**: tämän ryhmän osuus kokonaistuloista (%) viimeisimmältä toteumavuodelta. Laskettu.
6. Huomio (jos rivillä notes-tietoa)

- **Historiallisia budjetteja EI näytetä tässä** (vain viimeisin budjetti). Historiallinen budjetti-vs-toteuma kuuluu §3.3-näkymään.
- Ryhmätason summat; tilitason erittely (esim. hoitovastike-tilit 3000, 3002…) **ryhmän detaljissa** (rivin klikkaus → detaljipaneeli tilitason erittelyllä) tai alataulukkona. Käytä olemassa olevaa detaljipaneelikuviota jos luontevaa.

### 3.2 Kulut ryhmittäin (§6.2)

Näyttää `kind=expense`-tilit ryhmiteltyinä (sama data kuin Kulut tileittäin, mutta ryhmätasolla koostettuna). Päänäkymän sarakkeet:
1. Ryhmä
2. **Luonne**: hoito/korjaus (FinancialAccountin `nature`-kentästä; **näytä "—" jos puuttuu** — se on 3A:ssa jätetty tyhjäksi, hyväksytty)
3. **Ohjattavuus**: kiinteä/muuttuva/sekä (`controllability`-kentästä; **näytä "—" jos puuttuu**)
4. Toteuma (per vuosi datasta)
5. Budjetti (viimeisin budjettivuosi)
6. **Muutos edellinen→viimeisin toteumavuosi** (laskettu)
7. Huomio

- **Älä näytä** historiallisia budjetteja (Budjetti 2023/2024/2025) tässä näkymässä — vain viimeisin. (Speksi: nämä poistetaan tästä näkymästä.)
- Ryhmätason summat. Nature/controllability voivat olla eri arvoja saman ryhmän eri tileillä — jos ristiriita, näytä ryhmätasolla "—" tai "sekä" (valitse selkeämpi; dokumentoi valinta).

### 3.3 Budjetti vs. toteuma (§6.4)

**Ainoa näkymä joka vertaa historiallista budjettia toteumaan.** Vuosi valitaan **suodattimella** (ei kaikkia vuosia yhdessä leveässä taulukossa). Valitulle vuodelle, per tili (tai per ryhmä — ks. alla), sarakkeet **tässä järjestyksessä** (hyväksymiskriteeri "Budjetti ennen toteumaa"):
1. Tili/Ryhmä + nimi
2. **Budjetti** (valitun vuoden budgetAmount)
3. **Toteuma** (valitun vuoden actualAmount)
4. **Erotus €** = Toteuma − Budjetti (laskettu)
5. **Erotus %** = Erotus / Budjetti (laskettu; **jos budjetti 0 tai puuttuu → tyhjä "—"**, ei jakoa nollalla)
6. Huomio

Tulkinta (voidaan ilmaista värillä tai merkinnällä, valinnainen mutta hyödyllinen):
- **Kulut**: positiivinen erotus = toteuma yli budjetin = ylitys = epäedullinen.
- **Tulot**: positiivinen erotus = toteuma yli budjetin = suotuisa.
- Erottele siis kulut ja tulot tulkinnassa (sama etumerkki tarkoittaa eri asiaa). Jos näytät molemmat samassa taulukossa, ryhmittele tai merkitse kumpi on kyseessä.
- Vuosisuodattimen vaihtoehdot: vain ne vuodet joilla on **sekä budjetti- että toteumadataa** jollain tilillä (muuten vertailu on tyhjä). Johda datasta.

Rakeisuus: valitse tili- tai ryhmätaso (tai molemmat, ryhmä koostettuna + tilit alla). Suositus: ryhmätaso koostettuna, tilitason erittely detaljissa — mutta jos tilitaso on selkeämpi, sekin käy. Dokumentoi valinta.

## 4. Toteutus

- Lisää puhtaat view-model-funktiot `public/adminOperationPayloads.js`:ään (testattavat ilman DOMia), samaan tapaan kuin 3A:n `buildAccountCostsViewModel`:
  - `buildIncomeViewModel(accounts, entries)` — Tulot: ryhmittely, vuosisarakkeet, muutos, osuus tuloista.
  - `buildExpenseGroupViewModel(accounts, entries)` — Kulut ryhmittäin: ryhmittely, nature/controllability (— jos puuttuu), muutos.
  - `buildBudgetVsActualViewModel(accounts, entries, year)` — Budjetti vs. toteuma valitulle vuodelle: budjetti, toteuma, erotus €, erotus % (budjetti 0/puuttuu → tyhjä).
  - Apuri vuosivalinnoille (`deriveComparableYears(entries)` = vuodet joilla budjetti+toteuma).
- Renderöi näkymät `public/app.js`:ssä, korvaten placeholderit. Poista vastaavat näkymät `renderFinancePlaceholders`-listasta (jää vain Taloudellinen asema, joka on vaihe 4).
- Budjetti vs. toteuma -vuosisuodatin: sama kuvio kuin muut suodattimet (esim. Korjaustapahtumat-näkymän vuosisuodatin).

## 5. Testit

`public/adminOperationPayloads.test.js`:
- `buildIncomeViewModel`: ryhmittely oikein, muutos 2024→2025 laskettu oikein, osuus tuloista summautuu 100 %:iin (tai lähelle pyöristyksin), tyhjä data → tyhjä tila.
- `buildExpenseGroupViewModel`: ryhmittely, nature/controllability "—" kun puuttuu, muutos laskettu, historiallista budjettia ei mukana.
- `buildBudgetVsActualViewModel`: erotus € = toteuma − budjetti oikein; erotus % oikein; **budjetti 0 → erotus % tyhjä (ei kaadu, ei Infinity/NaN)**; budjetti puuttuu → tyhjä; kulut vs. tulot -etumerkkitulkinta jos toteutat sen.
- `deriveComparableYears`: palauttaa vain vuodet joilla sekä budjetti että toteuma.

`public/viewWiring.test.js`: uudet näkymä-id:t + mahdollinen vuosisuodatin + detaljipaneelin kytkennät ristiintarkistuksiin.

DOM-käyttäytyminen (vuosisuodattimen vaihto, ryhmän detalji) → manuaaliset testipolut PR-kuvaukseen. Ei jsdomia.

## 6. Valmis lopputulos — raportoi

Commit-lista, muutetut tiedostot, testitulokset, kolmen näkymän toteutus, laskettujen sarakkeiden kaavat (muutos, osuus, erotus €/%), budjetti-0-reunatapauksen käsittely, tili- vs. ryhmätaso -valinnat, automaattiset vs. manuaaliset testipolut, poikkeamat. **Luo PR** (base main). **Älä mergeä.**

## 7. Ulkopuolelle (vaihe 4)

Taloudellinen asema / tase (BalanceSheetSnapshot, BalanceEntry, VARAT/OMA PÄÄOMA JA VELAT, tunnusluvut). Se on eri tietomalli (erät päivämäärittäin, ei tili×vuosi) ja jää vaiheeseen 4. Sen näkymä pysyy placeholderina tämän PR:n jälkeen.

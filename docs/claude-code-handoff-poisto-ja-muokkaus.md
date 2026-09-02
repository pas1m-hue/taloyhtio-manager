# Claude Code -tehtävä: Poisto ja muokkaus kaikille entiteeteille

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `3844d46`, kaikki aiemmat vaiheet mergattu. **Tämä on suunnittelupainotteinen tehtävä** — palauta ensin suunnitelma ja odota hyväksyntää. Tässä muutetaan arkkitehtuurista perusoletusta, joten suunnittelu on tärkeämpi kuin nopeus.

## 0. Tausta ja ongelma

Sovelluksessa ei ole tällä hetkellä yhtään poisto-operaatiota. `AdminOperationType` on `create | update`, ja audit trail on append-only. Käytännön seuraus: **virheellisesti syötettyä dataa ei saa pois.** Kirjoitusvirhe, testirivi tai väärä liitos jää pysyvästi näkyviin.

Tämä on osunut jo kahdesti:
- Ryhmäbudjeteissa (viikko sitten) tämä kierrettiin `active`-lipulla, koska poistoa ei ollut.
- Tuotannossa on nyt testidataa jota ei saa pois: rakennusosat `fgda` ja `fs` (+ `fgda`:aan liitetty testihavainto), sekä kaksi tasesnapshottia `tase-testi-2024` ja `tase-testi-2025`.

Tasesnapshottien kohdalla tämä ei ole pelkkä kosmeettinen haitta: `tase-testi-2025` on samalla päivämäärällä kuin oikea `Tase-2025` ja erottuu vain nimestä, ja sen varat ovat 1 754 399,14 € oikean 23 708,49 €:n sijaan. Vertailuvalitsimessa vahinkovalinta antaa täysin väärän mutta uskottavan näköisen tuloksen.

### Miksi append-only-oletus puretaan

Sovellus **ei** ole taloyhtiön virallinen järjestelmä eikä julkaise virallista aineistoa — isännöitsijän raportit ovat viralliset, ja sovellus ei ota vastuuta lukujen oikeellisuudesta. Syöttäjiä on tasan yksi (hallituksen pj). Täysi audit-jäljitettävyys on siis ylimitoitettu suhteessa siihen haittaan jonka se aiheuttaa: virhettä ei voi korjata.

Audit trailia ei tarvitse poistaa — mutta se ei saa estää poistoa.

## 1. Suunniteltava kokonaisuus

Kattaa **kaikki** entiteetit, ei vain tasesnapshotteja: rakennusosat, havainnot, korjaustapahtumat, kustannusnäytöt, tasesnapshotit, ryhmäbudjetit, talousdata (`FinancialAccount` / `FinancialEntry`). Sama ongelma koskee kaikkia, ja yksi ratkaisu on parempi kuin seitsemän erilaista.

Arvioi ja ehdota paras toteutustapa. Todennäköisesti tarvitaan uusi `AdminOperationType`-arvo (`delete` tai vastaava), mutta perustele valintasi ja kerro mitä se koskee: `applyAdminBatch`, `adminDataValidation`, audit-semantiikka, `adminDashboard`, UI.

**KRIITTINEN:** jos lisäät kokoelmakenttiä, muista `withDefaultedAdminCollections()` (`src/database/postgresPublishingRepository.ts`) + regressiotesti vanhalla snapshotilla. Tämä bugi on osunut jo kerran (3A).

## 2. Poisto — liitokset mukana vahvistuksella

**Päätetty ratkaisu (vaihtoehto B).** Sovelluksessa on ketju rakennusosa → havainto → korjaustapahtuma, ja kustannusnäyttö liittyy rakennusosaan. Poisto ei saa jättää orpoja viittauksia.

Toimintamalli:
- Poisto laskee etukäteen mitä muuta katoaa ja näyttää sen vahvistuksessa, esim.
  *"Poistetaan rakennusosa fgda ja sen mukana: 1 havainto, 0 korjaustapahtumaa, 0 kustannusnäyttöä. Jatketaanko?"*
- Vahvistuksen jälkeen kaikki poistuvat yhtenä operaationa.
- Vahvistus on pakollinen kaikille poistoille, myös liitoksettomille (silloin ilman listaa).

Hylätty vaihtoehto A (estä poisto jos liitoksia on): pakottaisi purkamaan ketjun käsin oikeassa järjestyksessä, mikä on kiusallisinta juuri siinä tapauksessa jota varten poistoa eniten tarvitaan — testidatan siivoamisessa.

Suunnitelmassa: kartoita kaikki entiteettien väliset viittaukset ja kerro kumpaan suuntaan kukin kaskadi menee.

## 3. Talousdata — sekä rivi- että tuontikohtainen poisto

**Päätetty ratkaisu (vaihtoehto C: molemmat), tuontikohtainen ensin.**

Talousdata on eri kuin muut: rivejä on satoja (n. 25 tiliä × 3–4 vuotta), ja virheet syntyvät käytännössä aina yhdestä huonosta liitoksesta, ei yhdestä väärästä luvusta. Rivi kerrallaan poistaminen on kohtuutonta kun 60 rivin tuonnissa oli väärä vuosi.

- **Tuontikohtainen poisto** — poistaa kaikki yhdellä liitoksella syntyneet rivit kerralla. Prioriteetti 1.
- **Rivikohtainen poisto** — yksittäinen tili + vuosi. Prioriteetti 2.

**SELVITETTÄVÄ ENNEN SUUNNITELMAA:** säilyykö tuontitunniste (lähdetunniste + aikaleima tai vastaava) **rivikohtaisesti** `FinancialEntry`ssä, vai onko se vain audit trailissa? Jos se ei ole rivillä, tuontikohtainen poisto vaatii uuden kentän — kerro suunnitelmassa kumpi tilanne on ja mitä se tarkoittaa.

Sama kysymys koskee tasesnapshotteja ja ryhmäbudjetteja: mitä "yksi tuonti" tarkoittaa niiden kohdalla.

## 4. Muokkaus

**Päätetty jako:**

- **Entiteetit joilla on jo "Muokkaa"-lomake** (rakennusosat, havainnot, korjaustapahtumat, kustannusnäytöt): ei muutoksia. Toimivat jo.
- **Liitettävät aineistot** (talousdata, tasedata, ryhmäbudjetit): muokkaus tapahtuu **uudelleentuonnilla joka päivittää olemassa olevat rivit** eikä luo duplikaatteja. Ei erillistä muokkauslomaketta.

Perustelu: virheellinen talousdata tulee melkein aina huonosta liitoksesta, ja korjaus on luontevinta tehdä samalla tavalla kuin syöttö. Yksittäisen luvun korjaus onnistuu liittämällä yksi rivi uudelleen. Tasesnapshotin erien editointi lomakkeella yksitellen olisi kohtuutonta.

**SELVITETTÄVÄ ENNEN SUUNNITELMAA:** toimiiko nykyinen talousdatan tuonti (`parseFinancialPasteInput` → payload → `applyAdminBatch`) jo päivittävästi, vai luoko se duplikaatteja? Ryhmäbudjeteissa tämä toimii, koska id johdetaan `kind/ryhmä/vuosi`-kolmikosta. Jos talousdata toimii jo samoin, tätä kohtaa ei tarvitse rakentaa lainkaan — kerro suoraan kumpi tilanne on. Sama kysymys tasedatalle.

## 5. Ryhmäbudjettien `active`-lippu

`active` rakennettiin ryhmäbudjeteille kiertämään poiston puutetta. Kun oikea poisto on olemassa, kaksi tapaa tehdä sama asia on huonompi kuin yksi.

**Päätetty:** `active`-kenttä **jää tietomalliin**, mutta **"Poista käytöstä" -nappi ja siihen liittyvä "Nykyiset ryhmäbudjetit" -listan passivointitoiminto poistetaan UI:sta** kun poisto on tilalla. Kenttä jää valmiiksi jos joskus tarvitaan "ei enää voimassa mutta säilytetään" -tila.

**Huom:** `Asset.active` on eri asia — siellä se tarkoittaa aidosti "rakennusosa ei ole enää käytössä", ei "tämä rivi on roskaa". Se jää sellaisenaan, älä koske siihen.

## 6. Rajaus

Ei kosketa auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita (snapshot-arkkitehtuuri). Ei jsdomia, ei frameworkia, ei bundleria. Kaikki nykyiset näkymät ja laskennat pysyvät toimivina. DATA GAP -periaate ja etumerkkikonventiot ennallaan.

## 7. Testit

- Poisto-operaation validointi + payload + `applyAdminBatch`.
- Kaskadipoisto: liitokset poistuvat mukana, laskettu esikatselu vastaa toteutunutta.
- `withDefaultedAdminCollections`-regressio jos kokoelmakenttiä lisätään — kirjoita niin että se **failaa** jos oletusarvoistus poistetaan.
- Talousdatan tuontikohtainen poisto: poistaa oikeat rivit, ei muita.
- Uudelleentuonti päivittää eikä duplikoi (jos tätä rakennetaan).
- Regressio: poiston jälkeen kaikki näkymät ja summat laskevat oikein (ei orpoja viittauksia, ei kaatumisia).

## 8. Työskentelytapa

1. Branch **`feature/delete-and-edit`** tuoreesta mainista.
2. **Suunnitelma ensin, ei koodia.** Vastaa erityisesti §3:n ja §4:n selvitettäviin kysymyksiin — ne voivat pienentää tehtävää merkittävästi.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen kuin ilmoitat valmiudesta — dev-palvelin ei ole ottanut muutoksia käyttöön ilman sitä.

## 9. Ensimmäinen live-testi mergen jälkeen

Tuotannossa odottaa siivottavaa, jolla tämä testataan oikealla datalla:
- rakennusosat `fgda` (liitettynä testihavainto) ja `fs`
- tasesnapshotit `tase-testi-2024` ja `tase-testi-2025`
- rakennusosa "Putki" (tunniste `Putket`) — varmista onko oikea vai testi ennen poistoa

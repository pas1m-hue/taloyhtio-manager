# Claude Code -tehtävä: Osittainen tilitason toteuma ei saa esiintyä kokonaissummana

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `22dfc98`, ei avoimia PR:iä. **Tämä on suunnittelupainotteinen tehtävä** — palauta ensin suunnitelma ja odota hyväksyntää. §2 sisältää argumentin siitä miksi ilmeinen ratkaisu ei toimi; lue se ennen kuin suunnittelet.

## 0. Ongelma

Ryhmän toteuma summataan sen tilien toteumista. Kun **osa ryhmän tileistä puuttuu joltakin vuodelta lähdedatan rajoitteen takia**, summa on osittainen — mutta se esitetään kokonaissummana ja siitä lasketaan johdettuja lukuja.

Konkreettinen tapaus tuotannossa (vuosi 2023, ryhmä Hoitovastikkeet):

| | |
|---|---|
| Todellinen hoitovastiketuotto 2023 | **36 237,38 €** |
| Sovelluksen laskema (tileistä summattu) | **3 527,50 €** |
| Ero | 32 709,88 € |

Syy: lähteessä (2024 tilinpäätöksen vertailuvuosi) vain kulutusperusteinen vastike (tili 3030) oli eritelty tilitasolla. Tilit 3000 (asunnot), 3002 (autokatokset) ja 3050 (kaapeli-TV) olivat 2023-raportissa yhtenä lukuna, eikä sitä lukua voi jakaa tileille.

**Seuraukset kahdessa näkymässä:**

1. **Budjetti vs. toteuma, 2023** — rivi Hoitovastikkeet: budjetti 35 609,69 €, toteuma 3 527,50 €, erotus −32 082,19 €, **−90,1 %**. Lukee kuin vastikkeita olisi jäänyt keräämättä 32 000 €. Todellisuudessa budjetti ylittyi. Sama virhe vuotaa Tulot-osion KPI-kortteihin ja keskim. abs. poikkeamaan (90,1 %).

2. **Yhteenveto-kaavio, 2023** — tulopylväs 3 528 €, kulupylväs −34 272 €, eli kaavio esittää hoitokatteeksi noin −30 744 €. Todellinen hoitokate 2023 oli **+2 935,75 €**. Kaavio näyttää massiivisen tappion vuodelta joka oli voitollinen.

Tämä on sama periaatteellinen vika jota vastaan on jo tehty työtä kolmesti (nollapylväs kaaviossa, kassapolun katteen jälkeiset vuodet, ryhmätason osittainen vuosi Yhteenvedossa): **tuntematon esitetään tiedettynä.** Tämä on niistä vahingollisin, koska johdetut luvut ovat suuria ja väärään suuntaan.

## 1. Miksi Yhteenvedon nykyinen suoja ei riitä

Yhteenveto-kaaviossa on jo osittaisuusmerkintä (PR #17): sarake haalennetaan ja labelissa lukee "osittainen (1/10 ryhmää)". Se laskee **montako ryhmää raportoi** kyseiseltä vuodelta.

Tuloissa on tasan yksi ryhmä (Hoitovastikkeet), ja se raportoi. Kattavuus on siis 1/1 = täysi, ja merkintä ei laukea — vaikka vaje on tilitasolla ryhmän sisällä. Ennen 2023-tuontia merkintä näkyi, koska kulupuolella oli 1/10 ryhmää; nyt kulut ovat täydet ja merkintä katosi kokonaan, jolloin tulopuolen virhe jäi paljaaksi.

Sama juurisyy koskee Budjetti vs. toteuma -näkymää, jossa vastaavaa suojaa ei ole lainkaan.

## 2. KRIITTINEN: tilien laskeminen ei toimi

Ilmeinen ratkaisu on siirtää sama kattavuuslaskenta tasoa alemmas: *"montako ryhmän tiliä raportoi tältä vuodelta"*. **Se tuottaa vääriä positiivisia lähes joka ryhmässä ja joka vuonna.**

Tili ilman kirjausta vuodelta ei tarkoita puuttuvaa dataa. Se tarkoittaa useimmiten ettei sellaista kulua ollut. Esimerkkejä tuotantodatasta:

- **5310 Isännöinnin erill. korv.** — arvot 2024, 2025 ja budjetti 2026, mutta **ei 2023**. Tämä on aito nolla: kulua ei ollut. Data on täydellinen.
- **3000 Hoitovastike, asunnot** — arvot 2024, 2025 ja budjetti 2026, mutta **ei 2023**. Tämä on aito vaje: tuottoa oli, mutta sitä ei eritelty.

Nämä kaksi tapausta ovat **numeerisesti identtisiä**. Ero on lähdedokumentissa, ei datassa. Mikään tilirivien laskenta, ristiintarkistus muihin vuosiin tai heuristiikka ei erota niitä.

Vastaavia aitoja nollia on runsaasti: 5373 Postikulut (ei 2023), 5850 Hulevesimaksut (ei 2023), 6446 Viheraluekorjaukset (vain 2024), 6465/6476/6532/6533 (vain 2025). Hallintopalveluissa 2023 raportoi 8 tiliä 11:stä ja on silti **täydellinen** — summa −8 003,70 € täsmää lähteeseen senttiin.

Naiivi kattavuuslaskenta merkitsisi siis Hallintopalvelut 2023:n osittaiseksi vaikka se on täysi. Se olisi huonompi kuin nykytila: se opettaa käyttäjän sivuuttamaan merkinnän.

**Suunnitelma ei saa nojata tilien lukumäärään.**

## 3. Ehdotettu suunta (arvioi ja perustele)

Ainoa tieto joka erottaa nämä tapaukset on **ryhmän todellinen kokonaissumma**, ja se on olemassa lähteessä mutta ei sovelluksessa. Sovellus tallentaa tällä hetkellä ryhmätasolla vain budjetin (`GroupBudget`), ei toteumaa.

Ehdotus: **salli ryhmätason toteuman tuonti**, ja käytä sitä samalla etusijamekanismilla joka on jo rakennettu budjeteille.

- Tuontiformaatti laajenee valinnaisella sarakkeella: `kind⇥ryhmä⇥vuosi⇥budjetti⇥toteuma`. Toteuma on vapaaehtoinen; nykyiset 4-sarakkeiset liitokset toimivat ennallaan.
- Kun ryhmätason toteuma on olemassa **ja poikkeaa tilien summasta**, tiedetään täsmälleen kaksi asiaa: oikea kokonaissumma, ja se että tilierittely on vajaa täsmälleen erotuksen verran.
- Ryhmätason vertailut (Budjetti vs. toteuma, Yhteenveto-kaavio, KPI:t) käyttävät ryhmätason toteumaa. Tilikohtaiset näkymät pysyvät ennallaan tilien summina.
- Näkymään "Toteuman lähde" -sarake tai vastaava, samaan tapaan kuin nykyinen "Budjetin lähde": `Ryhmätaso` / `Tileistä summattu`. Kun ryhmätason luku on käytössä ja erotus on nollasta poikkeava, kerrotaan erittelemättä jäänyt osuus euroina.

Mekanismi tarkistaa itsensä: kuluille 2023 ryhmätason toteuma (−34 271,63 €) **on sama** kuin tilien summa, joten ne näyttäisivät "Tileistä summattu" eikä mitään muutu. Vain aito vaje erottuu.

Nykydatalla käyttäjä syöttäisi ryhmätason toteumat 2023–2025, jotka ovat lähde-Excelissä valmiina.

**Arvioi tämä kriittisesti** ja ehdota parempaa jos näet sellaisen. Vaihtoehtoja joita harkitsin ja pidin heikompina:

- **Käyttäjä merkitsee ryhmä+vuoden osittaiseksi käsin.** Toimii, mutta ei kerro *kuinka* osittainen, joten oikeaa kokonaissummaa ei silti saada eikä hoitokatetta voi laskea. Lisää myös metatietokitkaa, jota ollaan muutenkin purkamassa.
- **Kynnysarvoheuristiikka** (esim. toteuma < 20 % budjetista → epäilyttävä). Arvaus, joka voi merkitä aidon alituksen virheeksi ja päinvastoin.
- **Piilota rivi kokonaan.** Hävittää olemassa olevan tiedon esityksen takia.

## 4. Suunnitelmassa vastattava

1. **Mihin ryhmätason toteuma tallennetaan?** Laajeneeko `GroupBudget` (nimi olisi silloin harhaanjohtava) vai tuleeko rinnalle uusi kokoelma? Jos uusi kokoelma: **`withDefaultedAdminCollections()`** (`src/database/postgresPublishingRepository.ts`) + regressiotesti, kirjoitettuna niin että se **failaa** jos oletusarvoistus poistetaan. Tämä bugi on kaatanut työtilan latauksen kerran (3A).
2. **Miten erotus esitetään?** Kun ryhmätason toteuma on 36 237,38 € ja tilien summa 3 527,50 €, käyttäjän on nähtävä sekä oikea luku että se että 32 709,88 € on erittelemättä.
3. **Yhteenveto-kaavio:** korvaako ryhmätason toteuma nykyisen ryhmäkattavuuteen perustuvan osittaisuusmerkinnän, vai elävätkö ne rinnakkain? Kaksi eri osittaisuuskäsitettä samassa kaaviossa on huono, joten kerro miten ne yhdistyvät.
4. **Vaikutus muualle:** `trailing12mOperatingCosts` käyttää kulujen toteumia (jotka ovat täydet, joten vaikutusta ei pitäisi olla — vahvista), samoin hoitokate ja `buildIncomeViewModel`. Kerro mitä muuttuu ja mitä ei.
5. **Visitor ja julkaisuputki:** vaatiiko uusi data muutoksia `publishedSnapshot.ts`:ään.

## 5. Rajaus

Ei kosketa auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita. Ei jsdomia, ei frameworkia, ei bundleria.

**Tilikohtaiset näkymät eivät muutu** (Kulut tileittäin, Kulut ryhmittäin, Tulot) — niiden summat pysyvät tilien summina, koska ne kuvaavat nimenomaan tilierittelyä. Etumerkkikonventiot ennallaan (kulut negatiivisina).

Ei muutoksia: `forecastComplete`, vuosikeräys, kassapolku, kunnossapitokate. Ne ovat omia tehtäviään.

## 6. Testit

- Ryhmätason toteuma poikkeaa tilien summasta → ryhmävertailu käyttää ryhmätason lukua, erotus näytetään, lähde merkitään.
- Ryhmätason toteuma **on sama** kuin tilien summa → mitään ei merkitä, näkymä ennallaan (kulut 2023 on tämä tapaus).
- Ryhmätason toteumaa ei ole → nykyinen käytös, tilien summa, ei merkintää. Taaksepäin yhteensopivuus.
- **Aito nolla ei sekoitu vajeeseen:** ryhmä jonka toteuma on aidosti 0,00 € ei saa merkintää.
- **Regressio §2:een:** ryhmä jolla on vähemmän tilejä raportoimassa kuin muina vuosina (Hallintopalvelut 2023, 8/11 tiliä) **ei** saa osittaisuusmerkintää, koska ryhmätason toteuma täsmää. Tämä testi estää §2:n virheen palaamisen.
- KPI:t (Tulot-osion budjetti/toteuma/nettoerotus/keskipoikkeama) laskevat oikein korjatuilla luvuilla.
- Yhteenveto-kaavio: 2023 tulopylväs oikean korkuisena, hoitokate positiivinen.
- Tuontijäsennin: 5-sarakkeinen rivi, 4-sarakkeinen rivi, virheelliset rivit rivinumeroin.
- `withDefaultedAdminCollections`-regressio jos kokoelma lisätään.

## 7. Työskentelytapa

1. Branch **`feature/group-level-actuals`** tuoreesta mainista.
2. **Suunnitelma ensin, ei koodia.** Vastaa §4:n viiteen kysymykseen ja ota kantaa §3:n ehdotukseen.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen valmiusilmoitusta. `pkill -f wrangler` ei toimi (tappaa oman komentonsa) — käytä `kill <PID>` ja varmista curlilla.

## 8. Lähdeluvut live-testiin

Ryhmätason toteumat lähde-Excelistä (`Tulot`- ja `Kulut`-välilehdet):

| Ryhmä | 2023 | 2024 | 2025 |
|---|---|---|---|
| Hoitovastikkeet | 36 237,38 | 40 666,93 | 43 150,75 |
| Kulut yhteensä | 34 271,63 | 36 761,19 | 37 911,01 |

Hoitokate 2023 = 37 207,38 − 34 271,63 = **+2 935,75 €** (tuotoissa lisäksi vuokrat 720 € ja muut tuotot 250 €, jotka eivät ole sovelluksen tilidatassa).

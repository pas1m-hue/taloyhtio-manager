# Claude Code -tehtävä: Kunnossapitosuunnitelman kate kassapolkuun

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `15f88b2`, ei avoimia PR:iä. Tee lyhyt suunnitelma ennen koodausta.

## 0. Ongelma

Kassapolku näyttää rivit koko horisontille (2026–2050), ja **tuntemattomat vuodet näyttävät identtisiltä aitojen nollavuosien kanssa.**

Konkreettinen esimerkki tuotantodatasta (optimistic-skenaario):

| Vuosi | Tunnetut kulut | Mitä se oikeasti tarkoittaa |
|---|---|---|
| 2029 | 0,00 € | **Aito nolla** — kunnossapitosuunnitelma kattaa vuoden, mitään ei ole suunniteltu |
| 2035 | 0,00 € | **Tuntematon** — suunnitelma ei ulotu sinne |

Molemmat renderöityvät `0,00 €`. Seuraus: kassa kasvaa 22 208 € → yli 128 000 € vuoteen 2040 mennessä, koska malli olettaa ettei kuluja tule. Todellisuudessa 2007 rakennetulle rivitaloyhtiölle tulee 2030–2040-luvulla isoja töitä (putket, katto, piha, ikkunat) joista ei vain ole vielä suunnitelmaa.

Tämä on suoraan DATA GAP -periaatteen vastaista: tuntematonta ei koskaan korvata nollalla, tyhjä näytetään "—". Sama periaate on jo toteutettu kaavioissa (PR #16, #17) ja taulukoissa. Kassapolku on ainoa paikka jossa se rikkoutuu, ja se on paikka jossa harha on vaarallisin — käyttäjä voi katsoa nousevaa kassaa ja päätellä ettei vastiketta tarvitse nostaa.

**Miksi tätä ei voi päätellä koodista:** viimeinen aikataulurivi on 2039 (Varaajien uusiminen), mutta se on seed-dataa. Todellinen kunnossapitotarveselvitys kattaa **2026–2030**. Kate ei siis ole johdettavissa datasta.

## 1. Päätetty ratkaisu

**A. Kate on käyttäjän syöttämä kenttä.**

Uusi kenttä, esim. `maintenancePlanCoverageThroughYear` (nimeä miten parhaaksi näet): vuosi johon asti kunnossapitosuunnitelma kattaa. Käyttäjä syöttää sen; sovellus ei arvaa.

Nykydatalla arvo olisi **2030**.

**B. Katteen jälkeiset vuodet näkyvät, mutta ilman lukuja.**

Rivit **eivät katoa** — vuosi pysyy näkyvissä, kuten kaavioissakin puuttuva vuosi pysyy akselilla. Mutta:

- **Tunnetut kulut:** `—`, ei `0,00 €`
- **Päättävä kassa:** `—`. Jos kulut ovat tuntemattomat, kassa on tuntematon. Sitä ei saa esittää laskettuna lukuna.
- **Avaava kassa:** ketju katkeaa samasta kohdasta — ensimmäinen katteen jälkeinen vuosi voi vielä näyttää avaavan kassan (se on edellisen vuoden päättävä, joka on tiedossa), mutta sen jälkeen ei. Ehdota suunnitelmassa miten tämä on selkeintä esittää.
- **Puskurivaje ja DATA GAP -sarake:** näiden käsittely katteen jälkeen on ratkaistava — kerro ehdotuksesi.
- Rivi on visuaalisesti merkitty, ja taulukon yhteydessä on selite joka kertoo mihin asti suunnitelma kattaa.

**Vuosikeräys** on eri asia eikä kuulu tähän PR:ään — se on vakio 9 680 €/v koko horisontille, mikä on oma ongelmansa (se on itse asiassa Korjaukset-budjetti 2026, ei korjausvastikkeen kertymä, eikä se nouse ajassa). Käsitellään erikseen. **Älä koske siihen tässä.**

## 2. Suunnitelmassa vastattava

1. **Mihin kenttä sijoitetaan?** Se on taloyhtiökohtainen tieto, ei skenaariokohtainen. Luontevimmat paikat ovat Taloyhtiön perustiedot tai likviditeetin lähtötiedot (`LiquidityBaselineRecord`). Katso kumpi sopii ja perustele.

2. **Mitä tapahtuu jos kenttä on tyhjä?** Vanha data ei sisällä sitä. Ehdota: näytetäänkö kaikki vuodet kuten nyt (nykyinen käytös, taaksepäin yhteensopiva) vai jokin muu. **Älä oletusarvoista sitä horisontin loppuvuoteen** — se olisi hiljainen väite että kaikki on katettu.

3. **`withDefaultedAdminCollections()`** — jos kenttiä lisätään, muista oletusarvoistus + regressiotesti. Tämä bugi on osunut kerran (3A) ja kaataa työtilan latauksen vanhalla snapshotilla.

4. **Vaikuttaako tämä Vastiketarve-näkymään tai `forecastComplete`-logiikkaan?** Kerro löydöksesi, mutta **älä muuta niitä tässä PR:ssä** — siellä on erillinen tunnettu ongelma ("Ennuste täydellinen" nollakuluilla), joka käsitellään omanaan.

5. **Visitor-puoli.** Likviditeettimalli rakennetaan myös julkaistusta snapshotista. Kerro vaatiiko tämä muutoksia julkaisuputkeen vai riittääkö olemassa oleva `liquidityBaselines`-kenttä.

## 3. Rajaus

Ei kosketa auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita. Ei jsdomia, ei frameworkia, ei bundleria.

**Ei muutoksia:** vuosikeräyksen laskentaan, `forecastComplete`-logiikkaan, Vastiketarve-näkymään, kustannus- tai tapahtumamalliin. Kaikki muut näkymät ja laskennat ennallaan.

## 4. Testit

- Kate 2030, horisontti 2050 → vuodet 2026–2030 laskettuina, 2031– merkittyinä ilman lukuja.
- **Aito nolla katteen sisällä säilyy nollana** (2029 = `0,00 €`, ei `—`). Tämä on koko PR:n tärkein testi: se erottaa kaksi asiaa jotka nyt näyttävät samalta.
- Kate puuttuu → §2.2:n mukainen käytös, ei kaadu.
- Kate horisontin ulkopuolella (esim. 2060) → kaikki vuodet laskettuina, ei kaadu.
- Kate menneisyydessä (esim. 2020) → kaikki vuodet merkittyinä, ei kaadu.
- `withDefaultedAdminCollections`-regressio, kirjoitettuna niin että se **failaa** jos oletusarvoistus poistetaan.
- Regressio: muut näkymät ja tunnusluvut ennallaan.

## 5. Työskentelytapa

1. Branch **`feature/maintenance-plan-coverage`** tuoreesta mainista.
2. **Lyhyt suunnitelma ensin, ei koodia.** Vastaa §2:n viiteen kysymykseen.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen kuin ilmoitat valmiudesta. Huom: `pkill -f wrangler` ei toimi — se tappaa oman komentonsa. Käytä `kill <PID>` ja varmista curlilla että uusi koodi tulee palvelimelta.

## 6. Testidata tuotannossa

Live-testiin: kunnossapitotarveselvitys kattaa **2026–2030**. Tapahtumat: Ilmanvaihdon puhdistus 2026 (2 500 €), Julkisivujen huoltomaalaus 2027 (15 000 €), Kuntoarvio 2028 (4 000 €), Varaajien uusiminen 2026–2039 (seed-dataa, ulottuu katteen yli — hyvä testitapaus sinänsä).

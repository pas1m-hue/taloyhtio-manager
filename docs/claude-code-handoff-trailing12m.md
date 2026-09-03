# Claude Code -tehtävä: `trailing12mOperatingCosts` laskettavaksi tilidatasta

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Main = `95a9a41`, ei avoimia PR:iä. Pieni, rajattu tehtävä — mutta tee silti lyhyt suunnitelma ennen koodausta, koska §2:ssa ja §4:ssä on kaksi asiaa jotka on tarkistettava koodista ennen kuin laskenta on oikea.

## 0. Tausta

`trailing12mOperatingCosts` on likviditeetin lähtötiedoissa **käsin syötetty paikkamerkki, arvo 34 029,46 €**. Se on jakaja "Kassa kuukausina hoitokuluja" -tunnusluvussa (Taloudellinen asema -näkymä, nykyinen lukema 7.8), ja sovellus näyttää siitä huomautuksen että luku on suuntaa-antava.

Paikkamerkki ei ole mielivaltainen: se on **2025:n kulujen toteuma ilman korjauksia**, senttiin asti.

```
kulut 2025 yhteensä        37 911,01
− KORJAUKSET 2025           3 881,55
= 34 029,46
```

Luku on siis oikea yhdellä tulkinnalla, mutta se on käsin syötetty eikä päivity kun uusi tilikausi tuodaan. Tavoite: **laskea se automaattisesti tilidatasta.**

## 1. Päätetty kaava

```
trailing12mOperatingCosts
  = (viimeisimmän toteumavuoden kulut − sen vuoden KORJAUKSET)
  + (KORJAUKSET-toteumien keskiarvo kaikilta vuosilta joilla on toteumaa)
```

Nykydatalla (2024 ja 2025 toteumat):

```
34 029,46 + (5 348,53 + 3 881,55) / 2 = 34 029,46 + 4 615,04 = 38 644,50
```

Tunnusluku muuttuu siis n. 7,8 → n. 6,9 kuukautta. Tämä on odotettu ja oikea muutos, ei regressio.

### Miksi korjaukset normalisoidaan keskiarvolla

Korjaukset eivät noudata tilikautta: taloyhtiön lämminvesivaraajille budjetoitiin useana vuonna korjaus jota ei tullut (2025 alitti budjetin 58,7 %), ja kuluvana vuonna 2026 korjausbudjetti on ylittymässä. Yksittäinen vuosi ei siis kerro korjausten normaalitasosta mitään, mutta useamman vuoden keskiarvo alkaa kertoa.

Muut kuluryhmät ovat vakaita ja niistä käytetään viimeisimmän vuoden toteumaa sellaisenaan.

**Otos on tällä hetkellä ohut** (kaksi vuotta, joista toinen tiedetään poikkeukselliseksi). Tämä on tietoinen hyväksytty rajoite: mekanismi rakennetaan nyt ja se paranee itsestään kun 2023-toteumat saapuvat isännöitsijältä ja 2026 päättyy. Älä siis rakenna erikoistapauksia ohuen otoksen varalle — laske keskiarvo kaikista vuosista joilla on KORJAUKSET-toteumaa, olipa niitä yksi tai kymmenen.

## 2. Viimeisin vuosi = viimeisin vuosi jolla on toteumaa

Tilikaudet syötetään sovellukseen **kerran vuodessa kokonaisuudessaan** tilinpäätöksen valmistuttua. Vuoden mittaan päivitettyä toteumaa ei ole saatavilla (se olisi isännöitsijälle erillinen työ eikä kuulu sopimukseen). Käytännössä toteumadataa on siis aina vain päättyneiltä tilikausilta.

Siksi **ei tarvita logiikkaa sen tunnistamiseen onko vuosi kesken** — riittää ottaa viimeisin vuosi jolla on kulutoteumaa. Älä rakenna "onko tilikausi valmis" -tarkistusta.

## 3. Korjausryhmän tunnistus — ei hiljaista nollaa

Korjaukset erotetaan muista ryhmänimen perusteella (`KORJAUKSET`, isoin kirjaimin kuten tilidatassa). Jos ryhmää ei löydy — nimi on muuttunut, dataa ei ole tuotu, tms. — laskenta **ei saa hiljaa käyttää nollaa**.

Tämä on DATA GAP -periaate: tuntematonta ei korvata nollalla. Hiljainen nolla tuottaisi liian pienen jakajan ja siten liian hyvän näköisen tunnusluvun, mikä on väärä suunta.

Ehdota suunnitelmassa miten tämä käsitellään: joko tunnusluku näytetään "—" ja huomautuksella, tai lasketaan ilman korjausnormalisointia ja kerrotaan se käyttäjälle. Kerro kumman valitset ja miksi.

## 4. TARKISTETTAVA ENNEN LASKENTAA: sisältyvätkö poistot kuluihin?

Poistot kirjautuvat tuloslaskelmaan kuluksi mutta **eivät ole kassasta lähtevää rahaa**, joten ne eivät kuulu tähän jakajaan.

Taseessa poisto on olemassa: rakennusten kirjanpitoarvo pieneni 2024→2025 `1 593 017,83 → 1 592 195,83`, eli **822,00 €**.

Kymmenen kuluryhmän joukossa (HALLINTOPALVELUT, HENKILÖSTÖKULUT, JÄTEHUOLTO, KIINTEISTÖVERO, KORJAUKSET, KÄYTTÖ- JA HUOLTOPALVELUT, SÄHKÖ, ULKOALUEIDEN HOITOPALVELUT, VAHINKOVAKUUTUKSET, VESI- JA JÄTEVESI) ei ole "Poistot"-nimistä ryhmää, joten poistot **eivät todennäköisesti sisälly** kulutoteumiin.

**Tarkista tämä koodista ja datasta äläkä oleta.** Jos poistoja löytyy jostain kuluryhmästä tai tililtä, ne on suljettava pois laskennasta ja se on kerrottava suunnitelmassa. Jos ei löydy, totea se ja jatka.

## 5. Missä laskenta tehdään

Nykyinen `trailing12mOperatingCosts` on osa likviditeetin lähtötietoja (`LiquidityBaseline` tms. — tarkista tarkka sijainti). Suunnitelmassa:

- Lasketaanko arvo puhtaana funktiona `public/adminOperationPayloads.js`:ssä (testattavissa Vitestillä ilman DOM:ia, kuten muut view-model-funktiot), vai read-modelissa?
- Jääkö käsin syötetty arvo mahdolliseksi ohitukseksi, vai korvataanko se kokonaan lasketulla? **Suositus: korvataan kokonaan** — käsin syötetty arvo vanheni huomaamatta, ja se on juuri tämän tehtävän syy. Jos ohitus jätetään, se on näytettävä käyttäjälle samaan tapaan kuin ryhmäbudjetin "Budjetin lähde" -sarake.
- `withDefaultedAdminCollections()`: jos kenttiä lisätään tai poistetaan, muista oletusarvoistus + regressiotesti. Tämä bugi on osunut jo kerran (3A).

## 6. Näkyvyys käyttäjälle

Nykyinen huomautus ("luku on paikkamerkki, tunnusluku suuntaa-antava") on korvattava sillä mitä luku nyt oikeasti sisältää. Esimerkiksi: mistä vuodesta muut kulut ovat, monenko vuoden keskiarvo korjauksissa on, ja mitkä vuodet keskiarvoon sisältyvät.

Tämä ei ole kosmetiikkaa: kaava on tarkoituksella epäsymmetrinen (yksi vuosi + keskiarvo), eikä sitä voi päätellä luvusta.

## 7. Rajaus

Ei kosketa auth/JWKS/Cloudflare/Hyperdrive-polkuja. Ei SQL-migraatioita. Ei jsdomia, ei frameworkia. Muut tunnusluvut (maksuvalmius, korollinen vieras pääoma) ja kaikki muut näkymät pysyvät ennallaan. Etumerkkikonventiot ennallaan (kulut negatiivisina — huomaa tämä kaavassa, `Math.abs` vain siellä missä se on oikein).

## 8. Testit

- Kaava oikein tunnetulla datalla: 2024 + 2025 toteumat → 38 644,50 €.
- Yksi vuosi dataa → keskiarvo on sen vuoden korjaus, ei kaadu.
- KORJAUKSET-ryhmä puuttuu → §3:n mukainen käsittely, **ei nollaa**.
- Poistot suljettu pois jos niitä löytyy (§4).
- Tunnusluku "Kassa kuukausina" laskee oikein uudella jakajalla.
- Regressio: muut tunnusluvut ja näkymät ennallaan.

## 9. Työskentelytapa

1. Branch **`feature/trailing-12m-operating-costs`** tuoreesta mainista.
2. **Vastaa §4:n kysymykseen ja tee lyhyt suunnitelma ennen koodausta.**
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` + `npm test` joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen.
5. **Luo PR** (base main). **Älä mergeä.**
6. **Käynnistä wrangler dev uudelleen** ennen kuin ilmoitat valmiudesta — dev-palvelin ei ole tässä projektissa ottanut muutoksia käyttöön ilman sitä.

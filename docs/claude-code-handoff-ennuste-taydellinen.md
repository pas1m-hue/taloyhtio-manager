# Claude Code -tehtävä: "Ennuste täydellinen" valehtelee kattamattomista vuosista

Seurantatehtävä PR:lle *feature/maintenance-plan-coverage*. Ei kiireellinen,
mutta **ei saa unohtua** — sen jälkeen sama näyttö sanoo kaksi ristiriitaista
asiaa, ja se raportoidaan myöhemmin bugina ja selvitetään uudelleen alusta.

## 0. Tiedossa oleva ristiriita — lue tämä ensin

Kunnossapitokate-PR:n jälkeen Kassapolku merkitsee katteen jälkeiset vuodet
tuntemattomiksi ("—"), mutta Vastiketarve-näkymä sanoo silti samasta
skenaariosta **"Ennuste täydellinen"**.

| Missä | Mitä sanoo | Mistä |
|-|-|-|
| Kassapolku | "2031– ei ole suunniteltu, lukuja ei esitetä" | `CashPathYear.costsKnown` |
| Vastiketarve | "Ennuste täydellinen" | `forecastComplete = blockingDataGaps.length === 0` |

**Tämä on tietoinen ja hyväksytty tila, ei bugi.** Kunnossapitokate-handoffin
§2.4 rajasi `forecastComplete`-logiikan nimenomaisesti ulos, koska ongelma on
vanhempi kuin kate-PR ja koskee eri näkymää. Tämän tehtävän tarkoitus on
poistaa se.

Ongelma on olemassa myös ilman katetta: nykyisellä tuotantodatalla, jossa
kaikki korjaustapahtumat ovat tilassa `suggested`, tunnetut kulut ovat nolla
joka vuodelle ja Vastiketarve sanoo silti "Ennuste täydellinen". Kate-PR tekee
ristiriidasta vain näkyvän.

## 1. Miksi näin käy

`forecastComplete` ei tarkoita "ennuste kattaa horisontin". Se tarkoittaa "ei
nimettyjä DATA GAPeja":

- `src/liquidity/calculateRequiredCollection.ts:77`
- `src/liquidity/findFundingNeed.ts` (sama kaava toisessa paikassa)

DATA GAP syntyy `src/events/projectEvents.ts` -tiedostossa **vain** silloin kun
hyväksytyn tapahtuman aikataulurivillä ei ole `amount`ia ja siihen liittyvä
kustannusnäyttö on `data_gap`. Kaksi tapausta jäävät siis kokonaan lukematta:

1. **Kattamaton vuosi.** Vuosi jota kunnossapitosuunnitelma ei kata ei tuota
   DATA GAPia — siellä ei ole tapahtumaa josta gap syntyisi.
2. **Ehdotettu tapahtuma.** `projectEvents` ohittaa `suggested`-tapahtumat
   `continue`-lauseella ennen kuin aikataulurivejä katsotaan, joten nekään
   eivät tuota gäppiä.

Molemmissa ennuste on epätäydellinen, mutta gap-laskuri on nolla.

## 2. Mitä pitää tehdä

1. Muuta `forecastComplete` muotoon: **ei DATA GAPeja JA kate ulottuu
   horisontin loppuun**. Kate on `ScenarioCashPath.maintenancePlanCoverageThroughYear`,
   ja `beyondCoverage` kertoo suoraan onko horisontissa kattamattomia vuosia.
2. **Ratkaise mitä asettamaton kate tarkoittaa tässä.** Kassapolussa se on
   "tuntematon, näytetään kaikki" (kate-PR:n §2.2). `forecastComplete`ille
   sama valinta ei ole itsestään selvä: jos asettamaton kate tekee ennusteesta
   epätäydellisen, jokainen olemassa oleva asennus muuttuu punaiseksi kunnes
   kate syötetään. Suositus: asettamaton kate → epätäydellinen, koska väite
   "täydellinen" on vahvempi väite kuin taulukon rivien näyttäminen ja vaatii
   siksi enemmän. Varmista tämä käyttäjältä ennen toteutusta.
3. Laajenna näkymän teksti kertomaan **miksi** ennuste on epätäydellinen. Nyt
   se sanoo vain "(DATA GAP)", mikä on väärä syy kun syy on kate. Erottele:
   DATA GAP, kattamaton horisontti, tai molemmat.
4. **Päätä erikseen kuuluuko ehdotettujen tapahtumien tapaus tähän.** §1:n
   kohta 2 on sukua mutta ei sama asia; se voi olla oma tehtävänsä
   ("Vastiketarve nollakuluilla"). Älä laajenna tätä tehtävää siihen ilman
   päätöstä.

## 3. Mitä EI tarvitse selvittää uudelleen

- **Kate on `HousingCompany.maintenancePlanCoverageThroughYear`**, ei
  likviditeetin lähtötietueessa. Perustelu on kate-PR:n suunnitelmassa: yhtiön
  perustiedoilla on lomake, lähtötietueella ei ole.
- **`calculateRequiredCollection` lukee kulut projektiosta, ei kassapolusta.**
  Tämä on tarkoituksellista: kate muuttaa sen mitä kassapolku saa väittää, ei
  tunnettujen kustannusten alarajaa. Vaadittu vuosikeräys pysyy siis
  laskettavissa myös kattamattomassa horisontissa — vain sen *täydellisyyttä*
  koskeva väite muuttuu.
- **`findFundingNeed` ohittaa jo kattamattomat vuodet** (`undefined`-vartiointi
  kate-PR:ssä). Sitä ei tarvitse lisätä uudelleen.

## 4. Testit

- Kate < horisontin loppu, ei DATA GAPeja → `forecastComplete === false`.
- Kate = horisontin loppu tai sen yli, ei DATA GAPeja → `true` (regressio:
  nykyinen käytös säilyy täysin katetulla horisontilla).
- DATA GAP katteen sisällä → `false` riippumatta katteesta.
- Näkymä kertoo oikean syyn kummassakin tapauksessa erikseen ja yhdessä.
- Regressio: Kassapolku, puskuritavoite ja vaadittu vuosikeräys ennallaan —
  tämä tehtävä muuttaa vain täydellisyysväitteen.

## 5. Työskentelytapa

1. Branch tuoreesta mainista.
2. Vastaa §2.2:n kysymykseen ja tee lyhyt suunnitelma ennen koodausta.
3. Committoi handoff ensimmäisenä. Pieniä committeja, `npm run typecheck` +
   `npm test` joka välissä, `build:worker` lopuksi.
4. **Luo PR** (base main). **Älä mergeä.**

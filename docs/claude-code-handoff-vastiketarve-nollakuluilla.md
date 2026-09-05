# Claude Code -tehtävä: Vastiketarve nollakuluilla väittää liikaa

Seurantatehtävä PR:lle *feature/forecast-complete*. **Kirjattu nyt, koska se
tehtävä peittää tämän oireen** — ks. §3. Ei kiireellinen.

## 0. Ongelma

Kun kaikki korjaustapahtumat ovat tilassa `suggested`, projektio on tyhjä:
tunnetut kustannukset ovat 0 € joka vuodelle, DATA GAPeja ei ole, ja
Vastiketarve laskee vaadituksi vuosikeräykseksi luvun joka kattaa pelkän
puskuritavoitteen. Näkymä ei kerro millään tavalla, että se laskee
suunnitelmasta jossa ei ole yhtään hyväksyttyä tapahtumaa.

Väite ei ole numeerisesti väärä — "vaadittu keräys tunnetuille
kustannuksille" on tarkalleen se mitä laskettiin. Se on harhaanjohtava:
lukija olettaa että "tunnetut kustannukset" tarkoittaa taloyhtiön tiedossa
olevia korjauksia, ei tyhjää joukkoa.

## 1. Miksi näin käy

`src/events/projectEvents.ts:67` työntää `suggested`-tapahtuman
`suggestions`-listaan ja `continue`aa **ennen kuin aikataulurivejä
katsotaan**. Ehdotettu tapahtuma ei siis voi tuottaa DATA GAPia eikä
kustannusta. Se on oikea käytös — ehdotusta ei saa laskea mukaan — mutta
seurauksena tyhjä suunnitelma ja täydellinen suunnitelma näyttävät
laskennassa samalta.

## 2. Miksi tämä EI ole sama asia kuin kattamaton horisontti

Erottelu on tehty PR:ssä *feature/forecast-complete* ja kannattaa säilyttää:

- **Kattamaton vuosi on tiedetty tuntemattomaksi.** Sovellus tietää missä
  suunnitelman raja menee ja voi nimetä sen vuosilukuna. Siksi siitä tuli
  `forecastComplete`-syy (`coverage_ends_before_horizon`).
- **Ehdotettu tapahtuma on päinvastainen.** Sen kustannus on tiedossa, mutta
  se on tarkoituksella jätetty laskennan ulkopuolelle koska sitä ei ole
  hyväksytty. Mitään ei puutu; hyväksyntä puuttuu.

**Älä siis lisää kolmatta `forecastIncompleteReasons`-arvoa** ilman erillistä
päätöstä. Todennäköisesti oikeampi muoto on että skenaario kertoo itsestään
suoraan: "ei yhtään hyväksyttyä korjaustapahtumaa — luku kattaa vain
puskuritavoitteen". `ScenarioProjection` tietää jo `horizonEventCount`in ja
ehdotusten määrän, joten tieto on olemassa.

## 3. Varoitus: tämä oire on nyt näkymätön

Nykyisellä tuotantodatalla kate on 2030 ja horisontti 2050, joten
`forecastComplete` on **joka tapauksessa** `false` syystä
`coverage_ends_before_horizon`. Tyhjän suunnitelman ongelma ei siis näy
Vastiketarve-kortissa lainkaan ennen kuin kate ulotetaan horisontin loppuun.

Vika ei kadonnut, se meni piiloon. Tämä on koko syy sille että tehtävä on
kirjattu nyt eikä silloin kun se seuraavan kerran huomataan.

## 4. Testit

- Kaikki tapahtumat `suggested` → Vastiketarve kertoo että hyväksyttyjä
  tapahtumia ei ole, ei vain lukua.
- Vähintään yksi hyväksytty tapahtuma → nykyinen käytös ennallaan.
- Kate ulottuu horisontin loppuun JA kaikki tapahtumat `suggested` → tämä on
  se tila jossa oire on paljas; sen on kerrottava itsestään.
- Regressio: `projectEvents` ei ala laskea ehdotuksia mukaan.

## 5. Rajaus

Ei muutoksia `forecastComplete`-sääntöön (`feature/forecast-complete` teki
sen). Ei muutoksia siihen mitä `projectEvents` laskee. Tämä on
esitystehtävä, ei laskentatehtävä.

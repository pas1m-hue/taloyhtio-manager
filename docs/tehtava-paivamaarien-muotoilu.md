# Tehtävä: päivämäärien esitysmuoto (ei vielä tehty)

Kirjattu 2026-09-11 branchilla `fix/selvitykset-viilaus`. Selvitykset-näkymän
päivämäärät pyydettiin suomalaiseen muotoon "samalla funktiolla kuin muut
näkymät" — mutta sellaista funktiota ei ole. **Yksikään näkymä ei muotoile
päivämääriä**: kaikki renderöivät tallennetun ISO-merkkijonon sellaisenaan.
`Intl`-muotoilua käytetään vain rahalle ja prosenteille (`money`, `percent`,
`moneyCompact` app.js:ssä).

Selvitykset jätettiin siksi ISO-muotoon: yksi suomalaisittain muotoiltu näkymä
kahdentoista ISO-näkymän joukossa olisi epäjohdonmukaisuus toiseen suuntaan.

## Missä ISO näkyy nyt (public/app.js)

| Rivi | Näkymä | Kenttä |
|---|---|---|
| 617 | yläpalkki | `updatedAt` (aikaleima, ei pelkkä päivä) |
| 915, 1934 | Rakennusosa- ja tapahtumadetalji | havainnon `observedAt` |
| 1277, 1309 | Havainnot, lista ja detalji | `observedAt` |
| 1528, 1559 | Kustannusnäyttö, lista ja detalji | `validUntil` |
| 3225, 3246, 3320, 3365 | Taloudellinen asema | taseen `asOfDate` |
| (kassapolku) | Toteutuneet korjaukset | `occurredAt` — huom. fixtureissa arvo voi olla "2025-Q4", ei päivä |
| Selvitykset | Kunnossapitotarveselvitys | `boardHandledAt`, `meetingPresentedAt` |

Lisäksi Korjaustapahtumat-detalji näyttää `actual.occurredAt`:n.

## Ehdotus

Yksi puhdas funktio `adminOperationPayloads.js`:ään, esim.
`formatFinnishDate(iso)`: `"2026-04-28"` → `"28.4.2026"`. Ei `Intl.DateTimeFormat`ia
eikä `new Date()`-parsintaa, koska ISO-päivä ilman aikaa tulkittaisiin UTC:nä ja
voisi siirtyä vuorokauden Suomessa. Sääntö: jos syöte ei ole täsmälleen
`YYYY-MM-DD`, palautetaan sellaisenaan (kattaa "2025-Q4":n ja aikaleimat, joita
ei rikota). Tallennusmuoto pysyy ISO:na; vain esitys muuttuu.

Käyttöönotto on oma PR:nsä, koska se koskee kuutta näkymää: jokainen yllä
listattu kohta vaihdetaan `escapeHtml(formatFinnishDate(x))`-muotoon, ja
suodattimet (Havainnot `from`/`to`, rivi 1232) jätetään ISO-vertailuun kuten nyt.
Testit: pyöreä päivä, yksinumeroinen päivä ja kuukausi, ei-päivä-syöte
sellaisenaan, `undefined`.

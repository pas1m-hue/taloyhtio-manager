# Claude Code -tehtävä: UI-parannukset (detaljipaneeli → modaali, Tulot-näkymän esitystapa)

Työskentelet repositoriossa **pas1m-hue/taloyhtio-manager**. Vaiheet 1–4B mergattu mainiin, oikeaa dataa tuotannossa. Nämä ovat **käyttöliittymäparannuksia** jotka nousivat esiin oikean datan tutkimisessa. Ei tietomalli- eikä logiikkamuutoksia — pelkkää esitystapaa.

## 0. Kaksi parannusta

**Parannus 1 (tärkeämpi): Detaljipaneeli → keskitetty modaali.** Nykyinen detaljipaneeli (`#detail-panel`) avautuu kapeana näytön oikeaan reunaan. Leveä tilikohtainen data (useita vuosisarakkeita: Toteuma 2023/2024/2025, Budjetti 2026) ei mahdu näkyviin ilman vaakavieritystä — huono luettavuus. Muuta se **keskitetyksi modaaliksi (pop-up)** joka avautuu näytön keskelle, on leveämpi, ja näyttää koko taulukon kerralla.

**Parannus 2 (pienempi): Tulot-näkymän esitystapa yhdellä ryhmällä.** Tulot ryhmitellään ryhmätasolle ja tilit ovat detaljissa. Kun ryhmiä on vain yksi (käyttäjän taloyhtiöllä kaikki tulot ovat "Hoitovastikkeet"), päätaulukossa on vain yksi rivi ja kiinnostava tilikohtainen erittely on piilossa. Paranna niin että vähäryhmäisessä tapauksessa tilit näkyvät suoraan.

## 1. Parannus 1 — detaljipaneeli modaaliksi

Nykytila (jäljitetty): jaettu komponentti `#detail-panel` (index.html), `renderDetailPanel()` (app.js ~830), `openDetailPanel()`/`closeDetailPanel()` (~871), `DETAIL_PANEL_VIEWS`-joukko (~52), close-nappi (~215). Sitä käyttävät useat näkymät (rakennusosat, havainnot, tapahtumat, kustannusnäytöt, Tulot, Kulut ryhmittäin, Budjetti vs. toteuma).

Tehtävä: muuta `#detail-panel` **keskitetyksi modaaliksi** (overlay + keskellä leijuva paneeli), säilyttäen kaikki nykyiset kutsukohdat toimivina (sama `renderDetailPanel`/`open`/`close`-rajapinta, vain esitys muuttuu).

Vaatimukset:
- **Keskitetty overlay**: puoliläpinäkyvä tausta (dimmer) koko näytön päällä, modaali keskellä. Leveämpi kuin nykyinen sivupaneeli (esim. max-width ~900px, responsiivinen, ei mene näytön yli kapealla ruudulla).
- **Sulkeminen**: nykyinen close-nappi (X) säilyy; lisäksi sulkeutuu overlay-taustaa klikkaamalla ja **Esc**-näppäimellä. Varmista ettei overlay-klikkaus modaalin sisältöalueella sulje sitä (event.target-tarkistus).
- **Vaakavieritys pois tarpeesta**: leveämpi modaali mahduttaa vuosisarakkeet; jos silti kapealla ruudulla ahdas, salli vaakavieritys modaalin *sisällä* (ei koko sivulla).
- **Ei muuta sisältöä**: `renderDetailPanel`in tuottama taulukkosisältö pysyy samana, vain säiliö (paneeli→modaali) ja tyylit muuttuvat. Otsikko (`#detail-panel-title`) ja runko (`#detail-panel-body`) säilyvät.
- Tyylit `public/styles.css`iin (overlay, modaali, keskitys, dimmer). Ei ulkoisia kirjastoja, ei frameworkia — vanilla CSS + pieni JS Esc/overlay-käsittelyyn.
- **Saavutettavuus (kevyt):** modaalilla `role="dialog"` + `aria-modal="true"`; fokus siirtyy modaaliin auetessa ja palaa avanneeseen elementtiin sulkeutuessa (jos suoraviivaista; älä ylikomplisoi).

## 2. Parannus 2 — Tulot-näkymä vähällä ryhmämäärällä

Nykytila: `buildIncomeViewModel` + `renderIncome` (app.js) tuottavat ryhmätason rivit; tilit detaljipaneelissa.

Tehtävä (valitse selkein, dokumentoi suunnitelmassa):
- **Ehdotus:** kun tuloryhmiä on **vain yksi** (tai ≤ jokin pieni raja), näytä **tilit suoraan päätaulukossa** ryhmäotsikon alla (sisennettyinä), ilman että käyttäjän tarvitsee avata detaljia. Monen ryhmän tapauksessa säilytä nykyinen ryhmätaso + detalji.
- Vaihtoehtoisesti: näytä aina ryhmä + sen tilit sisennettyinä samassa taulukossa (kuten Kulut tileittäin tekee ryhmineen). Arvioi kumpi on johdonmukaisempi muun sovelluksen kanssa.
- Tämä on pieni parannus — älä ylikomplisoi. Jos se on siisteintä toteuttaa vain Tulot-näkymään, tee niin; jos sama vähäryhmä-ongelma koskee myös Kulut ryhmittäin -näkymää eikä korjaus ole triviaali sinne, jätä Kulut ennalleen ja mainitse se.

## 3. Rajaus

Ei tietomalli-, validointi-, read-model- eikä DB-muutoksia. Ei uusia admin-operaatioita. Ei jsdomia/frameworkia/bundleria. Vanilla HTML/CSS/JS. Kaikki nykyiset näkymät ja detaljipaneelin kutsukohdat pysyvät toimivina. UI-kieli suomi.

## 4. Testit

- `public/viewWiring.test.js`: modaalin id:t + close-napin kytkentä + (jos lisäät) Esc/overlay-käsittelyn kytkennät ristiintarkistuksiin. Varmista että kaikki `DETAIL_PANEL_VIEWS`-näkymät yhä löytävät modaalin elementit.
- Jos `buildIncomeViewModel`iin tulee muutos (esim. lippu "näytä tilit suoraan"), kata se `adminOperationPayloads.test.js`:ssä (yksi ryhmä → tilit mukana päätasolla; monta ryhmää → ennallaan).
- DOM-käyttäytyminen (modaali auki/kiinni, Esc, overlay-klikkaus, fokus) → manuaaliset testipolut PR-kuvaukseen (ei jsdomia).

## 5. Työskentelytapa

1. Branch **`feature/ui-modal-detail`** tuoreesta mainista.
2. **Suunnitelma ensin, ei koodia.** Odota hyväksyntää — erityisesti modaalin sulkemis-/fokuslogiikka ja Tulot-näkymän valittu lähestymistapa.
3. Committoi handoff ensimmäisenä. Pieniä committeja, testit joka välissä, `build:worker` lopuksi.
4. Manuaaliset testipolut PR-kuvaukseen: avaa detalji eri näkymissä (rakennusosat, Kulut ryhmittäin, Budjetti vs. toteuma) → modaali keskellä, leveä, sulkeutuu X/Esc/overlay; Tulot-näkymä yhdellä ryhmällä näyttää tilit suoraan.
5. **Luo PR** (base main). **Älä mergeä.**

## 6. Riippumattomuus

Riippumaton tase-korjauksesta ja ryhmäbudjetista. Voidaan tehdä milloin vain. Jos useita brancheja auki, kaikki mainista erikseen.

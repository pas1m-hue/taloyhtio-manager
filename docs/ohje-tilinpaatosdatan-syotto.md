# Ohje: tilinpäätösdatan syöttö Taloyhtiö Manageriin

Tämä on **sinun** työohjeesi (ei Claude Codelle). Pidä tämä käsillä aina kun syötät uuden tilinpäätöksen tai vanhaa dataa sovellukseen. Ohje kuvaa miten valmistelet datan ChatGPT:llä ja liität sen sovelluksen "Liitä tilikohtainen data" -näkymään.

---

## Kokonaiskuva: kolme vaihetta

1. **Saat datan digitaaliseen muotoon** (jos se on paperilla): kuvaa sivut, OCR, tai kirjoita. Tämä on sama esityö jonka teit jo vuosille 2023–2025. Sovellus EI tee tätä.
2. **Muotoilet datan ChatGPT:llä** sovelluksen ymmärtämään muotoon (alla valmis prompti).
3. **Liität sen sovellukseen** ja tarkistat esikatselusta ennen tallennusta.

---

## Formaatti jonka sovellus ymmärtää

Yksi rivi per tili per vuosi, sarakkeet **tab-eroteltuina** (tabulaattori niiden välissä — syntyy luonnostaan kun kopioit Excelistä tai taulukosta). Sarakkeet tässä järjestyksessä:

```
kind    ryhmä    tili    nimi    vuosi    budjetti    toteuma
```

- **kind**: `kulu` tai `tulo`
- **ryhmä**: ryhmän nimi, esim. `HALLINTOPALVELUT`, `VESI- JA JÄTEVESI`, `Hoitovastikkeet`
- **tili**: tilinumero, esim. `5300`
- **nimi**: tilin nimi, esim. `Isännöintipalkkiot`
- **vuosi**: vuosiluku, esim. `2025`
- **budjetti**: euromäärä TAI tyhjä (jos vuodelle ei ole budjettia)
- **toteuma**: euromäärä TAI tyhjä (jos vuodelle ei ole toteumaa)

**Tärkeää:**
- Jokaisella tilillä on **oma rivi jokaiselle vuodelle**. Esim. tili 5300 vuosille 2024, 2025, 2026 = kolme riviä.
- Budjetti ja toteuma erikseen. Jos jollekin vuodelle on vain toteuma (ei budjettia), jätä budjetti-sarake tyhjäksi — ja päinvastoin.
- Etumerkki säilytetään sellaisenaan (kulut ovat lähteessä usein negatiivisia, esim. `-5521.32` — jätä miinus).
- Desimaalit: piste tai pilkku käy (`-5521.32` tai `-5521,32`).

### Esimerkki (näin valmis data näyttää)

```
kulu    HALLINTOPALVELUT    5300    Isännöintipalkkiot    2024        -5298.76
kulu    HALLINTOPALVELUT    5300    Isännöintipalkkiot    2025        -5521.32
kulu    HALLINTOPALVELUT    5300    Isännöintipalkkiot    2026    -5701.32
kulu    HALLINTOPALVELUT    5301    Isänn.kokouspalkkiot    2024        -979.00
tulo    Hoitovastikkeet    3000    Hoitovastike, asunnot    2025        35642.04
```

---

## Valmis ChatGPT-prompti

Kun sinulla on tilinpäätösdata (Excelissä, kuvana, tekstinä — miten vain), anna se ChatGPT:lle **yhdessä tämän promptin kanssa**. Kopioi tämä sellaisenaan ja liitä datasi loppuun:

---

> Muotoile alla oleva taloyhtiön tilinpäätösdata täsmälleen seuraavaan muotoon. Tulosta VAIN data, ei selityksiä, ei koodilohkoa.
>
> **Muoto:** yksi rivi per tili per vuosi. Sarakkeet tab-eroteltuina tässä järjestyksessä:
> `kind` (tab) `ryhmä` (tab) `tili` (tab) `nimi` (tab) `vuosi` (tab) `budjetti` (tab) `toteuma`
>
> **Säännöt:**
> - kind = `kulu` kuluille, `tulo` tuloille.
> - Jokaiselle tilille erillinen rivi jokaiselle vuodelle jolle on dataa.
> - Jos vuodelle on vain toteuma eikä budjettia, jätä budjetti-sarake tyhjäksi (kaksi peräkkäistä tabia). Vastaavasti jos vain budjetti.
> - Säilytä lukujen etumerkki sellaisenaan (älä muuta miinusmerkkejä).
> - Käytä desimaalierottimena pistettä.
> - Ryhmänimi joka riville (esim. HALLINTOPALVELUT). Käytä lähteen omia ryhmänimiä.
> - Ensimmäiselle riville sarakeotsikot: `kind` (tab) `ryhmä` (tab) `tili` (tab) `nimi` (tab) `vuosi` (tab) `budjetti` (tab) `toteuma`
> - Älä keksi lukuja. Jos jokin arvo puuttuu lähteestä, jätä se sarake tyhjäksi.
>
> Tässä data:
>
> [LIITÄ TILINPÄÄTÖSDATASI TÄHÄN]

---

## Sovellukseen syöttö

1. Avaa sovellus, kirjaudu, **Lataa työtila**.
2. Mene Talous-osion **Liitä tilikohtainen data** -näkymään.
3. **Liitä** ChatGPT:n tuottama data tekstialueeseen.
4. Katso **esikatselu**: sovellus näyttää montako tiliä ja riviä syntyy, ja listaa mahdolliset virheet rivinumeroineen.
5. **Jos virheitä** (esim. "rivi 12: tuntematon kind"): korjaa data (usein helpointa pyytää ChatGPT:tä korjaamaan se rivi) ja liitä uudelleen. Sovellus on tarkoituksella tiukka — se ei arvaa eikä täytä puuttuvia hiljaa.
6. **Kun virheitä ei ole**, paina tallennus. Data menee sovellukseen ja näkyy Kulut tileittäin -näkymässä (ja myöhemmin Tulot / Budjetti vs. toteuma -näkymissä).

---

## Vinkkejä

- **Tarkista esikatselusta tilien ja rivien määrä** — jos odotit 40 tiliä ja näkyy 30, jotain jäi pois.
- **Syötä vuosi kerrallaan tai kaikki kerralla** — kumpi tahansa toimii. Sovellus yhdistää saman tilin eri vuodet automaattisesti.
- **Päivitys onnistuu:** jos syötät saman tilin ja vuoden uudelleen (esim. korjatun luvun), se päivittää vanhan.
- **Säilytä lähdeviittaus:** merkitse mistä data on (esim. "tilinpäätös 2025") — se auttaa myöhemmin muistamaan mihin luvut perustuvat.
- **DATA GAP -periaate:** jos jokin luku on epävarma tai puuttuu, älä keksi sitä. Jätä tyhjäksi tai merkitse muistiin. Sama kuri kuin muuallakin sovelluksessa.

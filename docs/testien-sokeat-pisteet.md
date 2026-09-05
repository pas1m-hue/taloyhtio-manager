# Testien sokeat pisteet: kun testi näyttää kattavan polun mutta ei kata

Tämä muistiinpano on olemassa koska sama vikaluokka on löytynyt **kahdesti
peräkkäin lyhyen ajan sisällä**. Molemmissa tapauksissa testi ajoi oikean
näköisen polun, meni vihreänä läpi eikä olisi voinut nähdä vikaa. Kun sama
kuvio toistuu, se kannattaa kirjata ylös eikä löytää kolmatta kertaa alusta.

## Kuvio

> Testi kattaa polun **muodollisesti** mutta ei **olosuhteiltaan**: se ajaa
> oikeat funktiot oikeassa järjestyksessä, mutta syötteellä tai kokoonpanolla
> jolla vika ei voi ilmetä.

Vihreä testi ei siis tarkoita että polku on todistettu. Se tarkoittaa että
polku on todistettu *niillä ehdoilla joilla testi sen ajoi*.

## Tapaus 1: varjostava testikaksonen

*(PR: feature/fix-rls-publications)*

`postgresPersistence.test.ts` ja `postgresAuthPersistence.test.ts`
määrittelivät **kumpikin oman `PGliteSqlPool`-luokkansa**, joka varjosti
oikeaa `src/database/pgliteSqlPool.ts`:ää. Kopiot olivat toimivia mutta
riisuttuja: niistä puuttui ajurivirheiden käännös.

Ensimmäinen versio uudesta virheenkäsittelytestistä meni läpi **todistamatta
mitään** — se ajoi kopion läpi, jossa käännöstä ei ollut.

**Miksi se syntyi:** testikaksonen kirjoitettiin ennen kuin tuotantoadapteri
oli olemassa, eikä sitä poistettu kun adapteri tuli.

**Havaitseminen:** jos testissä on luokka jonka nimi on sama kuin
tuotantoluokan, se on lähes aina virhe. Käytä tuotantoadapteria.

## Tapaus 2: tasasekunti-aikaleimat

*(PR: fix/session-timestamp-precision)*

Visitor-session luonti kaatui tuotannossa heti ensimmäisellä yrityksellä:
`parseSessionRow` vertasi aikaleimoja `Date.parse(String(row.created_at))`
-muodossa, joka pudottaa millisekunnit, ja hylkäsi juuri kirjoittamansa rivin.

**Jokainen session-testien aikaleima oli tasasekunti**
(`"2026-07-17T20:00:00+03:00"`), ja tasasekunnilla `Date.parse(String(date))`
on täsmälleen oikein. Vika vaati nollasta poikkeavat millisekunnit, joita
tuottaa vain oikea `SystemServerClock` — jota testit eivät käytä.

Kun aikaleimoihin lisättiin millisekunnit, **seitsemän testiä alkoi kaatua**
vanhalla koodilla. Ennen sitä nolla.

**Miksi se syntyi:** siistit kiinteät aikaleimat ovat luettavia, ja
tasasekunti on luettavin. Luettavuus valitsi juuri sen arvon jolla vika on
näkymätön.

**Havaitseminen:** kun kiinteä arvo valitaan "siistiydeltään", kysy mitä se
tekee mahdottomaksi näkemään. Nolla, tyhjä merkkijono, tasasekunti ja
tasaluku ovat kaikki erikoistapauksia.

## Mitä tästä seuraa

**1. Vihreä testi ei riitä todisteeksi — riko koodi ja katso.** Molemmissa
tapauksissa vika löytyi vasta kun korjaus poistettiin ja testit ajettiin
uudelleen. Jos testi ei kaadu ilman korjausta, se ei testaa korjausta. Tämä
on halpaa ja se on tehtävä jokaiselle korjaukselle josta kirjoitetaan testi.

**2. Epäile "siistejä" fixture-arvoja.** Tasasekunti, nolla, tyhjä lista ja
yksi alkio ovat kaikki arvoja joilla jokin luokka virheitä ei voi ilmetä.

**3. Epäile testikaksosta joka toistaa tuotantoluokan.** Jos se on
yksinkertaisempi kuin oikea, ero on juuri se mitä testi ei kata.

**4. Sama asia kahdessa paikassa eri tavalla on ansa.** Tapaus 2:n juurisyy ei
ollut väärä vertailu vaan **epäsymmetria**: `instantMillis` oli yhdessä
tiedostossa oikein ja toisessa tiedostossa käsin kirjoitettu väärin.
`integer()` oli kahtena kopiona. Kun sama tehtävä on useassa paikassa, ne
ajautuvat erilleen, ja vain toinen niistä testataan.

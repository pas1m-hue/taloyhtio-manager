# Seed-skriptit

## `seed-initial-data.ts` (vaihe 2B-2)

Kertakäyttöinen skripti, joka syöttää lämminvesivaraajien pitkän aikavälin
skenaariot ja "Kuluva kausi 2026" -datan `housing_company_demo`-yhtiöön
sovelluksen oman admin-HTTP-APIn kautta (`POST /api/v1/admin/companies/:companyId/changes`).

Skripti on **idempotentti**: se hakee ensin nykyisen työtilan ja kieltäytyy
ajamasta jos seed-data on jo olemassa. Se ei koskaan poista tai korvaa
käsin tehtyjä muutoksia.

### Ympäristömuuttujat

| Muuttuja | Pakollinen | Kuvaus |
|---|---|---|
| `TM_ADMIN_TOKEN` | kyllä | Kirjautuneen adminin Supabase-sessiotoken (Bearer). **Ei service-role-avainta, ei kovakoodattu, ei committoitu.** |
| `TM_TARGET_URL` tai 1. komentoriviargumentti | ei | Kohde-URL, esim. `http://127.0.0.1:8787` (paikallinen `wrangler dev`) tai tuotanto-osoite. Oletus: `http://127.0.0.1:8787`. |
| `TM_TRAILING_12M_OPERATING_COSTS` | ei* | 12 kk hoitokulut vahvistettuna lukuna. Suositellaan aina kun mahdollista. |
| `TM_ALLOW_PLACEHOLDER` | ei* | `1` sallii nimetyn paikkamerkkiarvon (ks. alla) `TM_TRAILING_12M_OPERATING_COSTS`:in sijaan. |
| `TM_COMPANY_ID` | ei | Kohdeyhtiön id. Oletus: `housing_company_demo`. |

\* Jompikumpi näistä kahdesta on annettava, muuten skripti kieltäytyy heti
selkeällä DATA GAP -virheellä.

### ⚠ DATA GAP: 12 kk hoitokulut

Excelin "Kuluva kausi 2026" -välilehti ei sisällä trailing-12kk
hoitokululukua, jota `LiquidityBaselineRecord` kuitenkin vaatii. Skripti
**ei koskaan keksi tätä lukua hiljaa**:

- Anna oikea, tilinpäätöksestä tms. vahvistettu luku
  `TM_TRAILING_12M_OPERATING_COSTS`-muuttujassa, **tai**
- aja `TM_ALLOW_PLACEHOLDER=1`, jolloin käytetään näkyvästi merkittyä
  paikkamerkkiä **34 029,46 €** (sama luku kuin Kulut-välilehden "Hoito
  yhteensä 2025", Kulut!B19 — sama luku jota `src/fixtures/liquidityBaseline.ts`
  käyttää testifixtuurina "corrected workbook" -arvona, mutta se **ei ole
  virallinen vahvistettu 12 kk hoitokulu**). Paikkamerkki tallentuu
  näkyvästi liquidity-baselinen `notes`-kenttään, jotta se ei koskaan näytä
  hiljaiselta oikealta luvulta admin-UI:ssa.

## Ajo-ohje

```bash
export TM_ADMIN_TOKEN="<kirjautuneen adminin sessiotoken>"
export TM_TARGET_URL="http://127.0.0.1:8787"   # tai tuotanto-URL
export TM_TRAILING_12M_OPERATING_COSTS="<vahvistettu luku>"   # tai TM_ALLOW_PLACEHOLDER=1

npm run seed:initial-data
```

`npm run seed:initial-data` kääntää skriptin (ja tarvitsemansa `src/`-osat)
`scripts-dist/`-hakemistoon `scripts/tsconfig.json`:n avulla ja ajaa sen
suoraan Node.js:llä (ei ylimääräisiä ajonaikaisia riippuvuuksia). Tämä
build on erillinen sovelluksen omasta `npm run build` -Worker-buildista,
eikä vaikuta siihen. `scripts-dist/` on `.gitignore`ssa.

**Aja vain kerran.** Skripti tarkistaa tilan ensin ja kieltäytyy jos data
on jo olemassa, mutta älä silti aja sitä toistuvasti tuotantoa vasten
ilman syytä.

**Älä committoi `TM_ADMIN_TOKEN`-arvoa mihinkään.** Se on henkilökohtainen,
lyhytikäinen sessiotoken.

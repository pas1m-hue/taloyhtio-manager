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
| `TM_COMPANY_ID` | ei | Kohdeyhtiön id. Oletus: `housing_company_demo`. |

Likviditeetin lähtötasoon tallennetaan vain kassa (31.12.2025 rahat ja
pankkisaamiset). 12 kk hoitokulut ja hoitokate lasketaan tilidatasta
liitettyjen tilinpäätösten perusteella, eikä niitä tallenneta tietueeseen.

## Ajo-ohje

```bash
export TM_ADMIN_TOKEN="<kirjautuneen adminin sessiotoken>"
export TM_TARGET_URL="http://127.0.0.1:8787"   # tai tuotanto-URL

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

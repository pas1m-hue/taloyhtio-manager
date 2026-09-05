# Claude Code -tehtävä: ajonaikainen tarkistus RLS-ajautumiselle

Seurantatehtävä PR:lle *feature/fix-rls-publications*. Ei kiireellinen, mutta
se on **ainoa kerros joka huomaa ongelman ennen kuin jokin hajoaa**.

## 0. Miksi

`tm_publications`, `tm_visitor_sessions` ja `tm_visitor_session_access` olivat
RLS:n takana ilman yhtään käytäntöä. Vika oli latentti kuukausia, koska
`tm_publications`iin ei ollut koskaan kirjoitettu, ja paljastui vasta
ensimmäisellä julkaisuyrityksellä.

Migraatio 004 korjasi tilan. Se **ei estä toistumista**: se ajetaan kerran, ja
Supabasen Security Advisor kehottaa kytkemään RLS:n uudelleen aina kun joku
katsoo konsolia. Sama ansa viritetään yhdellä klikkauksella, ja seuraava
paljastuminen on taas "jokin lakkasi toimimasta" kuukausien päästä — harvoin
kirjoitettavilla tauluilla vielä pidemmän ajan.

## 1. Mitä rakennetaan

`GET /api/v1/health/database`, joka ajaa yhden luentakyselyn:

```sql
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'tm\_%'
  AND c.relrowsecurity
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = n.nspname AND p.tablename = c.relname
  )
```

**Ehto on tarkka, ei heuristinen.** RLS päällä ilman yhtään käytäntöä ei ole
tässä arkkitehtuurissa koskaan kelvollinen tila millekään taululle — perustelu
`docs/tietokannan-kayttooikeusmalli.md`. Vääriä positiivisia ei siis synny, ja
siksi tarkistuksen saa kytkeä valvontaan joka hälyttää.

Vastaus:

- `200 {"status":"ok"}`
- `503 {"status":"degraded","failing":3}`

**Taulujen nimet vain palvelinlokiin, ei vastaukseen.** Päätepiste on
autentikoimaton jotta siihen voi osoittaa uptime-valvonnan ilman tokenia, eikä
skeeman rakennetta ole syytä vuotaa siinä samalla.

## 2. Miksi tämä ei mahtunut korjaus-PR:ään

Se on uusi portti, adapteri ja kytkentä kahteen ajoympäristöön — oma
riskipintansa. Julkaisu oli rikki ja tarvitsi pienen ja varman korjauksen.
Lisäksi migraatiota ei voi muuttaa jälkikäteen (tarkistussumma lukitsee sen),
ja se on helpompi varmistaa pienessä PR:ssä.

## 3. Rakenteellinen työ

`createHttpServer` saa nyt vain `{publications, sessions, access}`, ei raakaa
poolia. Tarvitaan siis:

- **`DatabaseDiagnosticsPort`** — yksi metodi, esim.
  `tablesWithUnusableRowLevelSecurity(): Promise<readonly string[]>`.
- **Postgres-adapteri** sen toteutukseksi (`SqlPool`in päällä).
- **Kytkentä kahteen paikkaan:** `src/cloudflare/worker.ts` (Hyperdrive) ja
  `src/http/runtime/createPostgresRuntime.ts` (Node).

Tämä on linjassa talon ports-and-adapters-tavan kanssa.

## 4. Testit

PGlite on oikea PostgreSQL, joten `pg_class` ja `pg_policies` toimivat:

- Puhdas kanta → `ok`.
- `ALTER TABLE tm_publications ENABLE ROW LEVEL SECURITY` ilman käytäntöä →
  `degraded`, taulu nimetään lokissa.
- RLS **käytännön kanssa** → `ok`. Tämä on tärkein: ei väärää positiivista,
  koska väärä positiivinen opettaa sivuuttamaan hälytyksen.
- Vastaus ei sisällä taulujen nimiä.
- `GET /api/v1/health` säilyy ennallaan (ei tietokantakyselyä, ei hidastumista).

## 5. Rajaus

Ei muutoksia migraatioihin, ei virheenkäsittelyyn (molemmat tehty PR:ssä
*feature/fix-rls-publications*), ei uusia RLS-käytäntöjä.

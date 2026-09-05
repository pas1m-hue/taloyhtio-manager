# Tietokannan käyttöoikeusmalli: miksi tämä skeema ei käytä RLS:ää

Tämä muistiinpano on olemassa yhtä tarkoitusta varten: kun Supabasen Security
Advisor seuraavan kerran kehottaa kytkemään row-level securityn `tm_`-tauluihin,
kehotus osataan **hylätä tietoisesti** eikä hyväksyä refleksinä.

## Sääntö

**`tm_`-tauluissa ei ole RLS:ää eikä käytäntöjä.** Migraatio
`004_disable_unused_row_level_security.sql` poistaa sen tauluista joissa se oli.

## Perustelu

RLS on suunniteltu tilanteeseen jossa **asiakas puhuu tietokannalle suoraan** —
Supabasen anon-avain selaimesta, jolloin tietokanta on ainoa paikka jossa
valtuutus voidaan tehdä.

Tämä arkkitehtuuri ei ole se:

- **Cloudflare Worker on ainoa joka koskee tietokantaan.** Yhteys kulkee
  Hyperdriven kautta palvelinpuolella. Selain ei näe tietokantaa eikä sillä ole
  tietokantatunnuksia.
- **Valtuutus tehdään sovelluskerroksessa.** Supabase-JWT:n tarkistus
  (`src/auth/supabaseJwtAuthentication.ts`) ja yhtiökohtaiset käyttöoikeudet
  (`tm_company_access_grants`, `src/auth/authorization.ts`).

Salliva RLS-käytäntö ei siis voisi tarkistaa mitään mielekästä. Sillä ei ole
pääsyä siihen tietoon jolla valtuutus tehdään — ei JWT:n subjektiin eikä
pyynnön kontekstiin — joten ainoa mahdollinen käytäntö olisi `USING (true)`.
Se antaisi turvallisuuden vaikutelman tarkistamatta mitään, mikä on huonompi
kuin RLS:n puuttuminen: se näyttää tarkastuslistalla vihreältä.

## Mitä tapahtui kun RLS oli päällä

`tm_publications`, `tm_visitor_sessions` ja `tm_visitor_session_access` olivat
RLS:n takana **ilman yhtään käytäntöä**, mikä torjuu jokaisen kirjoituksen.
`pg_policies` palautti nolla riviä, `relforcerowsecurity` oli kaikilla `false`,
ja muut `tm_`-taulut olivat ilman RLS:ää — siksi admin-työ toimi normaalisti.

Vika oli **latentti**. Tähän tietokantaan ei ollut koskaan kirjoitettu
`tm_publications`iin, joten se paljastui vasta ensimmäisellä julkaisuyrityksellä
`INTERNAL_SERVER_ERROR`ina, jonka todellinen syy näkyi vain palvelinlokissa.

Huomionarvoinen yksityiskohta jos tätä joskus toistetaan testissä: **superuser
ohittaa RLS:n kokonaan**, myös `FORCE ROW LEVEL SECURITY`n kanssa. PGlite
yhdistää `postgres`-käyttäjänä, joten pelkkä RLS:n päälle kytkeminen testissä ei
tuota torjuntaa lainkaan — tarvitaan `SET ROLE` oikeudettomaan rooliin. Tuotannossa
torjunta syntyi siitä että Worker tavoittaa taulun ei-omistajaroolina.

## Jos RLS pitää joskus ottaa käyttöön

Ainoa tilanne joka muuttaisi tämän päätöksen on että selain alkaisi puhua
Supabaselle suoraan (esim. Supabase-client anon-avaimella). Silloin RLS ei ole
valinnainen, ja käytännöt on kirjoitettava ennen kuin yksikään suora yhteys
avataan — ei jälkikäteen.

## Miten poikkeama huomataan

Migraatio 004 korjaa tunnetun tilan; **se ei ole vartija**. Ajonaikainen
tarkistus on kirjattu erikseen:
`docs/claude-code-handoff-tietokannan-diagnostiikka.md`.

Siihen asti poikkeama huomataan vasta kirjoituksen kaatuessa — mutta silloin
virhe on nimetty (`DATABASE_ACCESS_POLICY_ERROR`) ja kertoo mitä tehdä, sen
sijaan että se olisi sisällötön `INTERNAL_SERVER_ERROR`.

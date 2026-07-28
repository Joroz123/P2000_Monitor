# P2000 Relay — Cloudflare Worker

Haalt de 5 112-nu.nl discipline-feeds elke minuut op, voegt ze samen, en
cachet het resultaat in Cloudflare KV. Alle P2000-melderschermen praten met
dít ene endpoint in plaats van elk apart met 112-nu.nl — netjes richting
hun fair-use-beleid, en één plek om te fixen als er iets verandert.

## Eenmalig opzetten

1. **Account** — maak een gratis Cloudflare-account op cloudflare.com als je
   die nog niet hebt.
2. **Wrangler installeren** (Cloudflare's command-line tool):
   ```
   npm install -g wrangler
   wrangler login
   ```
3. **KV-namespace aanmaken** (dit is de cache-opslag):
   ```
   wrangler kv namespace create P2000_CACHE
   ```
   Dit commando print een `id = "...")` — plak die waarde in `wrangler.toml`
   op de regel `id = "VUL_HIER_JE_KV_NAMESPACE_ID_IN"`.
4. **Deployen**:
   ```
   wrangler deploy
   ```
   Je krijgt een URL terug zoals `https://p2000-relay.<jouw-account>.workers.dev`.

## Testen

- `https://p2000-relay.<...>.workers.dev/` — geeft de gecachte meldingen
  terug, één JSON-object per regel (NDJSON):
  ```
  {"service":"Brandweerdiensten","region":"Rotterdam","text":"...","pubDate":"..."}
  {"service":"Ambulancediensten","region":"Den Haag","text":"...","pubDate":"..."}
  ```
- `https://p2000-relay.<...>.workers.dev/health` — laat zien wanneer de cache
  voor het laatst ververst is en hoeveel meldingen erin zitten. Handig om te
  checken of de cron-trigger daadwerkelijk draait.

## Kosten

Cloudflare Workers gratis tier: 100.000 requests/dag, ruim voldoende voor
tientallen bordjes die elke 30 sec pollen (dat is samen nog geen 3.000
requests/dag). De cron-trigger (1x/minuut = 1.440 keer/dag) telt ook mee
binnen die limiet en blijft ruim onder de grens.

## Volgende stap

Zodra je de Worker-URL hebt, geef die aan mij door — dan pas ik
`p2000_client.cpp`/`.h` in de firmware aan zodat bordjes dit ene endpoint
uitlezen in plaats van de 5 losse 112-nu.nl-feeds. Dat maakt de firmware
zelf ook simpeler (1 HTTP-call per ronde i.p.v. 5).

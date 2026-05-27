# Setup: B2metrics → GitHub sync (Apps Script)

Tento script tahá data ze [B2metrics](https://app.b2metrics.com) přes API a ukládá je do `data.json` v tomto repu. Stránka (`https://ondrejmarikmedia.github.io/marketing-planner/`) pak data načítá přes `fetch('./data.json')` — bez CORS problémů, bez API tokenu v prohlížeči.

## Proč proxy?

B2metrics API nepovoluje CORS hlavičky pro `https://ondrejmarikmedia.github.io`, takže fetch přímo z prohlížeče selže s "Failed to fetch". Apps Script běží server-side (na Google infrastruktuře), takže CORS se ho netýká.

## Setup (jednorázový, ~10 min)

### 1) Vytvoř GitHub Personal Access Token
1. https://github.com/settings/tokens/new
2. Note: `marketing-planner b2m sync`
3. Expiration: 1 rok (nebo No expiration)
4. Scopes: ☑️ **repo** (Full control of private repositories)
5. Klik **Generate token** → zkopíruj `ghp_xxxxxxxxxxxxx` (ukáže se jen jednou!)

### 2) Vytvoř Apps Script projekt
1. https://script.google.com → **New project**
2. Soubor `Code.gs` přepiš obsahem souboru [`SyncB2mToGitHub.gs`](./SyncB2mToGitHub.gs)
3. Save (Ctrl+S)

### 3) Vlož config do Script properties
1. V Apps Script: **Project Settings** (ozubené kolo vlevo)
2. Scroll dolů → **Script properties** → **Add script property**
3. Přidej tyto klíče (každý zvlášť):

| Klíč | Hodnota |
|------|---------|
| `B2M_TOKEN` | `b2m_700c32ea5e5a37a5492b3c9d09361cd05ab46f979cc883a6` |
| `B2M_URL` | `https://app.b2metrics.com/api/v1/webs/year?webID=195` |
| `GH_TOKEN` | `ghp_xxxxxxxx` (z kroku 1) |
| `GH_OWNER` | `ondrejmarikmedia` |
| `GH_REPO` | `marketing-planner` |
| `GH_BRANCH` | `main` |
| `GH_FILE` | `data.json` |

4. **Save script properties**

### 4) První spuštění (autorizace)
1. Zpět v Code.gs vyber funkci `syncOnce` v dropdownu nahoře
2. Klik **Run** ▶
3. Google se zeptá na oprávnění — povol (Allow → Continue → Allow). Občas vyhodí "App isn't verified" → "Advanced" → "Go to project (unsafe)" → Allow.
4. Pokud vše OK, v Execution log uvidíš: `✓ Synced 13 fresh rows, total 13 months in data.json`
5. Zkontroluj že v repu (https://github.com/ondrejmarikmedia/marketing-planner) je nově soubor `data.json`

### 5) Naplánovat denní spouštění
1. V Apps Script: ikona budíku **Triggers** (vlevo)
2. **Add Trigger** (pravý dolní roh)
   - Function: `syncOnce`
   - Event source: `Time-driven`
   - Type: `Day timer`
   - Time: `6am to 7am` (kdykoliv mimo špičku)
3. Save

Hotovo. Každý den ráno se z B2metrics natáhnou poslední data (13 měsíců) a smerguje se s tím co už v `data.json` je. Po roce máš plný rok historie, po 2 letech 2 roky, atd.

## Jak stránka načítá data

Stránka při startu volá `loadDataJson()` který čte z URL nastavené v **Nastavení → URL data.json**. Nastav tam:
```
https://ondrejmarikmedia.github.io/marketing-planner/data.json
```
nebo (alternativně, bez čekání na GitHub Pages cache):
```
https://raw.githubusercontent.com/ondrejmarikmedia/marketing-planner/main/data.json
```

## Manuální sync (kdykoliv)

V Apps Scriptu klik **Run** na `syncOnce` — okamžitě stáhne fresh data, smerguje a pushe.

## Troubleshooting

| Problem | Řešení |
|---------|--------|
| `Missing script property: ...` | Chybí klíč v Project Settings → Script properties |
| `B2metrics HTTP 401` | Špatný/expirovaný `B2M_TOKEN` |
| `GitHub PUT HTTP 401` | `GH_TOKEN` nemá `repo` scope nebo expiroval |
| `GitHub PUT HTTP 409` | Konflikt — někdo mezitím změnil `data.json`. Spusť znovu. |
| Trigger neběží | Apps Script Triggers musí mít aktivní `syncOnce` |

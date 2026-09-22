# Werbung

Selbst gehostetes Werbenetzwerk auf Cloudflare Workers. Läuft unter
**https://example.invalid** und wird per `<iframe>` in andere
Websites eingebettet: Besucher klicken "Belohnung beanspruchen", es läuft eine
gewichtet ausgewählte Anzeige (Bild/Video/Text/Link/HTML), danach erhält die
einbettende Seite per `postMessage` das Signal, die Belohnung freizuschalten.

Verwaltung von Anzeigen, Websites, Gewichtung, Terminierung und Statistik läuft
über das Admin-Portal unter `/admin` — geschützt durch Cloudflare Zero Trust
Access (nicht durch ein eigenes Login im Code).

Eine vollständige Embed-Anleitung inkl. `postMessage`-Events steht direkt im
Admin-Portal unter **Integration**.

## Architektur

- **Cloudflare Workers** (Hono) — API + Ausspielungslogik
- **D1** (SQLite) — Anzeigen, Websites, Regeln, Event-Log, Einstellungen
- **Workers KV** — Speicher für hochgeladene Bilder/Videos (max. 20 MB/Datei)
- **Cloudflare Access** — schützt `/admin*` (Portal + dessen API) auf Zonenebene
- Statische Dateien (`public/`) werden über die Workers-Assets-Bindung
  ausgeliefert; alles unter `/api/*`, `/admin/api/*` und `/media/*` läuft
  zwingend durch den Worker (`run_worker_first` in `wrangler.jsonc`).

## Lokale Entwicklung

```bash
npm install
npm run db:migrate:local   # Schema in die lokale D1-Instanz einspielen
npm run dev                # wrangler dev
```

Die Admin-API prüft den Header `Cf-Access-Authenticated-User-Email`. Lokal
kommt der nicht von Cloudflare — zum Testen einfach selbst mitschicken:

```bash
curl -H "Cf-Access-Authenticated-User-Email: user@example.invalid" \
  http://localhost:PORT/admin/api/ads
```

## Deployment

```bash
npm run db:migrate:remote  # bei Schema-Änderungen zuerst
npm run deploy
```

`wrangler deploy` aktualisiert Worker-Code, Assets und die Custom-Domain-Route
in einem Schritt. Zero Trust Access, D1 und die KV-Namespace-Bindung sind
bereits eingerichtet (siehe `wrangler.jsonc`).

## Datenmodell (Kurzfassung)

- `ads` — Creative, Klick-Verhalten, Anzeigedauer, Gewicht, Priorität,
  Frequenz-Cap, Zeitraum, `restricted_to_sites`
- `sites` — pro einbindende Website ein `site_key` für die Embed-URL
- `ad_site_rules` — Gewicht-Override bzw. Ausschluss einer Anzeige pro Website
- `events` — Impressions/Klicks/Abschlüsse/Skips für die Statistik
- `settings` — globale Defaults (Button-Text, Farbe, Fallback-Verhalten)

Die Ausspielungslogik (`src/selection.ts`) filtert nach Zeitplan und
Frequenz-Cap, gruppiert nach Priorität und wählt danach gewichtet zufällig
innerhalb der höchsten verfügbaren Prioritätsstufe.

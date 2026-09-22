# Werbung

Selbst gehostetes Werbenetzwerk auf Cloudflare Workers. Läuft unter
**https://example.invalid** und wird per `<iframe>` in andere
Websites eingebettet: Besucher klicken "Belohnung beanspruchen", es läuft eine
gewichtet ausgewählte Anzeige (Bild/Video/Text/Link/HTML), danach erhält die
einbettende Seite per `postMessage` das Signal, die Belohnung freizuschalten —
optional serverseitig verifizierbar über ein Einmal-Token (siehe „Belohnungs-
Verifizierung" unten).

Verwaltung von Anzeigen, Kampagnen, Websites, Gewichtung/Targeting,
Terminierung und Statistik läuft über das Admin-Portal unter `/admin` —
geschützt durch Cloudflare Zero Trust Access (nicht durch ein eigenes Login im
Code).

Eine vollständige Embed-Anleitung inkl. `postMessage`-Events und der
Belohnungs-Verifizierung steht direkt im Admin-Portal unter **Integration**.

## Architektur

- **Cloudflare Workers** (Hono) — API + Ausspielungslogik
- **D1** (SQLite) — Anzeigen, Kampagnen, Websites, Regeln, Event-Log,
  Belohnungs-Tokens, Einstellungen
- **R2** — Objektspeicher für hochgeladene Bilder/Videos. Kleine Dateien
  (≤15 MB) laufen über einen einfachen Upload, größere automatisch über
  chunked Multipart-Upload (8 MB-Teile) direkt aus dem Admin-Panel — die
  maximale Dateigröße insgesamt ist in **Einstellungen** konfigurierbar
  (Standard: 2048 MB). `/media/:key` unterstützt HTTP-Range-Requests, damit
  Videos im Player vor- und zurückgespult werden können.
- **Cloudflare Access** — schützt `/admin*` (Portal + dessen API) auf Zonenebene
- Statische Dateien (`public/`) werden über die Workers-Assets-Bindung
  ausgeliefert; alles unter `/api/*`, `/admin/api/*` und `/media/*` läuft
  zwingend durch den Worker (`run_worker_first` in `wrangler.jsonc`).

### R2 muss einmalig aktiviert werden

R2 ist auf dem Account noch nicht freigeschaltet (das lässt sich nicht per API
erledigen, nur im Dashboard):

1. https://dash.cloudflare.com öffnen → den Account wählen → **R2 Object
   Storage** im linken Menü.
2. „R2-Plan aktivieren" bestätigen (kostenlose Stufe: 10 GB Speicher, 1 Mio.
   Class-A- und 10 Mio. Class-B-Operationen/Monat inklusive — für dieses
   Projekt in normalem Betrieb ausreichend).
3. Danach einmalig:
   ```bash
   npx wrangler r2 bucket create werbung-media
   npm run db:migrate:remote   # falls noch nicht geschehen
   npm run deploy
   ```

Bis dahin funktioniert alles **lokal** (`npm run dev`) bereits vollständig —
Miniflare simuliert R2 lokal unabhängig vom Account-Status.

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
in einem Schritt. Zero Trust Access, D1 und die R2-Bucket-Bindung sind bereits
eingerichtet (siehe `wrangler.jsonc`) — R2 selbst muss wie oben beschrieben
einmalig aktiviert werden.

## Datenmodell (Kurzfassung)

- `ads` — Creative, Klick-Verhalten, Anzeigedauer, Gewicht, Priorität,
  Frequenz-Cap, Zeitraum, Status (Entwurf/Aktiv/Pausiert/Archiviert),
  Kampagnen-Zuordnung, Geo-/Geräte-Targeting, `restricted_to_sites`
- `campaigns` — bündelt Anzeigen, optionales Impressions-/Klick-Budget; bei
  Erreichen pausiert die Kampagne automatisch (ihre Anzeigen werden von der
  Ausspielung ausgeschlossen)
- `sites` — pro einbindende Website ein `site_key` für die Embed-URL, optional
  eine Webhook-URL für Belohnungs-Benachrichtigungen
- `ad_site_rules` — Gewicht-Override bzw. Ausschluss einer Anzeige pro Website
- `events` — Impressions/Klicks/Abschlüsse/Skips inkl. Land und Gerätetyp für
  die Statistik
- `reward_tokens` — einmal verwendbare, 10 Minuten gültige Tokens zur
  serverseitigen Bestätigung einer Belohnung (siehe unten)
- `settings` — globale Defaults (Button-Text, Farbe, Fallback-Verhalten,
  maximale Upload-Größe)

Die Ausspielungslogik (`src/selection.ts`) filtert nach Status, Zeitplan,
Frequenz-Cap, Kampagnen-Budget, Land und Gerätetyp, vermeidet nach Möglichkeit
die direkte Wiederholung derselben Anzeige, gruppiert nach Priorität und wählt
danach gewichtet zufällig innerhalb der höchsten verfügbaren Prioritätsstufe.

## Belohnungs-Verifizierung

Ein `postMessage` lässt sich im Browser fälschen. Deshalb erzeugt der Server
bei jedem Abschluss zusätzlich ein einmal verwendbares `rewardToken`
(`werbung:reward`-Event), das die einbettende Website **serverseitig** gegen
`GET /api/verify?token=...` prüfen kann, bevor sie eine echte Belohnung
gutschreibt. Alternativ kann pro Website eine Webhook-URL hinterlegt werden,
an die bei jedem Abschluss serverseitig ein `POST` geschickt wird (Best-Effort,
kein Retry — `/api/verify` bleibt die verlässliche Quelle). Details stehen im
Admin-Portal unter **Integration**.

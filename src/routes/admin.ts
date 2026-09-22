import { Hono } from "hono";
import type { AdRow, Env, SiteRow } from "../types";
import { requireAccessIdentity, actorEmail } from "../auth";
import { newId, newSiteKey, serializeAd, serializeSite } from "../util";
import { toSqliteDatetime } from "../selection";

const app = new Hono<{ Bindings: Env }>();
app.use("*", requireAccessIdentity);

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB, comfortably under the 25MB KV value limit

app.get("/api/whoami", (c) => c.json({ email: actorEmail(c) }));

// ---------- Ads ----------

app.get("/api/ads", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM ads ORDER BY created_at DESC").all<AdRow>();
  return c.json(results.map(serializeAd));
});

app.get("/api/ads/:id", async (c) => {
  const id = c.req.param("id");
  const ad = await c.env.DB.prepare("SELECT * FROM ads WHERE id = ?").bind(id).first<AdRow>();
  if (!ad) return c.json({ error: "not found" }, 404);
  const { results: rules } = await c.env.DB.prepare(
    "SELECT site_id, weight_override FROM ad_site_rules WHERE ad_id = ?"
  )
    .bind(id)
    .all<{ site_id: string; weight_override: number | null }>();
  return c.json({
    ...serializeAd(ad),
    rules: rules.map((r) => ({ siteId: r.site_id, weightOverride: r.weight_override })),
  });
});

interface AdPayload {
  name: string;
  type: AdRow["type"];
  mediaKey?: string | null;
  mediaMime?: string | null;
  mediaBytes?: number | null;
  title?: string | null;
  content?: string | null;
  clickAction: AdRow["click_action"];
  clickUrl?: string | null;
  postmessagePayload?: unknown;
  durationMode: AdRow["duration_mode"];
  durationSeconds?: number | null;
  skipAfterSeconds?: number | null;
  weight?: number;
  priority?: number;
  frequencyCapPerDay?: number | null;
  restrictedToSites?: boolean;
  enabled?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  rules?: { siteId: string; weightOverride: number | null }[];
}

function validateAdPayload(p: AdPayload): string | null {
  if (!p.name?.trim()) return "Name ist erforderlich.";
  if (!["image", "video", "text", "link", "html"].includes(p.type)) return "Ungültiger Typ.";
  if ((p.type === "image" || p.type === "video") && !p.mediaKey) return "Für Bild/Video muss zuerst eine Datei hochgeladen werden.";
  if ((p.type === "text" || p.type === "html") && !p.content?.trim()) return "Inhalt darf nicht leer sein.";
  if (p.type === "link" && !p.clickUrl?.trim()) return "Für Typ 'Link' ist eine Ziel-URL erforderlich.";
  if ((p.clickAction === "open_url" || p.clickAction === "redirect_top") && !p.clickUrl?.trim()) {
    return "Für diese Klick-Aktion ist eine Ziel-URL erforderlich.";
  }
  if (p.durationMode === "fixed" && (!p.durationSeconds || p.durationSeconds <= 0)) {
    return "Für feste Dauer ist eine Sekundenzahl > 0 erforderlich.";
  }
  if (p.durationMode === "until_finished" && p.type !== "video") {
    return "'Bis Ende' ist nur für Video-Anzeigen sinnvoll.";
  }
  return null;
}

app.post("/api/ads", async (c) => {
  const p = await c.req.json<AdPayload>();
  const err = validateAdPayload(p);
  if (err) return c.json({ error: err }, 400);

  const id = newId("ad");
  const email = actorEmail(c);

  await c.env.DB.prepare(
    `INSERT INTO ads (
      id, name, type, media_key, media_mime, media_bytes, title, content,
      click_action, click_url, postmessage_payload, duration_mode, duration_seconds,
      skip_after_seconds, weight, priority, frequency_cap_per_day, restricted_to_sites,
      enabled, starts_at, ends_at, created_by, updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      p.name.trim(),
      p.type,
      p.mediaKey ?? null,
      p.mediaMime ?? null,
      p.mediaBytes ?? null,
      p.title ?? null,
      p.content ?? null,
      p.clickAction,
      p.clickUrl ?? null,
      p.postmessagePayload ? JSON.stringify(p.postmessagePayload) : null,
      p.durationMode,
      p.durationSeconds ?? null,
      p.skipAfterSeconds ?? null,
      p.weight ?? 100,
      p.priority ?? 0,
      p.frequencyCapPerDay ?? null,
      p.restrictedToSites ? 1 : 0,
      p.enabled === false ? 0 : 1,
      p.startsAt ? toSqliteDatetime(p.startsAt) : null,
      p.endsAt ? toSqliteDatetime(p.endsAt) : null,
      email,
      email
    )
    .run();

  if (p.rules?.length) await writeRules(c.env, id, p.rules);

  return c.json({ id }, 201);
});

app.put("/api/ads/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM ads WHERE id = ?").bind(id).first<AdRow>();
  if (!existing) return c.json({ error: "not found" }, 404);

  const p = await c.req.json<AdPayload>();
  const err = validateAdPayload(p);
  if (err) return c.json({ error: err }, 400);

  const email = actorEmail(c);
  const newMediaKey = p.mediaKey ?? null;
  const oldMediaKey = existing.media_key;

  await c.env.DB.prepare(
    `UPDATE ads SET
      name=?, type=?, media_key=?, media_mime=?, media_bytes=?, title=?, content=?,
      click_action=?, click_url=?, postmessage_payload=?, duration_mode=?, duration_seconds=?,
      skip_after_seconds=?, weight=?, priority=?, frequency_cap_per_day=?, restricted_to_sites=?,
      enabled=?, starts_at=?, ends_at=?, updated_by=?, updated_at=datetime('now')
    WHERE id=?`
  )
    .bind(
      p.name.trim(),
      p.type,
      newMediaKey,
      p.mediaMime ?? null,
      p.mediaBytes ?? null,
      p.title ?? null,
      p.content ?? null,
      p.clickAction,
      p.clickUrl ?? null,
      p.postmessagePayload ? JSON.stringify(p.postmessagePayload) : null,
      p.durationMode,
      p.durationSeconds ?? null,
      p.skipAfterSeconds ?? null,
      p.weight ?? 100,
      p.priority ?? 0,
      p.frequencyCapPerDay ?? null,
      p.restrictedToSites ? 1 : 0,
      p.enabled === false ? 0 : 1,
      p.startsAt ? toSqliteDatetime(p.startsAt) : null,
      p.endsAt ? toSqliteDatetime(p.endsAt) : null,
      email,
      id
    )
    .run();

  if (oldMediaKey && oldMediaKey !== newMediaKey) {
    c.executionCtx.waitUntil(c.env.MEDIA.delete(oldMediaKey));
  }

  if (p.rules) await writeRules(c.env, id, p.rules);

  return c.json({ ok: true });
});

app.delete("/api/ads/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT media_key FROM ads WHERE id = ?").bind(id).first<{ media_key: string | null }>();
  if (!existing) return c.json({ error: "not found" }, 404);

  await c.env.DB.prepare("DELETE FROM ads WHERE id = ?").bind(id).run();
  if (existing.media_key) c.executionCtx.waitUntil(c.env.MEDIA.delete(existing.media_key));

  return c.json({ ok: true });
});

async function writeRules(env: Env, adId: string, rules: { siteId: string; weightOverride: number | null }[]) {
  await env.DB.prepare("DELETE FROM ad_site_rules WHERE ad_id = ?").bind(adId).run();
  for (const r of rules) {
    if (r.weightOverride === null) continue; // "inherit" = no row needed
    await env.DB.prepare(
      "INSERT INTO ad_site_rules (ad_id, site_id, weight_override) VALUES (?, ?, ?)"
    )
      .bind(adId, r.siteId, r.weightOverride)
      .run();
  }
}

// ---------- Upload ----------

app.post("/api/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "Keine Datei übermittelt." }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: `Datei zu groß (max. ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).` }, 400);

  const allowedMime = /^image\/(png|jpeg|webp|gif|svg\+xml)$|^video\/(mp4|webm)$/;
  if (!allowedMime.test(file.type)) return c.json({ error: `Dateityp ${file.type} nicht erlaubt.` }, 400);

  const key = newId("media");
  const buf = await file.arrayBuffer();
  await c.env.MEDIA.put(key, buf, { metadata: { mime: file.type } });

  return c.json({ mediaKey: key, mediaMime: file.type, mediaBytes: buf.byteLength });
});

// ---------- Sites ----------

app.get("/api/sites", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM sites ORDER BY created_at DESC").all<SiteRow>();
  return c.json(results.map(serializeSite));
});

app.post("/api/sites", async (c) => {
  const p = await c.req.json<{ name: string; domain?: string; buttonText?: string; accentColor?: string }>();
  if (!p.name?.trim()) return c.json({ error: "Name ist erforderlich." }, 400);

  const id = newId("site");
  const siteKey = newSiteKey();
  const email = actorEmail(c);

  await c.env.DB.prepare(
    "INSERT INTO sites (id, name, domain, site_key, button_text, accent_color, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?)"
  )
    .bind(id, p.name.trim(), p.domain ?? null, siteKey, p.buttonText ?? null, p.accentColor ?? null, email, email)
    .run();

  return c.json({ id, siteKey }, 201);
});

app.put("/api/sites/:id", async (c) => {
  const id = c.req.param("id");
  const p = await c.req.json<{ name: string; domain?: string; buttonText?: string; accentColor?: string; enabled?: boolean }>();
  if (!p.name?.trim()) return c.json({ error: "Name ist erforderlich." }, 400);

  const result = await c.env.DB.prepare(
    "UPDATE sites SET name=?, domain=?, button_text=?, accent_color=?, enabled=?, updated_by=?, updated_at=datetime('now') WHERE id=?"
  )
    .bind(p.name.trim(), p.domain ?? null, p.buttonText ?? null, p.accentColor ?? null, p.enabled === false ? 0 : 1, actorEmail(c), id)
    .run();

  if (result.meta.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

app.delete("/api/sites/:id", async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(c.req.param("id")).run();
  if (result.meta.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ---------- Settings ----------

app.get("/api/settings", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const obj: Record<string, string> = {};
  for (const r of results) obj[r.key] = r.value;
  return c.json(obj);
});

app.put("/api/settings", async (c) => {
  const p = await c.req.json<Record<string, string>>();
  for (const [key, value] of Object.entries(p)) {
    await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(key, String(value))
      .run();
  }
  return c.json({ ok: true });
});

// ---------- Stats ----------

app.get("/api/stats", async (c) => {
  const from = c.req.query("from") ? toSqliteDatetime(c.req.query("from")!) : sqliteDaysAgo(30);
  const to = c.req.query("to") ? toSqliteDatetime(c.req.query("to")!) : sqliteDaysAgo(0);
  const siteId = c.req.query("siteId") || null;
  const adId = c.req.query("adId") || null;

  const extraWhere: string[] = [];
  const extraBind: unknown[] = [];
  if (siteId) {
    extraWhere.push("site_id = ?");
    extraBind.push(siteId);
  }
  if (adId) {
    extraWhere.push("ad_id = ?");
    extraBind.push(adId);
  }
  const extraSql = extraWhere.length ? ` AND ${extraWhere.join(" AND ")}` : "";

  const totalsQuery = c.env.DB.prepare(
    `SELECT event_type, COUNT(*) as c FROM events WHERE created_at BETWEEN ? AND ?${extraSql} GROUP BY event_type`
  ).bind(from, to, ...extraBind);

  const timeseriesQuery = c.env.DB.prepare(
    `SELECT date(created_at) as day, event_type, COUNT(*) as c FROM events
     WHERE created_at BETWEEN ? AND ?${extraSql} GROUP BY day, event_type ORDER BY day`
  ).bind(from, to, ...extraBind);

  const perAdQuery = c.env.DB.prepare(
    `SELECT a.id, a.name, a.type,
        SUM(CASE WHEN e.event_type='impression' THEN 1 ELSE 0 END) as impressions,
        SUM(CASE WHEN e.event_type='click' THEN 1 ELSE 0 END) as clicks,
        SUM(CASE WHEN e.event_type='complete' THEN 1 ELSE 0 END) as completes,
        SUM(CASE WHEN e.event_type='skip' THEN 1 ELSE 0 END) as skips
     FROM ads a
     LEFT JOIN events e ON e.ad_id = a.id AND e.created_at BETWEEN ? AND ?${extraWhere.length ? ` AND ${extraWhere.map((w) => "e." + w).join(" AND ")}` : ""}
     GROUP BY a.id ORDER BY impressions DESC`
  ).bind(from, to, ...extraBind);

  const perSiteQuery = c.env.DB.prepare(
    `SELECT s.id, s.name,
        SUM(CASE WHEN e.event_type='impression' THEN 1 ELSE 0 END) as impressions,
        SUM(CASE WHEN e.event_type='click' THEN 1 ELSE 0 END) as clicks,
        SUM(CASE WHEN e.event_type='complete' THEN 1 ELSE 0 END) as completes
     FROM sites s
     LEFT JOIN events e ON e.site_id = s.id AND e.created_at BETWEEN ? AND ?${adId ? " AND e.ad_id = ?" : ""}
     GROUP BY s.id ORDER BY impressions DESC`
  ).bind(from, to, ...(adId ? [adId] : []));

  const [totals, timeseries, perAd, perSite] = await Promise.all([
    totalsQuery.all<{ event_type: string; c: number }>(),
    timeseriesQuery.all<{ day: string; event_type: string; c: number }>(),
    perAdQuery.all(),
    perSiteQuery.all(),
  ]);

  return c.json({
    range: { from, to },
    totals: totals.results,
    timeseries: timeseries.results,
    perAd: perAd.results,
    perSite: perSite.results,
  });
});

app.post("/api/events/purge", async (c) => {
  const { olderThanDays } = await c.req.json<{ olderThanDays: number }>();
  if (!olderThanDays || olderThanDays < 1) return c.json({ error: "olderThanDays >= 1 erforderlich" }, 400);
  const result = await c.env.DB.prepare(
    `DELETE FROM events WHERE created_at < datetime('now', ?)`
  )
    .bind(`-${Math.floor(olderThanDays)} days`)
    .run();
  return c.json({ ok: true, deleted: result.meta.changes });
});

function sqliteDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export default app;

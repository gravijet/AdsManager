import { Hono } from "hono";
import type { AdRow, AdStatus, CampaignRow, Env, SiteRow } from "../types";
import { requireAccessIdentity, actorEmail } from "../auth";
import { newId, newSiteKey, serializeAd, serializeCampaign, serializeSite } from "../util";
import { toSqliteDatetime } from "../selection";

const app = new Hono<{ Bindings: Env }>();
app.use("*", requireAccessIdentity);

const SIMPLE_UPLOAD_MAX = 15 * 1024 * 1024; // above this the client switches to chunked multipart
const DEFAULT_MAX_UPLOAD_MB = 2048; // 2GB — comfortably covers the "1GB video" case
const ALLOWED_MEDIA_MIME = /^image\/(png|jpeg|webp|gif|svg\+xml)$|^video\/(mp4|webm)$/;
const AD_STATUSES: AdStatus[] = ["draft", "active", "paused", "archived"];
const DEVICE_TYPES = ["desktop", "mobile", "tablet"];

async function getMaxUploadBytes(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'max_upload_mb'").first<{ value: string }>();
  const mb = Number(row?.value) || DEFAULT_MAX_UPLOAD_MB;
  return mb * 1024 * 1024;
}

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
  status?: AdStatus;
  campaignId?: string | null;
  allowedCountries?: string[];
  blockedCountries?: string[];
  allowedDevices?: string[];
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
  if (p.status && !AD_STATUSES.includes(p.status)) return "Ungültiger Status.";
  if (p.allowedDevices?.some((d) => !DEVICE_TYPES.includes(d))) return "Ungültiger Gerätetyp.";
  return null;
}

function toCsv(values: string[] | undefined): string | null {
  if (!values?.length) return null;
  return values.map((v) => v.trim().toUpperCase()).filter(Boolean).join(",");
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
      status, campaign_id, allowed_countries, blocked_countries, allowed_devices,
      starts_at, ends_at, created_by, updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
      p.status ?? "active",
      p.campaignId || null,
      toCsv(p.allowedCountries),
      toCsv(p.blockedCountries),
      p.allowedDevices?.length ? p.allowedDevices.join(",") : null,
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
      status=?, campaign_id=?, allowed_countries=?, blocked_countries=?, allowed_devices=?,
      starts_at=?, ends_at=?, updated_by=?, updated_at=datetime('now')
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
      p.status ?? "active",
      p.campaignId || null,
      toCsv(p.allowedCountries),
      toCsv(p.blockedCountries),
      p.allowedDevices?.length ? p.allowedDevices.join(",") : null,
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

app.post("/api/ads/:id/duplicate", async (c) => {
  const id = c.req.param("id");
  const ad = await c.env.DB.prepare("SELECT * FROM ads WHERE id = ?").bind(id).first<AdRow>();
  if (!ad) return c.json({ error: "not found" }, 404);

  const newIdValue = newId("ad");
  const email = actorEmail(c);
  await c.env.DB.prepare(
    `INSERT INTO ads (
      id, name, type, media_key, media_mime, media_bytes, title, content,
      click_action, click_url, postmessage_payload, duration_mode, duration_seconds,
      skip_after_seconds, weight, priority, frequency_cap_per_day, restricted_to_sites,
      status, campaign_id, allowed_countries, blocked_countries, allowed_devices,
      starts_at, ends_at, created_by, updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      newIdValue,
      `${ad.name} (Kopie)`,
      ad.type,
      ad.media_key,
      ad.media_mime,
      ad.media_bytes,
      ad.title,
      ad.content,
      ad.click_action,
      ad.click_url,
      ad.postmessage_payload,
      ad.duration_mode,
      ad.duration_seconds,
      ad.skip_after_seconds,
      ad.weight,
      ad.priority,
      ad.frequency_cap_per_day,
      ad.restricted_to_sites,
      "draft",
      ad.campaign_id,
      ad.allowed_countries,
      ad.blocked_countries,
      ad.allowed_devices,
      ad.starts_at,
      ad.ends_at,
      email,
      email
    )
    .run();

  const { results: rules } = await c.env.DB.prepare("SELECT site_id, weight_override FROM ad_site_rules WHERE ad_id = ?")
    .bind(id)
    .all<{ site_id: string; weight_override: number | null }>();
  for (const r of rules) {
    await c.env.DB.prepare("INSERT INTO ad_site_rules (ad_id, site_id, weight_override) VALUES (?, ?, ?)")
      .bind(newIdValue, r.site_id, r.weight_override)
      .run();
  }

  return c.json({ id: newIdValue }, 201);
});

app.post("/api/ads/bulk", async (c) => {
  const { ids, action } = await c.req.json<{ ids: string[]; action: string }>();
  if (!ids?.length) return c.json({ error: "Keine Anzeigen ausgewählt." }, 400);
  const placeholders = ids.map(() => "?").join(",");
  const email = actorEmail(c);

  if (action === "delete") {
    const { results } = await c.env.DB.prepare(`SELECT media_key FROM ads WHERE id IN (${placeholders})`).bind(...ids).all<{ media_key: string | null }>();
    await c.env.DB.prepare(`DELETE FROM ads WHERE id IN (${placeholders})`).bind(...ids).run();
    for (const r of results) if (r.media_key) c.executionCtx.waitUntil(c.env.MEDIA.delete(r.media_key));
    return c.json({ ok: true, count: results.length });
  }

  const statusMap: Record<string, AdStatus> = { activate: "active", pause: "paused", archive: "archived", draft: "draft" };
  const status = statusMap[action];
  if (!status) return c.json({ error: "Unbekannte Aktion." }, 400);

  const result = await c.env.DB.prepare(`UPDATE ads SET status=?, updated_by=?, updated_at=datetime('now') WHERE id IN (${placeholders})`)
    .bind(status, email, ...ids)
    .run();
  return c.json({ ok: true, count: result.meta.changes });
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

// ---------- Campaigns ----------

app.get("/api/campaigns", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all<CampaignRow>();
  const { results: spend } = await c.env.DB.prepare(
    `SELECT a.campaign_id as campaign_id,
        SUM(CASE WHEN e.event_type='impression' THEN 1 ELSE 0 END) as impressions,
        SUM(CASE WHEN e.event_type='click' THEN 1 ELSE 0 END) as clicks,
        SUM(CASE WHEN e.event_type='complete' THEN 1 ELSE 0 END) as completes
     FROM ads a LEFT JOIN events e ON e.ad_id = a.id
     WHERE a.campaign_id IS NOT NULL
     GROUP BY a.campaign_id`
  ).all<{ campaign_id: string; impressions: number; clicks: number; completes: number }>();
  const spendMap = new Map(spend.map((s) => [s.campaign_id, s]));

  return c.json(
    results.map((cRow) => ({
      ...serializeCampaign(cRow),
      impressions: spendMap.get(cRow.id)?.impressions ?? 0,
      clicks: spendMap.get(cRow.id)?.clicks ?? 0,
      completes: spendMap.get(cRow.id)?.completes ?? 0,
    }))
  );
});

interface CampaignPayload {
  name: string;
  status?: CampaignRow["status"];
  impressionCap?: number | null;
  clickCap?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

app.post("/api/campaigns", async (c) => {
  const p = await c.req.json<CampaignPayload>();
  if (!p.name?.trim()) return c.json({ error: "Name ist erforderlich." }, 400);
  const id = newId("camp");
  const email = actorEmail(c);
  await c.env.DB.prepare(
    "INSERT INTO campaigns (id, name, status, impression_cap, click_cap, starts_at, ends_at, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, p.name.trim(), p.status ?? "active", p.impressionCap ?? null, p.clickCap ?? null, p.startsAt ? toSqliteDatetime(p.startsAt) : null, p.endsAt ? toSqliteDatetime(p.endsAt) : null, email, email)
    .run();
  return c.json({ id }, 201);
});

app.put("/api/campaigns/:id", async (c) => {
  const id = c.req.param("id");
  const p = await c.req.json<CampaignPayload>();
  if (!p.name?.trim()) return c.json({ error: "Name ist erforderlich." }, 400);
  const result = await c.env.DB.prepare(
    "UPDATE campaigns SET name=?, status=?, impression_cap=?, click_cap=?, starts_at=?, ends_at=?, updated_by=?, updated_at=datetime('now') WHERE id=?"
  )
    .bind(p.name.trim(), p.status ?? "active", p.impressionCap ?? null, p.clickCap ?? null, p.startsAt ? toSqliteDatetime(p.startsAt) : null, p.endsAt ? toSqliteDatetime(p.endsAt) : null, actorEmail(c), id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

app.delete("/api/campaigns/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE ads SET campaign_id = NULL WHERE campaign_id = ?").bind(id).run();
  const result = await c.env.DB.prepare("DELETE FROM campaigns WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ---------- Upload (simple, small files) ----------

app.post("/api/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "Keine Datei übermittelt." }, 400);
  if (file.size > SIMPLE_UPLOAD_MAX) return c.json({ error: "Datei zu groß für Direkt-Upload." }, 400);

  const maxBytes = await getMaxUploadBytes(c.env);
  if (file.size > maxBytes) return c.json({ error: `Datei zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).` }, 400);

  const allowedMime = ALLOWED_MEDIA_MIME;
  if (!allowedMime.test(file.type)) return c.json({ error: `Dateityp ${file.type} nicht erlaubt.` }, 400);

  const key = newId("media");
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });

  return c.json({ mediaKey: key, mediaMime: file.type, mediaBytes: file.size });
});

// ---------- Upload (chunked multipart — for large videos) ----------

app.post("/api/upload/init", async (c) => {
  const { mime, size } = await c.req.json<{ filename?: string; mime: string; size: number }>();
  if (!ALLOWED_MEDIA_MIME.test(mime)) return c.json({ error: `Dateityp ${mime} nicht erlaubt.` }, 400);
  if (!size || size <= 0) return c.json({ error: "Ungültige Dateigröße." }, 400);

  const maxBytes = await getMaxUploadBytes(c.env);
  if (size > maxBytes) return c.json({ error: `Datei zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).` }, 400);

  const key = newId("media");
  const upload = await c.env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: mime } });
  return c.json({ key, uploadId: upload.uploadId });
});

app.put("/api/upload/part", async (c) => {
  const key = c.req.query("key");
  const uploadId = c.req.query("uploadId");
  const partNumber = Number(c.req.query("partNumber"));
  if (!key || !uploadId || !partNumber) return c.json({ error: "Fehlende Parameter." }, 400);

  const body = await c.req.arrayBuffer();
  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, body);
  return c.json({ partNumber, etag: part.etag });
});

app.post("/api/upload/complete", async (c) => {
  const { key, uploadId, parts, mime, size } = await c.req.json<{
    key: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
    mime: string;
    size: number;
  }>();
  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  await upload.complete(parts);
  return c.json({ mediaKey: key, mediaMime: mime, mediaBytes: size });
});

app.post("/api/upload/abort", async (c) => {
  const { key, uploadId } = await c.req.json<{ key: string; uploadId: string }>();
  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  await upload.abort().catch(() => {});
  return c.json({ ok: true });
});

// ---------- Sites ----------

app.get("/api/sites", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM sites ORDER BY created_at DESC").all<SiteRow>();
  return c.json(results.map(serializeSite));
});

app.post("/api/sites", async (c) => {
  const p = await c.req.json<{ name: string; domain?: string; buttonText?: string; accentColor?: string; webhookUrl?: string }>();
  if (!p.name?.trim()) return c.json({ error: "Name ist erforderlich." }, 400);

  const id = newId("site");
  const siteKey = newSiteKey();
  const email = actorEmail(c);

  await c.env.DB.prepare(
    "INSERT INTO sites (id, name, domain, site_key, button_text, accent_color, webhook_url, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?)"
  )
    .bind(id, p.name.trim(), p.domain ?? null, siteKey, p.buttonText ?? null, p.accentColor ?? null, p.webhookUrl ?? null, email, email)
    .run();

  return c.json({ id, siteKey }, 201);
});

app.put("/api/sites/:id", async (c) => {
  const id = c.req.param("id");
  const p = await c.req.json<{ name: string; domain?: string; buttonText?: string; accentColor?: string; webhookUrl?: string; enabled?: boolean }>();
  if (!p.name?.trim()) return c.json({ error: "Name ist erforderlich." }, 400);

  const result = await c.env.DB.prepare(
    "UPDATE sites SET name=?, domain=?, button_text=?, accent_color=?, webhook_url=?, enabled=?, updated_by=?, updated_at=datetime('now') WHERE id=?"
  )
    .bind(p.name.trim(), p.domain ?? null, p.buttonText ?? null, p.accentColor ?? null, p.webhookUrl ?? null, p.enabled === false ? 0 : 1, actorEmail(c), id)
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

  const perCountryQuery = c.env.DB.prepare(
    `SELECT COALESCE(country, 'Unbekannt') as country, COUNT(*) as c FROM events
     WHERE event_type = 'impression' AND created_at BETWEEN ? AND ?${extraSql}
     GROUP BY country ORDER BY c DESC LIMIT 12`
  ).bind(from, to, ...extraBind);

  const perDeviceQuery = c.env.DB.prepare(
    `SELECT COALESCE(device_type, 'Unbekannt') as device_type, COUNT(*) as c FROM events
     WHERE event_type = 'impression' AND created_at BETWEEN ? AND ?${extraSql}
     GROUP BY device_type ORDER BY c DESC`
  ).bind(from, to, ...extraBind);

  const rewardsQuery = c.env.DB.prepare(
    `SELECT COUNT(*) as c FROM reward_tokens WHERE consumed_at IS NOT NULL AND consumed_at BETWEEN ? AND ?`
  ).bind(from, to);

  const [totals, timeseries, perAd, perSite, perCountry, perDevice, rewards] = await Promise.all([
    totalsQuery.all<{ event_type: string; c: number }>(),
    timeseriesQuery.all<{ day: string; event_type: string; c: number }>(),
    perAdQuery.all(),
    perSiteQuery.all(),
    perCountryQuery.all<{ country: string; c: number }>(),
    perDeviceQuery.all<{ device_type: string; c: number }>(),
    rewardsQuery.first<{ c: number }>(),
  ]);

  return c.json({
    range: { from, to },
    totals: totals.results,
    timeseries: timeseries.results,
    perAd: perAd.results,
    perSite: perSite.results,
    perCountry: perCountry.results,
    perDevice: perDevice.results,
    verifiedRewards: rewards?.c ?? 0,
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

import { Hono } from "hono";
import type { AdRow, Env, EventType, SiteRow } from "../types";
import { selectAd } from "../selection";
import { serializeAd } from "../util";

const app = new Hono<{ Bindings: Env }>();

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function getSite(env: Env, siteKey: string | null): Promise<SiteRow | null> {
  if (!siteKey) return null;
  return env.DB.prepare("SELECT * FROM sites WHERE site_key = ? AND enabled = 1").bind(siteKey).first<SiteRow>();
}

// Config the embed page needs before the viewer has clicked anything.
app.get("/api/config", async (c) => {
  const env = c.env;
  const siteKey = c.req.query("site") ?? null;
  const site = await getSite(env, siteKey);

  const [globalButton, globalAccent, fallbackBehavior, fallbackMessage] = await Promise.all([
    getSetting(env, "button_text"),
    getSetting(env, "accent_color"),
    getSetting(env, "fallback_behavior"),
    getSetting(env, "fallback_message"),
  ]);

  return c.json({
    buttonText: site?.button_text || globalButton || "Belohnung beanspruchen",
    accentColor: site?.accent_color || globalAccent || "#6d5bff",
    fallbackBehavior: fallbackBehavior || "grant",
    fallbackMessage: fallbackMessage || "Danke!",
    siteRecognized: !!site,
  });
});

app.get("/api/ad", async (c) => {
  const env = c.env;
  const siteKey = c.req.query("site") ?? null;
  const viewerId = c.req.query("vid") ?? null;
  const previewId = c.req.query("preview") ?? null;

  if (previewId) {
    const ad = await env.DB.prepare("SELECT * FROM ads WHERE id = ?").bind(previewId).first<AdRow>();
    if (!ad) return c.json({ ok: true, ad: null });
    return c.json({ ok: true, ad: cleanAd(ad) });
  }

  const result = await selectAd({ env, siteKey, viewerId });
  if (!result) {
    return c.json({ ok: true, ad: null });
  }

  const { ad, site } = result;

  await env.DB.prepare(
    "INSERT INTO events (ad_id, site_id, event_type, viewer_id) VALUES (?, ?, 'impression', ?)"
  )
    .bind(ad.id, site?.id ?? null, viewerId)
    .run();

  return c.json({ ok: true, ad: cleanAd(ad) });
});

function cleanAd(ad: AdRow) {
  const { createdBy: _createdBy, updatedBy: _updatedBy, ...rest } = serializeAd(ad);
  // Never leak internal bookkeeping fields (who created/edited the ad) to the embed page.
  return rest;
}

const VALID_CLIENT_EVENTS: EventType[] = ["click", "complete", "skip"];

app.post("/api/events", async (c) => {
  const env = c.env;
  const body = await c.req.json<{ adId?: string; site?: string; viewerId?: string; type?: string }>().catch(() => null);
  if (!body || !body.type || !VALID_CLIENT_EVENTS.includes(body.type as EventType)) {
    return c.json({ error: "invalid event" }, 400);
  }

  const site = await getSite(env, body.site ?? null);

  await env.DB.prepare(
    "INSERT INTO events (ad_id, site_id, event_type, viewer_id) VALUES (?, ?, ?, ?)"
  )
    .bind(body.adId ?? null, site?.id ?? null, body.type, body.viewerId ?? null)
    .run();

  return c.json({ ok: true });
});

app.get("/media/:key", async (c) => {
  const key = c.req.param("key");
  const obj = await c.env.MEDIA.getWithMetadata<{ mime: string }>(key, "arrayBuffer");
  if (!obj.value) return c.notFound();

  return new Response(obj.value, {
    headers: {
      "Content-Type": obj.metadata?.mime || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

export default app;

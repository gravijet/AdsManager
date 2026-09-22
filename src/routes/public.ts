import { Hono } from "hono";
import type { AdRow, Env, EventType, RewardTokenRow, SiteRow } from "../types";
import { selectAd } from "../selection";
import { newRewardToken, parseDeviceType, serializeAd } from "../util";

const app = new Hono<{ Bindings: Env }>();

const REWARD_TOKEN_TTL_MINUTES = 10;

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
  const excludeAdId = c.req.query("last") ?? null;

  if (previewId) {
    const ad = await env.DB.prepare("SELECT * FROM ads WHERE id = ?").bind(previewId).first<AdRow>();
    if (!ad) return c.json({ ok: true, ad: null });
    return c.json({ ok: true, ad: cleanAd(ad) });
  }

  const country = (c.req.raw.cf?.country as string | undefined) ?? null;
  const deviceType = parseDeviceType(c.req.header("User-Agent") ?? null);

  const result = await selectAd({ env, siteKey, viewerId, country, deviceType, excludeAdId });
  if (!result) {
    return c.json({ ok: true, ad: null });
  }

  const { ad, site } = result;

  await env.DB.prepare(
    "INSERT INTO events (ad_id, site_id, event_type, viewer_id, country, device_type) VALUES (?, ?, 'impression', ?, ?, ?)"
  )
    .bind(ad.id, site?.id ?? null, viewerId, country, deviceType)
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
  const country = (c.req.raw.cf?.country as string | undefined) ?? null;
  const deviceType = parseDeviceType(c.req.header("User-Agent") ?? null);

  await env.DB.prepare(
    "INSERT INTO events (ad_id, site_id, event_type, viewer_id, country, device_type) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(body.adId ?? null, site?.id ?? null, body.type, body.viewerId ?? null, country, deviceType)
    .run();

  if (body.type !== "complete") return c.json({ ok: true });

  // A completion just happened — issue a single-use token the embedding
  // site's OWN BACKEND can redeem (via /api/verify or the site's webhook) to
  // confirm server-to-server that the reward is legitimate, rather than
  // trusting a postMessage the viewer could forge from devtools.
  const token = newRewardToken();
  const expiresAt = new Date(Date.now() + REWARD_TOKEN_TTL_MINUTES * 60_000).toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare(
    "INSERT INTO reward_tokens (token, ad_id, site_id, viewer_id, expires_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(token, body.adId ?? null, site?.id ?? null, body.viewerId ?? null, expiresAt)
    .run();

  if (site?.webhook_url) {
    c.executionCtx.waitUntil(
      fetch(site.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "reward",
          token,
          adId: body.adId ?? null,
          siteId: site.id,
          viewerId: body.viewerId ?? null,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {
        // Best-effort, fire-and-forget — the site should treat /api/verify as
        // the source of truth if it needs a delivery guarantee.
      })
    );
  }

  return c.json({ ok: true, rewardToken: token });
});

// Meant to be called SERVER-TO-SERVER by the embedding site's own backend —
// never from the viewer's browser — to confirm a reward is genuine before
// crediting it. Single-use: the second call for the same token fails.
app.get("/api/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ valid: false, reason: "missing_token" }, 400);

  const row = await c.env.DB.prepare("SELECT * FROM reward_tokens WHERE token = ?").bind(token).first<RewardTokenRow>();
  if (!row) return c.json({ valid: false, reason: "not_found" }, 404);
  if (row.consumed_at) return c.json({ valid: false, reason: "already_consumed" }, 409);
  if (new Date(row.expires_at + "Z").getTime() < Date.now()) return c.json({ valid: false, reason: "expired" }, 410);

  await c.env.DB.prepare("UPDATE reward_tokens SET consumed_at = datetime('now') WHERE token = ?").bind(token).run();

  return c.json({
    valid: true,
    adId: row.ad_id,
    siteId: row.site_id,
    viewerId: row.viewer_id,
    issuedAt: row.created_at,
  });
});

app.get("/media/:key", async (c) => {
  const key = c.req.param("key");
  const rangeHeader = c.req.header("Range");

  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    const head = await c.env.MEDIA.head(key);
    if (!head) return c.notFound();
    const totalSize = head.size;

    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), totalSize - 1) : totalSize - 1;
      if (start >= totalSize || start > end) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${totalSize}` } });
      }
      const obj = await c.env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) return c.notFound();
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      headers.set("Content-Length", String(end - start + 1));
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(obj.body, { status: 206, headers });
    }
  }

  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(obj.size));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

export default app;

import type { AdRow, CampaignRow, DeviceType, SiteRow } from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function newSiteKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function newRewardToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Deliberately simple heuristic (no dependency) — good enough to bucket
// traffic for targeting/stats, not meant to be a precise device fingerprint.
export function parseDeviceType(userAgent: string | null): DeviceType {
  if (!userAgent) return "desktop";
  const ua = userAgent.toLowerCase();
  if (/ipad|android(?!.*mobile)|tablet/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/.test(ua)) return "mobile";
  return "desktop";
}

export function parseCsvList(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function serializeAd(ad: AdRow) {
  return {
    id: ad.id,
    name: ad.name,
    type: ad.type,
    mediaKey: ad.media_key,
    mediaMime: ad.media_mime,
    mediaBytes: ad.media_bytes,
    title: ad.title,
    content: ad.content,
    clickAction: ad.click_action,
    clickUrl: ad.click_url,
    postmessagePayload: ad.postmessage_payload ? JSON.parse(ad.postmessage_payload) : null,
    durationMode: ad.duration_mode,
    durationSeconds: ad.duration_seconds,
    skipAfterSeconds: ad.skip_after_seconds,
    weight: ad.weight,
    priority: ad.priority,
    frequencyCapPerDay: ad.frequency_cap_per_day,
    restrictedToSites: !!ad.restricted_to_sites,
    status: ad.status,
    campaignId: ad.campaign_id,
    allowedCountries: parseCsvList(ad.allowed_countries),
    blockedCountries: parseCsvList(ad.blocked_countries),
    allowedDevices: parseCsvList(ad.allowed_devices),
    startsAt: ad.starts_at,
    endsAt: ad.ends_at,
    createdBy: ad.created_by,
    updatedBy: ad.updated_by,
    createdAt: ad.created_at,
    updatedAt: ad.updated_at,
  };
}

export function serializeSite(site: SiteRow) {
  return {
    id: site.id,
    name: site.name,
    domain: site.domain,
    siteKey: site.site_key,
    enabled: !!site.enabled,
    buttonText: site.button_text,
    accentColor: site.accent_color,
    webhookUrl: site.webhook_url,
    createdBy: site.created_by,
    updatedBy: site.updated_by,
    createdAt: site.created_at,
    updatedAt: site.updated_at,
  };
}

export function serializeCampaign(c: CampaignRow) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    impressionCap: c.impression_cap,
    clickCap: c.click_cap,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    createdBy: c.created_by,
    updatedBy: c.updated_by,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

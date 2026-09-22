import type { AdRow, SiteRow } from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function newSiteKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
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
    enabled: !!ad.enabled,
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
    createdBy: site.created_by,
    updatedBy: site.updated_by,
    createdAt: site.created_at,
    updatedAt: site.updated_at,
  };
}

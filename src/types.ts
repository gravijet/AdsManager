export type AdType = "image" | "video" | "text" | "link" | "html";
export type ClickAction = "none" | "open_url" | "postmessage" | "redirect_top";
export type DurationMode = "fixed" | "until_finished" | "manual";
export type EventType = "impression" | "click" | "complete" | "skip";
export type AdStatus = "draft" | "active" | "paused" | "archived";
export type CampaignStatus = "active" | "paused" | "archived";
export type DeviceType = "desktop" | "mobile" | "tablet";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
}

export interface AdRow {
  id: string;
  name: string;
  type: AdType;
  media_key: string | null;
  media_mime: string | null;
  media_bytes: number | null;
  title: string | null;
  content: string | null;
  click_action: ClickAction;
  click_url: string | null;
  postmessage_payload: string | null;
  duration_mode: DurationMode;
  duration_seconds: number | null;
  skip_after_seconds: number | null;
  weight: number;
  priority: number;
  frequency_cap_per_day: number | null;
  restricted_to_sites: number;
  status: AdStatus;
  campaign_id: string | null;
  allowed_countries: string | null;
  blocked_countries: string | null;
  allowed_devices: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteRow {
  id: string;
  name: string;
  domain: string | null;
  site_key: string;
  enabled: number;
  button_text: string | null;
  accent_color: string | null;
  webhook_url: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdSiteRuleRow {
  ad_id: string;
  site_id: string;
  weight_override: number | null;
}

export interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  impression_cap: number | null;
  click_cap: number | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RewardTokenRow {
  token: string;
  ad_id: string | null;
  site_id: string | null;
  viewer_id: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

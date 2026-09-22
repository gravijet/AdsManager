export type AdType = "image" | "video" | "text" | "link" | "html";
export type ClickAction = "none" | "open_url" | "postmessage" | "redirect_top";
export type DurationMode = "fixed" | "until_finished" | "manual";
export type EventType = "impression" | "click" | "complete" | "skip";

export interface Env {
  DB: D1Database;
  MEDIA: KVNamespace;
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
  enabled: number;
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

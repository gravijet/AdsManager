-- Sites that embed the widget
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  site_key TEXT UNIQUE NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  button_text TEXT,
  accent_color TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ad creatives
CREATE TABLE ads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('image','video','text','link','html')),
  media_key TEXT,
  media_mime TEXT,
  media_bytes INTEGER,
  title TEXT,
  content TEXT,
  click_action TEXT NOT NULL DEFAULT 'none' CHECK(click_action IN ('none','open_url','postmessage','redirect_top')),
  click_url TEXT,
  postmessage_payload TEXT,
  duration_mode TEXT NOT NULL DEFAULT 'fixed' CHECK(duration_mode IN ('fixed','until_finished','manual')),
  duration_seconds INTEGER,
  skip_after_seconds INTEGER,
  weight INTEGER NOT NULL DEFAULT 100,
  priority INTEGER NOT NULL DEFAULT 0,
  frequency_cap_per_day INTEGER,
  restricted_to_sites INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-site overrides of an ad's weight (NULL = inherit, 0 = excluded on that site)
CREATE TABLE ad_site_rules (
  ad_id TEXT NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  weight_override INTEGER,
  PRIMARY KEY (ad_id, site_id)
);

-- Impression / click / completion / skip log
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id TEXT,
  site_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('impression','click','complete','skip')),
  viewer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_ad ON events(ad_id);
CREATE INDEX idx_events_site ON events(site_id);
CREATE INDEX idx_events_created ON events(created_at);
CREATE INDEX idx_events_type_created ON events(event_type, created_at);
CREATE INDEX idx_ad_site_rules_site ON ad_site_rules(site_id);
CREATE INDEX idx_ads_enabled ON ads(enabled);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('button_text', 'Belohnung beanspruchen'),
  ('accent_color', '#6d5bff'),
  ('fallback_behavior', 'grant'),
  ('fallback_message', 'Danke! Aktuell ist keine Werbung verfügbar.'),
  ('default_frequency_cap_per_day', '');

-- Campaigns group ads together with an optional impression/click budget.
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  impression_cap INTEGER,
  click_cap INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_campaigns_status ON campaigns(status);

-- Ads gain a lifecycle status (replaces the old boolean), campaign membership,
-- and geo/device targeting.
ALTER TABLE ads ADD COLUMN campaign_id TEXT;
ALTER TABLE ads ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
UPDATE ads SET status = CASE WHEN enabled = 1 THEN 'active' ELSE 'paused' END;
ALTER TABLE ads ADD COLUMN allowed_countries TEXT;
ALTER TABLE ads ADD COLUMN blocked_countries TEXT;
ALTER TABLE ads ADD COLUMN allowed_devices TEXT;
DROP INDEX idx_ads_enabled;
ALTER TABLE ads DROP COLUMN enabled;

CREATE INDEX idx_ads_campaign ON ads(campaign_id);
CREATE INDEX idx_ads_status ON ads(status);

-- Sites can register a server-to-server webhook for reward verification.
ALTER TABLE sites ADD COLUMN webhook_url TEXT;

-- Events record who/what for the new stats breakdowns.
ALTER TABLE events ADD COLUMN country TEXT;
ALTER TABLE events ADD COLUMN device_type TEXT;

-- Single-use, short-lived tokens an embedding site's OWN BACKEND can redeem
-- server-to-server to confirm a reward actually happened (prevents a viewer
-- from forging a postMessage from devtools to grant themselves a reward).
CREATE TABLE reward_tokens (
  token TEXT PRIMARY KEY,
  ad_id TEXT,
  site_id TEXT,
  viewer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX idx_reward_tokens_expires ON reward_tokens(expires_at);

INSERT INTO settings (key, value) VALUES ('max_upload_mb', '2048');

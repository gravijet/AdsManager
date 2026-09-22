import type { AdRow, CampaignRow, DeviceType, Env, SiteRow } from "./types";
import { parseCsvList } from "./util";

export function toSqliteDatetime(input: string): string {
  // Accepts "YYYY-MM-DDTHH:MM" (from <input type="datetime-local">) or a full ISO string.
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime: ${input}`);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

interface SelectParams {
  env: Env;
  siteKey: string | null;
  viewerId: string | null;
  country: string | null;
  deviceType: DeviceType;
  excludeAdId: string | null;
}

export interface SelectResult {
  ad: AdRow;
  site: SiteRow | null;
}

export async function selectAd({ env, siteKey, viewerId, country, deviceType, excludeAdId }: SelectParams): Promise<SelectResult | null> {
  let site: SiteRow | null = null;
  if (siteKey) {
    site = await env.DB.prepare(
      "SELECT * FROM sites WHERE site_key = ? AND enabled = 1"
    )
      .bind(siteKey)
      .first<SiteRow>();
  }

  const { results: candidates } = await env.DB.prepare(
    `SELECT * FROM ads
     WHERE status = 'active'
       AND (starts_at IS NULL OR starts_at <= datetime('now'))
       AND (ends_at IS NULL OR ends_at >= datetime('now'))`
  ).all<AdRow>();

  if (!candidates.length) return null;

  let rules = new Map<string, number | null>();
  if (site) {
    const { results } = await env.DB.prepare(
      "SELECT ad_id, weight_override FROM ad_site_rules WHERE site_id = ?"
    )
      .bind(site.id)
      .all<{ ad_id: string; weight_override: number | null }>();
    rules = new Map(results.map((r) => [r.ad_id, r.weight_override]));
  }

  let capCounts = new Map<string, number>();
  if (viewerId) {
    const { results } = await env.DB.prepare(
      `SELECT ad_id, COUNT(*) as c FROM events
       WHERE viewer_id = ? AND event_type = 'impression' AND created_at >= date('now')
       GROUP BY ad_id`
    )
      .bind(viewerId)
      .all<{ ad_id: string; c: number }>();
    capCounts = new Map(results.map((r) => [r.ad_id, r.c]));
  }

  // Campaigns: pull in status + spend for every campaign referenced by a
  // candidate ad so budget caps and paused/archived campaigns can exclude
  // their ads below. Skipped entirely when no candidate belongs to one.
  const campaignIds = [...new Set(candidates.map((a) => a.campaign_id).filter((id): id is string => !!id))];
  const campaigns = new Map<string, CampaignRow>();
  const campaignSpend = new Map<string, { impressions: number; clicks: number }>();
  if (campaignIds.length) {
    const placeholders = campaignIds.map(() => "?").join(",");
    const { results: campaignRows } = await env.DB.prepare(
      `SELECT * FROM campaigns WHERE id IN (${placeholders})`
    )
      .bind(...campaignIds)
      .all<CampaignRow>();
    for (const c of campaignRows) campaigns.set(c.id, c);

    const cappedIds = campaignRows.filter((c) => c.impression_cap != null || c.click_cap != null).map((c) => c.id);
    if (cappedIds.length) {
      const capPlaceholders = cappedIds.map(() => "?").join(",");
      const { results: spendRows } = await env.DB.prepare(
        `SELECT a.campaign_id as campaign_id,
            SUM(CASE WHEN e.event_type='impression' THEN 1 ELSE 0 END) as impressions,
            SUM(CASE WHEN e.event_type='click' THEN 1 ELSE 0 END) as clicks
         FROM events e JOIN ads a ON a.id = e.ad_id
         WHERE a.campaign_id IN (${capPlaceholders})
         GROUP BY a.campaign_id`
      )
        .bind(...cappedIds)
        .all<{ campaign_id: string; impressions: number; clicks: number }>();
      for (const r of spendRows) campaignSpend.set(r.campaign_id, { impressions: r.impressions, clicks: r.clicks });
    }
  }

  const eligible: { ad: AdRow; weight: number }[] = [];
  for (const ad of candidates) {
    let weight = ad.weight;

    if (site) {
      const override = rules.get(ad.id);
      if (override !== undefined) {
        weight = override ?? ad.weight;
      } else if (ad.restricted_to_sites) {
        continue; // site-exclusive ad with no rule for this site
      }
    } else if (ad.restricted_to_sites) {
      continue; // site-exclusive ads never show to unregistered/unknown embeds
    }

    if (weight <= 0) continue;

    if (ad.frequency_cap_per_day != null) {
      const seen = capCounts.get(ad.id) ?? 0;
      if (seen >= ad.frequency_cap_per_day) continue;
    }

    if (ad.campaign_id) {
      const campaign = campaigns.get(ad.campaign_id);
      if (campaign) {
        if (campaign.status !== "active") continue;
        const spend = campaignSpend.get(ad.campaign_id);
        if (spend) {
          if (campaign.impression_cap != null && spend.impressions >= campaign.impression_cap) continue;
          if (campaign.click_cap != null && spend.clicks >= campaign.click_cap) continue;
        }
      }
    }

    const allowedCountries = parseCsvList(ad.allowed_countries);
    if (allowedCountries.length && (!country || !allowedCountries.includes(country))) continue;
    const blockedCountries = parseCsvList(ad.blocked_countries);
    if (country && blockedCountries.includes(country)) continue;

    const allowedDevices = parseCsvList(ad.allowed_devices);
    if (allowedDevices.length && !allowedDevices.includes(deviceType)) continue;

    eligible.push({ ad, weight });
  }

  if (!eligible.length) return null;

  // Avoid showing the exact same ad twice in a row for one viewer, unless it's
  // the only thing left in the pool.
  let pool = eligible;
  if (excludeAdId) {
    const withoutLast = eligible.filter((e) => e.ad.id !== excludeAdId);
    if (withoutLast.length) pool = withoutLast;
  }

  const topPriority = Math.max(...pool.map((e) => e.ad.priority));
  const tier = pool.filter((e) => e.ad.priority === topPriority);

  const totalWeight = tier.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const e of tier) {
    roll -= e.weight;
    if (roll <= 0) return { ad: e.ad, site };
  }
  return { ad: tier[tier.length - 1].ad, site };
}

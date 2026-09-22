import type { AdRow, Env, SiteRow } from "./types";

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
}

export interface SelectResult {
  ad: AdRow;
  site: SiteRow | null;
}

export async function selectAd({ env, siteKey, viewerId }: SelectParams): Promise<SelectResult | null> {
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
     WHERE enabled = 1
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

    eligible.push({ ad, weight });
  }

  if (!eligible.length) return null;

  const topPriority = Math.max(...eligible.map((e) => e.ad.priority));
  const tier = eligible.filter((e) => e.ad.priority === topPriority);

  const totalWeight = tier.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const e of tier) {
    roll -= e.weight;
    if (roll <= 0) return { ad: e.ad, site };
  }
  return { ad: tier[tier.length - 1].ad, site };
}

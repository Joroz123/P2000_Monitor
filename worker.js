// NMTP — P2000 relay-server (Cloudflare Worker)
//
// Doel: één plek die de 5 112-nu.nl discipline-feeds ophaalt, samenvoegt en
// cachet in KV, zodat alle bordjes van gebruikers samen maar 1x per minuut
// bij 112-nu.nl aankloppen (via deze Worker) i.p.v. dat elk bordje dat apart
// doet. Bordjes praten alleen nog met dit ene endpoint.
//
// Attributie-plicht 112-nu.nl: zorg dat elk scherm dat deze data toont een
// zichtbare "Bron: 112-nu.nl"-vermelding heeft (staat al in de firmware).

const FEEDS = {
  Brandweerdiensten: "https://112-nu.nl/brandweer/rss",
  Ambulancediensten: "https://112-nu.nl/ambulance/rss",
  Politiediensten:   "https://112-nu.nl/politie/rss",
  KNRM:              "https://112-nu.nl/knrm/rss",
  Lifeliner:         "https://112-nu.nl/trauma-helikopter/rss",
};

const MAX_PER_FEED = 8;
const MAX_TOTAL = 40;
const KV_KEY_DATA = "alerts_ndjson";
const KV_KEY_META = "meta";

// --- XML helpers -----------------------------------------------------------

function extractTag(block, tag) {
  const openIdx = block.indexOf("<" + tag);
  if (openIdx === -1) return "";
  const gt = block.indexOf(">", openIdx);
  if (gt === -1) return "";
  const closeTag = "</" + tag + ">";
  const end = block.indexOf(closeTag, gt + 1);
  if (end === -1) return "";
  return block.substring(gt + 1, end).trim();
}

function extractPlaceFromLink(link) {
  const marker = "/melding/";
  const idx = link.indexOf(marker);
  if (idx === -1) return "";
  const rest = link.substring(idx + marker.length);
  const parts = rest.split("/");
  if (parts.length < 2) return "";
  const slug = parts[1]; // parts[0] = numeric id, parts[1] = city slug
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function parseFeed(url, disciplineLabel) {
  const res = await fetch(url, { cf: { cacheTtl: 0 } });
  if (!res.ok) return [];
  const xml = await res.text();

  const items = [];
  let from = 0;
  while (items.length < MAX_PER_FEED) {
    const start = xml.indexOf("<item>", from);
    if (start === -1) break;
    const end = xml.indexOf("</item>", start);
    if (end === -1) break;
    const block = xml.substring(start, end);
    from = end + 7;

    const title = extractTag(block, "title");
    const desc = extractTag(block, "description");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const text = desc || title;
    if (!text) continue;

    const region = extractPlaceFromLink(link);
    const sortKey = Date.parse(pubDate) || 0;

    items.push({ service: disciplineLabel, region, text, pubDate, sortKey });
  }
  return items;
}

async function refreshCache(env) {
  const results = await Promise.allSettled(
    Object.entries(FEEDS).map(([label, url]) => parseFeed(url, label))
  );

  let all = [];
  for (const r of results) {
    if (r.status === "fulfilled") all = all.concat(r.value);
  }

  all.sort((a, b) => b.sortKey - a.sortKey);
  all = all.slice(0, MAX_TOTAL);

  const ndjson = all
    .map((a) =>
      JSON.stringify({
        service: a.service,
        region: a.region,
        text: a.text,
        pubDate: a.pubDate,
      })
    )
    .join("\n");

  await env.P2000_CACHE.put(KV_KEY_DATA, ndjson);
  await env.P2000_CACHE.put(
    KV_KEY_META,
    JSON.stringify({ updatedAt: new Date().toISOString(), count: all.length })
  );
}

export default {
  // Runs on the cron schedule (configured in wrangler.toml) — refreshes
  // the cache. Boards never trigger this directly.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshCache(env));
  },

  // Boards (and anyone debugging) hit this. Always serves from cache —
  // never blocks on 112-nu.nl itself, so it's fast even if that site is slow.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const meta = (await env.P2000_CACHE.get(KV_KEY_META)) || "{}";
      return new Response(meta, {
        headers: { "content-type": "application/json" },
      });
    }

    const data = await env.P2000_CACHE.get(KV_KEY_DATA);
    if (!data) {
      // Cache not warmed yet (e.g. right after first deploy) — do a
      // one-off synchronous refresh so the very first request isn't empty.
      await refreshCache(env);
      const fresh = (await env.P2000_CACHE.get(KV_KEY_DATA)) || "";
      return new Response(fresh, {
        headers: { "content-type": "application/x-ndjson" },
      });
    }

    return new Response(data, {
      headers: { "content-type": "application/x-ndjson" },
    });
  },
};

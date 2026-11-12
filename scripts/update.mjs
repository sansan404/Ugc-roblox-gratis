// Robot pengecek UGC gratis Roblox.
// Jalan otomatis lewat GitHub Actions (lihat .github/workflows/update.yml).
// Tanpa library tambahan: cukup Node.js 20+.
//
// Alur:
// 1. Cari item gratis terbaru di Marketplace Roblox (API publik, tanpa login)
// 2. Lengkapi info: gambar, game tempat klaim, sisa stok
// 3. Gabungkan dengan data lama (data/items.json) -> tahu mana yang BARU
// 4. Kirim notif item baru ke Telegram dan/atau Discord
// 5. Simpan data/items.json untuk dibaca website

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "data", "items.json");

const CONFIG = {
  pages: Number(process.env.SEARCH_PAGES || 3), // 1 halaman = 120 item
  keepDays: Number(process.env.KEEP_DAYS || 30), // simpan riwayat berapa hari
  maxNotifPerRun: Number(process.env.MAX_NOTIF || 15),
  recheckLimit: 60, // maks item lama yang dicek ulang per jalan
  delayMs: 1200, // jeda antar request supaya "sopan"
};

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || "";
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || "";
const SITE_URL = process.env.SITE_URL || "";
const MOCK = process.env.MOCK_DIR || ""; // untuk uji coba tanpa internet

// saleLocationType dari API Roblox
const SALE_LOCATION = {
  0: "NotApplicable", 1: "ShopOnly", 2: "MyExperiencesOnly", 3: "ShopAndMyExperiences",
  4: "ExperiencesById", 5: "ShopAndAllExperiences", 6: "ExperiencesDevApiOnly", 7: "ShopAndExperiencesById",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- HTTP dengan retry ----------
async function getJSON(url, opts = {}) {
  if (MOCK) return mockFetch(url, opts);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { "accept": "application/json", "user-agent": "ugc-gratis-tracker/1.0", ...(opts.headers || {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || attempt * 5000;
        log(`HTTP ${res.status} ${short(url)} -> tunggu ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        log(`HTTP ${res.status} ${short(url)}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      log(`Gagal ${short(url)}: ${e.message}`);
      await sleep(attempt * 3000);
    }
  }
  return null;
}
const short = (u) => u.replace(/^https:\/\//, "").slice(0, 90);

async function mockFetch(url) {
  const map = [
    [/search\/items\/details/, "search.json"],
    [/economy\.roblox\.com\/v2\/assets\/(\d+)/, (m) => `economy-${m[1]}.json`],
    [/games\.roblox\.com\/v1\/games\?/, "games.json"],
    [/thumbnails\.roblox\.com\/v1\/assets\?/, "thumbs.json"],
    [/thumbnails\.roblox\.com\/v1\/bundles/, "thumbs.json"],
  ];
  for (const [re, file] of map) {
    const m = url.match(re);
    if (m) {
      const name = typeof file === "function" ? file(m) : file;
      try { return JSON.parse(await readFile(join(MOCK, name), "utf8")); } catch { return null; }
    }
  }
  return null;
}

// ---------- 1. Cari item gratis terbaru ----------
async function searchFreeItems() {
  const found = [];
  let cursor = "";
  for (let page = 0; page < CONFIG.pages; page++) {
    const p = new URLSearchParams({
      Category: "1",
      SalesTypeFilter: "1",
      SortType: "3", // terbaru dibuat/diupdate
      MinPrice: "0",
      MaxPrice: "0",
      IncludeNotForSale: "false",
      Limit: "120",
    });
    if (cursor) p.set("Cursor", cursor);
    const json = await getJSON(`https://catalog.roblox.com/v2/search/items/details?${p}`);
    if (!json || !Array.isArray(json.data)) break;
    found.push(...json.data);
    cursor = json.nextPageCursor;
    if (!cursor) break;
    await sleep(CONFIG.delayMs);
  }
  // pastikan benar-benar gratis & masih dijual
  return found.filter((it) => {
    const free = it.price === 0 || it.lowestPrice === 0 || String(it.priceStatus).toLowerCase() === "free";
    return free && !it.isOffSale;
  });
}

// ---------- 2. Lengkapi info ----------
function locationName(v) {
  if (typeof v === "number") return SALE_LOCATION[v] || "NotApplicable";
  return v || "NotApplicable";
}

// di mana item bisa diklaim
function claimWhere(loc) {
  switch (loc) {
    case "MyExperiencesOnly":
    case "ExperiencesById":
    case "ExperiencesDevApiOnly":
      return "game";
    case "ShopAndMyExperiences":
    case "ShopAndExperiencesById":
    case "ShopAndAllExperiences":
      return "both";
    default:
      return "shop";
  }
}

function gameIdsFromText(text = "") {
  const ids = [...String(text).matchAll(/roblox\.com\/(?:[a-z]{2}\/)?games\/(\d+)/gi)].map((m) => Number(m[1]));
  return [...new Set(ids)];
}

async function fetchEconomy(assetId) {
  return getJSON(`https://economy.roblox.com/v2/assets/${assetId}/details`);
}

async function fetchGames(universeIds) {
  const out = new Map();
  for (let i = 0; i < universeIds.length; i += 50) {
    const chunk = universeIds.slice(i, i + 50);
    const json = await getJSON(`https://games.roblox.com/v1/games?universeIds=${chunk.join(",")}`);
    for (const g of json?.data || []) out.set(g.id, { name: g.name, placeId: g.rootPlaceId });
    await sleep(CONFIG.delayMs);
  }
  return out;
}

async function fetchThumbs(assetIds, bundleIds) {
  const out = new Map();
  const run = async (ids, kind) => {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const url = kind === "asset"
        ? `https://thumbnails.roblox.com/v1/assets?assetIds=${chunk.join(",")}&size=420x420&format=Png&isCircular=false`
        : `https://thumbnails.roblox.com/v1/bundles/thumbnails?bundleIds=${chunk.join(",")}&size=420x420&format=Png&isCircular=false`;
      const json = await getJSON(url);
      for (const t of json?.data || []) if (t.imageUrl) out.set(`${kind}:${t.targetId}`, t.imageUrl);
      await sleep(CONFIG.delayMs);
    }
  };
  await run(assetIds, "asset");
  await run(bundleIds, "bundle");
  return out;
}

function toItem(raw, now) {
  const isBundle = String(raw.itemType).toLowerCase() === "bundle";
  const loc = locationName(raw.saleLocationType);
  const total = raw.totalQuantity || 0;
  return {
    key: `${isBundle ? "bundle" : "asset"}:${raw.id}`,
    id: raw.id,
    type: isBundle ? "bundle" : "asset",
    name: raw.name,
    creator: raw.creatorName,
    creatorVerified: !!raw.creatorHasVerifiedBadge,
    limited: total > 0 || (raw.itemRestrictions || []).some((r) => /limited|collectible/i.test(String(r))),
    total: total || null,
    remaining: total ? raw.unitsAvailableForConsumption ?? null : null,
    perUser: raw.quantityLimitPerUser || null,
    offSaleDeadline: raw.offSaleDeadline || null,
    where: claimWhere(loc),
    games: [],
    gameHints: gameIdsFromText(raw.description),
    image: null,
    createdAt: raw.itemCreatedUtc || null,
    firstSeen: now,
    lastSeen: now,
    available: true,
    url: `https://www.roblox.com/${isBundle ? "bundles" : "catalog"}/${raw.id}`,
  };
}

// ---------- Simpan / muat ----------
async function loadStore() {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch {
    return { updatedAt: null, items: [] };
  }
}

async function saveStore(store) {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(store, null, 1) + "\n");
}

// ---------- 4. Notifikasi ----------
function captionText(it) {
  const lines = [`🆓 <b>UGC GRATIS BARU</b>`, ``, `<b>${esc(it.name)}</b>`, `oleh ${esc(it.creator || "?")}${it.creatorVerified ? " ✅" : ""}`];
  if (it.limited && it.total) lines.push(`📦 Stok: ${fmt(it.remaining ?? 0)} / ${fmt(it.total)}`);
  else if (it.limited) lines.push(`📦 Limited`);
  if (it.where === "game") lines.push(`🎮 Klaim di dalam game${it.games[0]?.name ? `: ${esc(it.games[0].name)}` : ""}`);
  else if (it.where === "both") lines.push(`🛒 Klaim di Marketplace atau di game`);
  else lines.push(`🛒 Klaim langsung di Marketplace`);
  if (it.offSaleDeadline) lines.push(`⏰ Berakhir: ${new Date(it.offSaleDeadline).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`);
  return lines.join("\n");
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => Number(n).toLocaleString("id-ID");

function buttons(it) {
  const b = [];
  if (it.games[0]) b.push({ text: "🎮 Buka Game", url: `https://www.roblox.com/games/${it.games[0].placeId}` });
  b.push({ text: "👕 Lihat Item", url: it.url });
  if (SITE_URL) b.push({ text: "🌐 Website", url: SITE_URL });
  return b;
}

async function sendTelegram(it) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  const body = {
    chat_id: TELEGRAM_CHAT,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [buttons(it)] },
  };
  const method = it.image ? "sendPhoto" : "sendMessage";
  if (it.image) Object.assign(body, { photo: it.image, caption: captionText(it) });
  else body.text = captionText(it);
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).catch((e) => ({ ok: false, statusText: e.message }));
  if (!res.ok) log("Telegram gagal:", res.status || "", res.statusText || "");
}

async function sendDiscord(it) {
  if (!DISCORD_WEBHOOK) return;
  const plain = captionText(it).replace(/<\/?b>/g, "**").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const links = buttons(it).map((b) => `[${b.text}](${b.url})`).join("  •  ");
  const body = {
    username: "UGC Gratis",
    embeds: [{
      title: it.name.slice(0, 250),
      url: it.games[0] ? `https://www.roblox.com/games/${it.games[0].placeId}` : it.url,
      description: `${plain.split("\n").slice(4).join("\n")}\n\n${links}`.slice(0, 4000),
      color: 0x22c55e,
      thumbnail: it.image ? { url: it.image } : undefined,
      footer: { text: `oleh ${it.creator || "?"}` },
      timestamp: new Date().toISOString(),
    }],
  };
  const res = await fetch(DISCORD_WEBHOOK, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).catch((e) => ({ ok: false, statusText: e.message }));
  if (!res.ok) log("Discord gagal:", res.status || "", res.statusText || "");
}

// ---------- Main ----------
async function main() {
  const now = new Date().toISOString();
  const store = await loadStore();
  const firstRun = store.items.length === 0;
  const byKey = new Map(store.items.map((i) => [i.key, i]));

  log("Mencari item gratis...");
  const raw = await searchFreeItems();
  log(`Dapat ${raw.length} item gratis yang masih dijual.`);
  if (raw.length === 0 && !MOCK) {
    // kemungkinan API sedang error / diblokir: jangan hapus data lama
    log("Tidak ada data (API mungkin sedang bermasalah). Data lama tidak diubah.");
    process.exitCode = 0;
    return;
  }

  const current = raw.map((r) => toItem(r, now));
  const currentKeys = new Set(current.map((i) => i.key));
  const newOnes = current.filter((i) => !byKey.has(i.key));

  // Lengkapi info item BARU (game & gambar). Item lama cukup update stok.
  const universeIds = new Set();
  for (const it of newOnes) {
    if (it.type === "asset" && it.where !== "shop") {
      const eco = await fetchEconomy(it.id);
      for (const u of eco?.SaleLocation?.UniverseIds || []) universeIds.add(u);
      it._universes = eco?.SaleLocation?.UniverseIds || [];
      await sleep(CONFIG.delayMs);
    }
  }
  const games = universeIds.size ? await fetchGames([...universeIds]) : new Map();
  for (const it of newOnes) {
    it.games = (it._universes || []).map((u) => games.get(u)).filter(Boolean).slice(0, 3);
    if (!it.games.length && it.gameHints.length) {
      it.games = it.gameHints.slice(0, 1).map((placeId) => ({ name: null, placeId }));
    }
    delete it._universes;
  }

  const needThumb = current.filter((i) => !(byKey.get(i.key)?.image));
  const thumbs = await fetchThumbs(
    [...new Set(needThumb.filter((i) => i.type === "asset").map((i) => i.id))],
    [...new Set(needThumb.filter((i) => i.type === "bundle").map((i) => i.id))],
  );

  // Gabungkan
  for (const it of current) {
    const old = byKey.get(it.key);
    if (old) {
      Object.assign(old, {
        name: it.name, remaining: it.remaining, total: it.total, offSaleDeadline: it.offSaleDeadline,
        lastSeen: now, available: !(it.limited && it.remaining === 0),
      });
      if (!old.image) old.image = thumbs.get(it.key) || null;
    } else {
      it.image = thumbs.get(it.key) || null;
      it.available = !(it.limited && it.remaining === 0);
      byKey.set(it.key, it);
    }
  }

  // Item lama yang tidak muncul lagi: cek ulang apakah masih dijual
  const missing = [...byKey.values()].filter((i) => i.available && !currentKeys.has(i.key));
  let checked = 0;
  for (const it of missing) {
    const deadlinePassed = it.offSaleDeadline && new Date(it.offSaleDeadline) < new Date();
    if (deadlinePassed) { it.available = false; continue; }
    if (it.type !== "asset" || checked >= CONFIG.recheckLimit) continue;
    checked++;
    const eco = await fetchEconomy(it.id);
    if (eco) {
      const remaining = eco.Remaining;
      const free = (eco.PriceInRobux ?? 0) === 0;
      it.available = !!eco.IsForSale && free && remaining !== 0;
      if (typeof remaining === "number") it.remaining = remaining;
    }
    await sleep(CONFIG.delayMs);
  }

  // Buang yang terlalu lama
  const cutoff = Date.now() - CONFIG.keepDays * 86400e3;
  const items = [...byKey.values()]
    .filter((i) => new Date(i.firstSeen).getTime() > cutoff || i.available)
    .sort((a, b) => (b.createdAt || b.firstSeen).localeCompare(a.createdAt || a.firstSeen));
  for (const i of items) delete i.gameHints;

  await saveStore({ updatedAt: now, items });
  log(`Tersimpan ${items.length} item (${items.filter((i) => i.available).length} masih bisa diklaim). Baru: ${newOnes.length}.`);

  // Notifikasi
  if (firstRun) {
    log("Jalan pertama: tidak kirim notif supaya channel tidak dibanjiri.");
    return;
  }
  const toNotify = newOnes.filter((i) => i.available).slice(0, CONFIG.maxNotifPerRun).reverse();
  for (const it of toNotify) {
    await sendTelegram(it);
    await sendDiscord(it);
    await sleep(1500);
  }
  if (toNotify.length) log(`Notif terkirim untuk ${toNotify.length} item.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

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
const GUIDE_FILE = join(ROOT, "data", "cara-klaim.json"); // catatan misi yang kamu tulis sendiri

const CONFIG = {
  pages: Number(process.env.SEARCH_PAGES || 3), // 1 halaman = 120 item
  keepDays: Number(process.env.KEEP_DAYS || 30), // simpan riwayat berapa hari
  maxNotifPerRun: Number(process.env.MAX_NOTIF || 15),
  recheckLimit: 60, // maks item lama yang dicek ulang per jalan
  delayMs: 1200, // jeda antar request supaya "sopan"
  minStock: Number(process.env.MIN_STOCK || 5), // item limited dengan total stok <= ini dianggap item kode (disembunyikan)
  gameRefreshHours: 6, // deskripsi map diperbarui tiap berapa jam
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
async function postJSON(url, data) {
  if (MOCK) return mockFetch(url);
  let csrf = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "user-agent": "ugc-gratis-tracker/1.0", ...(csrf ? { "x-csrf-token": csrf } : {}) },
        body: JSON.stringify(data),
      });
      if (res.status === 403 && res.headers.get("x-csrf-token") && !csrf) { csrf = res.headers.get("x-csrf-token"); attempt--; continue; }
      if (res.status === 429 || res.status >= 500) { await sleep(attempt * 5000); continue; }
      if (!res.ok) { log(`HTTP ${res.status} POST ${short(url)}`); return null; }
      return await res.json();
    } catch (e) {
      log(`Gagal POST ${short(url)}: ${e.message}`);
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
    [/marketplace-items/, "market.json"],
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

function cleanText(text, max) {
  const t = String(text || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}

function gameIdsFromText(text = "") {
  const ids = [...String(text).matchAll(/roblox\.com\/(?:[a-z]{2}\/)?games\/(\d+)/gi)].map((m) => Number(m[1]));
  return [...new Set(ids)];
}

async function fetchEconomy(assetId) {
  return getJSON(`https://economy.roblox.com/v2/assets/${assetId}/details`);
}

// Stok paling akurat + daftar game tempat klaim
async function fetchMarket(collectibleIds) {
  const out = new Map();
  for (let i = 0; i < collectibleIds.length; i += 30) {
    const chunk = collectibleIds.slice(i, i + 30);
    const json = await postJSON("https://apis.roblox.com/marketplace-items/v1/items/details", { itemIds: chunk });
    for (const m of Array.isArray(json) ? json : json?.data || []) {
      if (!m?.collectibleItemId) continue;
      out.set(m.collectibleItemId, {
        units: m.unitsAvailableForConsumption,
        stock: m.assetStock,
        sales: m.sales ?? null,
        perUser: m.quantityLimitPerUser || null,
        universeIds: m.universeIds || (m.experiences || []).map((e) => e.id),
        price: m.price ?? m.lowestPrice ?? 0,
      });
    }
    await sleep(CONFIG.delayMs);
  }
  return out;
}

async function fetchGames(universeIds) {
  const out = new Map();
  for (let i = 0; i < universeIds.length; i += 50) {
    const chunk = universeIds.slice(i, i + 50);
    const json = await getJSON(`https://games.roblox.com/v1/games?universeIds=${chunk.join(",")}`);
    for (const g of json?.data || []) out.set(g.id, { name: g.name, placeId: g.rootPlaceId, playing: g.playing ?? null, description: cleanText(g.description, 2500), fetchedAt: new Date().toISOString() });
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
    collectibleItemId: raw.collectibleItemId || null,
    universeIds: [],
    perUser: raw.quantityLimitPerUser || null,
    offSaleDeadline: raw.offSaleDeadline || null,
    where: claimWhere(loc),
    games: [],
    description: cleanText(raw.description, 1200),
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
let GUIDES = {};
async function loadGuides() {
  try { GUIDES = JSON.parse(await readFile(GUIDE_FILE, "utf8")); } catch { GUIDES = {}; }
}
let GAMES = {};
// Ambil baris-baris penting dari deskripsi map (yang membahas UGC / kode / cara dapat)
export function mapTips(desc = "") {
  const KEY = /(ugc|free|gratis|claim|klaim|code|kode|redeem|reward|hadiah|limited|stock|stok|stage|level|obby|quest|misi|mission|collect|kumpul|badge|win|menang|reach|complete|selesai|join|group|grup|like|favorite|spin|egg|chest|peti|token|coin|koin|minute|menit|hour|jam|play|main|unlock|get|dapat)/i;
  return String(desc).split(/\n+/).map((l) => l.trim())
    .filter((l) => l.length >= 4 && l.length <= 220 && KEY.test(l) && !/^(https?:|discord\.gg)/i.test(l))
    .slice(0, 6);
}
// Klasifikasi cara dapat: "misi" (gratis lewat misi), "beli" (perlu Robux/gamepass), "kode", atau "?"
const RE_BUY = /(robux|\bR\$|\bbuy\b|\bbeli\b|purchas|gamepass|game ?pass|donat|\bpay\b|bayar|\bprice\b|harga|\bcost\b|premium|developer product|\bvip\b|\bsale\b|discount|diskon)/gi;
const RE_SHOPGAME = /(avatar|catalog|katalog|\bshop\b|\bstore\b|outfit|marketplace|mall|boutique|\btoko\b)/i;
const RE_CODE = /(\bcodes?\b|\bkode\b|redeem)/gi;
const RE_MISSION = /(stage|obby|quest|mission|\bmisi\b|badge|collect|kumpul|\bfind\b|\bcari\b|reach|complete|selesai|play (for|\d)|minutes|menit|\bwin\b|menang|level|tower|escape|survive|defeat|parkour|hunt|\begg|token|checkpoint|finish|race|maze|puzzle|battle|fight|boss|explore|treasure|harta)/gi;
const count = (re, t) => (String(t).match(re) || []).length;

export function classify(it, gameDesc = "") {
  const gameName = it.games?.[0]?.name || "";
  const text = `${gameName}\n${gameDesc}\n${it.description || ""}`;
  const buy = count(RE_BUY, text), mission = count(RE_MISSION, text), code = count(RE_CODE, text);
  if (it.where === "shop") return { type: "shop", why: "Diambil langsung di Marketplace (tanpa misi)" };
  if (/(\bcodes?\b|\bkode\b|redeem)/i.test(gameName)) return { type: "kode", why: "Game kode redeem" };
  if (RE_SHOPGAME.test(gameName)) return { type: "beli", why: "Game toko/katalog avatar" };
  if (buy > 0 && buy >= mission) return { type: "beli", why: "Deskripsi menyebut Robux/beli" };
  if (mission > 0) return { type: "misi", why: "Deskripsi menyebut misi/stage/kumpulkan" };
  if (code > 0) return { type: "kode", why: "Butuh kode" };
  return { type: "?", why: "Belum jelas cara dapatnya" };
}

function guideFor(it) {
  const manual = GUIDES[String(it.id)];
  if (manual && manual !== false) return Array.isArray(manual) ? manual.join("\n") : String(manual);
  const g = it.games?.[0] && GAMES[it.games[0].universeId];
  const tips = g ? mapTips(g.description) : [];
  if (tips.length) return "Dari deskripsi map:\n• " + tips.slice(0, 4).join("\n• ");
  return it.description || "";
}

function captionText(it) {
  const lines = [`🆓 <b>UGC GRATIS BARU</b>`, ``, `<b>${esc(it.name)}</b>`, `oleh ${esc(it.creator || "?")}${it.creatorVerified ? " ✅" : ""}`];
  if (it.limited && it.total) lines.push(`📦 Stok: ${fmt(it.remaining ?? 0)} / ${fmt(it.total)}`);
  else if (it.limited) lines.push(`📦 Limited`);
  if (it.where === "game") lines.push(`🎮 Klaim di dalam game${it.games[0]?.name ? `: ${esc(it.games[0].name)}` : ""}`);
  else if (it.where === "both") lines.push(`🛒 Klaim di Marketplace atau di game`);
  else lines.push(`🛒 Klaim langsung di Marketplace`);
  const guide = guideFor(it);
  if (guide) lines.push(``, `📝 <b>Cara klaim / misi:</b>`, esc(guide.length > 350 ? guide.slice(0, 350) + "…" : guide));
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
  if (it.image) Object.assign(body, { photo: it.image, caption: captionText(it).slice(0, 1020) });
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
  await loadGuides();
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

  // Gabungkan data pencarian dengan data lama
  for (const it of current) {
    const old = byKey.get(it.key);
    if (old) {
      Object.assign(old, {
        name: it.name, description: it.description, remaining: it.remaining, total: it.total,
        offSaleDeadline: it.offSaleDeadline, perUser: it.perUser, lastSeen: now,
        collectibleItemId: it.collectibleItemId || old.collectibleItemId || null,
      });
      old.gameHints = it.gameHints;
      old.available = true;
    } else {
      byKey.set(it.key, it);
    }
  }
  const tracked = [...byKey.values()].filter((i) => currentKeys.has(i.key) || i.available);

  // 1) Cek stok akurat lewat API marketplace (sekaligus dapat daftar game)
  const market = await fetchMarket([...new Set(tracked.map((i) => i.collectibleItemId).filter(Boolean))]);
  log(`Stok akurat didapat untuk ${market.size} item.`);
  for (const it of tracked) {
    const m = it.collectibleItemId && market.get(it.collectibleItemId);
    if (m) {
      if (typeof m.units === "number") it.remaining = m.units;
      if (m.stock) it.total = m.stock;
      it.sold = m.sales;
      if (m.perUser) it.perUser = m.perUser;
      if (m.universeIds?.length) it.universeIds = m.universeIds;
    }
  }

  // 2) Item tanpa data marketplace: pakai API economy (maks recheckLimit per jalan)
  let checked = 0;
  for (const it of tracked) {
    if (it.type !== "asset" || checked >= CONFIG.recheckLimit) continue;
    const hasMarket = it.collectibleItemId && market.has(it.collectibleItemId);
    const needGame = it.where !== "shop" && !it.universeIds?.length;
    const vanished = !currentKeys.has(it.key);
    if (hasMarket || (!needGame && !vanished)) continue;
    checked++;
    const eco = await fetchEconomy(it.id);
    if (eco) {
      if (eco.SaleLocation?.UniverseIds?.length) it.universeIds = eco.SaleLocation.UniverseIds;
      if (vanished) it.available = !!eco.IsForSale && (eco.PriceInRobux ?? 0) === 0;
      if (typeof eco.Remaining === "number" && it.limited) it.remaining = eco.Remaining;
    } else if (vanished) {
      it.available = false;
    }
    await sleep(CONFIG.delayMs);
  }

  // 3) Status bisa diklaim
  for (const it of tracked) {
    const deadlinePassed = it.offSaleDeadline && new Date(it.offSaleDeadline) < new Date();
    const soldOut = it.limited && it.remaining === 0;
    if (deadlinePassed || soldOut) it.available = false;
    it.tiny = !!(it.limited && it.total && it.total <= CONFIG.minStock);
  }

  // 4) Info map / game (nama, deskripsi, jumlah pemain) disimpan di cache
  store.games = store.games || {};
  const wantU = new Set(tracked.filter((i) => i.available).flatMap((i) => i.universeIds || []));
  const stale = [...wantU].filter((u) => {
    const g = store.games[u];
    return !g || !g.fetchedAt || Date.now() - new Date(g.fetchedAt) > CONFIG.gameRefreshHours * 3600e3;
  });
  if (stale.length) {
    const fresh = await fetchGames(stale);
    for (const [u, g] of fresh) store.games[u] = g;
    log(`Info map diperbarui: ${fresh.size}.`);
  }
  for (const it of tracked) {
    it.games = (it.universeIds || []).map((u) => {
      const g = store.games[u];
      return g && { universeId: u, name: g.name, placeId: g.placeId, playing: g.playing ?? null };
    }).filter(Boolean).slice(0, 3);
    if (!it.games.length && it.gameHints?.length) it.games = [{ name: null, placeId: it.gameHints[0] }];
  }

  // 4b) Cek: benar-benar gratis lewat misi?
  for (const it of tracked) {
    const u = it.games?.[0]?.universeId;
    const c = classify(it, u ? store.games[u]?.description : "");
    const g = GUIDES[String(it.id)];
    if (g === false) { c.type = "beli"; c.why = "Disembunyikan manual"; }
    else if (g) { c.type = "misi"; c.why = "Misi ditulis manual"; }
    it.claimType = c.type;
    it.claimWhy = c.why;
  }
  // tampil di website hanya: masih bisa diklaim + bukan item kode kecil + lewat misi
  const isShown = (i) => i.available && !i.tiny && i.claimType === "misi";

  // 5) Gambar
  const needThumb = tracked.filter((i) => !i.image);
  const thumbs = await fetchThumbs(
    [...new Set(needThumb.filter((i) => i.type === "asset").map((i) => i.id))],
    [...new Set(needThumb.filter((i) => i.type === "bundle").map((i) => i.id))],
  );
  for (const it of needThumb) it.image = thumbs.get(it.key) || null;

  // Buang yang terlalu lama
  const cutoff = Date.now() - CONFIG.keepDays * 86400e3;
  const items = [...byKey.values()]
    .filter((i) => new Date(i.firstSeen).getTime() > cutoff || i.available)
    .sort((a, b) => (b.createdAt || b.firstSeen).localeCompare(a.createdAt || a.firstSeen));
  for (const i of items) delete i.gameHints;
  const usedU = new Set(items.filter((i) => i.available).flatMap((i) => i.universeIds || []));
  const games = Object.fromEntries(Object.entries(store.games || {}).filter(([u]) => usedU.has(Number(u))));

  await saveStore({ updatedAt: now, items, games });
  const shown = items.filter(isShown).length;
  const byType = {};
  for (const i of items.filter((x) => x.available && !x.tiny)) byType[i.claimType] = (byType[i.claimType] || 0) + 1;
  log("Jenis item yang masih bisa diklaim:", JSON.stringify(byType));
  log(`Tersimpan ${items.length} item. Tampil di website: ${shown}. Baru: ${newOnes.length}.`);

  // Notifikasi
  GAMES = games;
  if (firstRun) {
    log("Jalan pertama: tidak kirim notif supaya channel tidak dibanjiri.");
    return;
  }
  const toNotify = newOnes.filter(isShown).slice(0, CONFIG.maxNotifPerRun).reverse();
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

const ua = { "user-agent": "ugc-gratis-tracker/1.0", accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u) { const r = await fetch(u, { headers: ua }); const t = await r.text(); try { return { s: r.status, j: JSON.parse(t) }; } catch { return { s: r.status, t: t.slice(0, 200) }; } }
const combos = [
  { CreatorTargetId: "1", CreatorType: "1", SortType: "3", IncludeNotForSale: "true" },
  { CreatorTargetId: "1", CreatorType: "1", SortType: "3", IncludeNotForSale: "false" },
  { CreatorName: "Roblox", SortType: "3", IncludeNotForSale: "true" },
  { Keyword: "Big Brain Antennae", IncludeNotForSale: "true" },
];
for (const c of combos) {
  const p = new URLSearchParams({ Category: "1", SalesTypeFilter: "1", MinPrice: "0", MaxPrice: "0", Limit: "120", ...c });
  const r = await get(`https://catalog.roblox.com/v2/search/items/details?${p}`);
  const d = r.j?.data || [];
  const locs = {}; for (const i of d) locs[i.saleLocationType + "/" + i.priceStatus + "/" + (i.isOffSale ? "off" : "on")] = (locs[i.saleLocationType + "/" + i.priceStatus + "/" + (i.isOffSale ? "off" : "on")] || 0) + 1;
  console.log("COMBO", JSON.stringify(c), r.s, "n", d.length, JSON.stringify(locs));
  for (const i of d.filter((i) => !/ShopOnly|NotApplicable/.test(String(i.saleLocationType))).slice(0, 8))
    console.log("  ITEM", i.id, i.name, "|", i.saleLocationType, i.priceStatus, "offsale:", i.isOffSale, "created:", i.itemCreatedUtc, "total:", i.totalQuantity);
  await sleep(2500);
}
// detail item contoh
const s = await get(`https://catalog.roblox.com/v2/search/items/details?${new URLSearchParams({ Keyword: "Big Brain Antennae", Limit: "10", IncludeNotForSale: "true" })}`);
const it = (s.j?.data || []).find((i) => /Big Brain/i.test(i.name));
if (it) {
  const e = await get(`https://economy.roblox.com/v2/assets/${it.id}/details`);
  const ej = e.j || {}; delete ej.Description;
  console.log("ECONOMY", it.id, JSON.stringify(ej).slice(0, 900));
  const u = ej.SaleLocation?.UniverseIds || [];
  if (u.length) { const g = await get(`https://games.roblox.com/v1/games?universeIds=${u.slice(0, 5).join(",")}`); console.log("GAMES", JSON.stringify((g.j?.data || []).map((x) => x.name))); }
}

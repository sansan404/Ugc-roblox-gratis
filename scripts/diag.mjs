// Diagnostik sementara: bandingkan data stok dari beberapa API Roblox.
const ua = { "user-agent": "ugc-gratis-tracker/1.0", accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...ua, ...(opts.headers || {}) } });
  const t = await r.text();
  return { status: r.status, csrf: r.headers.get("x-csrf-token"), body: t.slice(0, 1500) };
}
async function post(url, data) {
  let r = await j(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  if (r.status === 403 && r.csrf) r = await j(url, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": r.csrf }, body: JSON.stringify(data) });
  return r;
}
const p = new URLSearchParams({ Category: "1", SalesTypeFilter: "1", SortType: "3", MinPrice: "0", MaxPrice: "0", IncludeNotForSale: "false", Limit: "30" });
const s = JSON.parse((await j(`https://catalog.roblox.com/v2/search/items/details?${p}`)).body.length ? (await (await fetch(`https://catalog.roblox.com/v2/search/items/details?${p}`, { headers: ua })).text()) : "{}");
const items = (s.data || []).filter((i) => i.totalQuantity).slice(0, 6);
for (const it of items) {
  console.log("\n=====", it.id, it.name, "| search:", it.unitsAvailableForConsumption, "/", it.totalQuantity, "loc", it.saleLocationType, "status", it.priceStatus, it.itemStatus, "restr", JSON.stringify(it.itemRestrictions), "collectible", it.collectibleItemId);
  const eco = await j(`https://economy.roblox.com/v2/assets/${it.id}/details`);
  console.log("ECONOMY", eco.status, eco.body.replace(/"Description":"[^"]*"/, ""));
  await sleep(800);
  const cat = await post("https://catalog.roblox.com/v1/catalog/items/details", { items: [{ itemType: 1, id: it.id }] });
  console.log("CATALOG-POST", cat.status, cat.body.replace(/"description":"[^"]*"/, ""));
  await sleep(800);
  if (it.collectibleItemId) {
    const mk = await post("https://apis.roblox.com/marketplace-items/v1/items/details", { itemIds: [it.collectibleItemId] });
    console.log("MARKETPLACE-ITEMS", mk.status, mk.body);
    await sleep(800);
    const mk2 = await j(`https://apis.roblox.com/marketplace-sales/v1/item/${it.collectibleItemId}/resellers?limit=10`);
    console.log("RESELLERS", mk2.status, mk2.body.slice(0, 200));
  }
  await sleep(800);
}

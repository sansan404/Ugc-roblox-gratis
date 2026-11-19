// Diagnostik sementara: lihat semua field status jual untuk beberapa item lama.
const ua = { "user-agent": "ugc-gratis-tracker/1.0", accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...ua, ...(opts.headers || {}) } });
  return { status: r.status, csrf: r.headers.get("x-csrf-token"), body: await r.text() };
}
async function post(url, data) {
  const o = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
  let r = await req(url, o);
  if (r.status === 403 && r.csrf) r = await req(url, { ...o, headers: { ...o.headers, "x-csrf-token": r.csrf } });
  return r;
}
const items = JSON.parse(await (await import("node:fs/promises")).readFile("data/items.json", "utf8")).items;
const ids = [82134720287646, 139188848668336, 100520425256527, 133756948810634, 96812417776301];
for (const id of ids) {
  const it = items.find((i) => i.id === id);
  console.log("\n=====", id, it?.name, "| data kita:", it?.remaining, "/", it?.total);
  const mk = await post("https://apis.roblox.com/marketplace-items/v1/items/details", { itemIds: [it.collectibleItemId] });
  console.log("MARKET", mk.status, mk.body.replace(/"description":"(?:[^"\\]|\\.)*"/, '"description":"…"').slice(0, 1500));
  await sleep(800);
  const eco = await req(`https://economy.roblox.com/v2/assets/${id}/details`);
  console.log("ECONOMY", eco.status, eco.body.replace(/"Description":"(?:[^"\\]|\\.)*"/, '"Description":"…"').slice(0, 1200));
  await sleep(800);
  const cat = await post("https://catalog.roblox.com/v1/catalog/items/details", { items: [{ itemType: 1, id }] });
  console.log("CATALOG", cat.status, cat.body.replace(/"description":"(?:[^"\\]|\\.)*"/, '"description":"…"').slice(0, 1200));
  await sleep(800);
}

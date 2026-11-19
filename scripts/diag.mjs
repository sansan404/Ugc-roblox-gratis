const ua = { "user-agent": "ugc-gratis-tracker/1.0", accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = { Category: "1", MinPrice: "0", MaxPrice: "0", IncludeNotForSale: "false", Limit: "120" };
const combos = [
  { SalesTypeFilter: "1", SortType: "3" },
  { SalesTypeFilter: "1", SortType: "0" },
  { SalesTypeFilter: "1", SortType: "3", SortAggregation: "5" },
  { SalesTypeFilter: "2", SortType: "3" },
  { SalesTypeFilter: "3", SortType: "3" },
  { SalesTypeFilter: "4", SortType: "3" },
  { SalesTypeFilter: "1", SortType: "3", Keyword: "free ugc" },
  { SalesTypeFilter: "1", SortType: "1" },
  { SalesTypeFilter: "1", SortType: "2" },
];
for (const c of combos) {
  const p = new URLSearchParams({ ...base, ...c });
  const r = await fetch(`https://catalog.roblox.com/v2/search/items/details?${p}`, { headers: ua });
  const t = await r.text();
  let d; try { d = JSON.parse(t).data || []; } catch { d = []; }
  const unl = d.filter((i) => !i.totalQuantity);
  console.log("COMBO", JSON.stringify(c), "status", r.status, "n", d.length, "unlimited", unl.length,
    "| contoh:", unl.slice(0, 5).map((i) => `${i.id}:${i.name}:${i.saleLocationType}:${i.priceStatus}`).join(" ; "), r.status !== 200 ? t.slice(0, 200) : "");
  await sleep(2500);
}

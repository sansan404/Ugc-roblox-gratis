const ua = { "user-agent": "ugc-gratis-tracker/1.0", accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const found = new Map();
for (const sort of ["0", "1", "2", "3"]) {
  let cursor = "", pages = 0, total = 0;
  while (pages < 8) {
    const p = new URLSearchParams({ Category: "1", SalesTypeFilter: "1", SortType: sort, MinPrice: "0", MaxPrice: "0", IncludeNotForSale: "false", Limit: "120" });
    if (cursor) p.set("Cursor", cursor);
    const r = await fetch(`https://catalog.roblox.com/v2/search/items/details?${p}`, { headers: ua });
    if (r.status !== 200) { console.log("sort", sort, "HTTP", r.status); await sleep(8000); continue; }
    const j = await r.json(); pages++; total += (j.data || []).length;
    for (const i of j.data || []) {
      const loc = String(i.saleLocationType);
      if (!i.totalQuantity && /Experiences/.test(loc) && !/^ShopAndAll/.test(loc)) found.set(i.id, `${i.name} | ${loc} | creator ${i.creatorName} (${i.creatorType}) verified:${i.creatorHasVerifiedBadge}`);
    }
    cursor = j.nextPageCursor; if (!cursor) break;
    await sleep(2500);
  }
  console.log("SORT", sort, "pages", pages, "items", total, "unlimited-in-game so far", found.size);
}
for (const [id, v] of found) console.log("FOUND", id, v);

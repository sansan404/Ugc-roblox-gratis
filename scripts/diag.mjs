const ua = { "user-agent": "ugc-gratis-tracker/1.0", accept: "application/json" };
const r = await fetch(`https://catalog.roblox.com/v2/search/items/details?${new URLSearchParams({ Keyword: "Big Brain Antennae", Limit: "30", IncludeNotForSale: "true", CreatorTargetId: "1", CreatorType: "1" })}`, { headers: ua });
const d = (await r.json()).data || [];
for (const i of d) console.log("ITEM", i.id, "#", i.name, "#", i.saleLocationType, "#", i.priceStatus, "#", i.price, "#", i.isOffSale, "#", i.itemCreatedUtc);

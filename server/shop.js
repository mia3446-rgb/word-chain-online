"use strict";

module.exports = Object.freeze({
  name: "shop",
  events: ["getShop","buyItem","equipItem","unequipItem","buyBox","openBox"],
  responsibilities: ["catalog", "cosmetics", "inventory", "loot boxes"]
});

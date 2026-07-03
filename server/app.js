"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const { registerSocketHandlers } = require("./socketHandlers");
const {
  makeSalt, makeToken, hashPassword, isValidNickname, isValidPassword
} = require("./auth");
const { safePlayerKey, randomInteger, weightedPick } = require("./utils");
const { createPlayerRepository } = require("./players");
const { loadDictionaries } = require("./words");
const {
  ensureRankedFields, applyRankedResult, publicRankedData
} = require("./game");

const PROJECT_ROOT = path.join(__dirname, "..");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  transports: ["websocket", "polling"],
  cors: {
    origin: "*"
  }
});

app.use(express.static(path.join(PROJECT_ROOT, "public")));

const rooms = {};
const wordDB = [];
const allWords = [];
const startMap = new Map();
const oneShotCache = new Map();

const dataDir = process.env.DATA_DIR || path.join(PROJECT_ROOT, "data");
const playersFile = path.join(dataDir, "players.json");
const oldPlayersFile = path.join(PROJECT_ROOT, "players.json");
const playerRepository = createPlayerRepository({ fs, dataDir, playersFile, oldPlayersFile });

let playerData = {};

function loadPlayerData() {
  console.log(`플레이어 데이터 저장 위치: ${playersFile}`);
  playerData = playerRepository.load();
}

function savePlayerData() {
  playerRepository.save(playerData);
}


function getDefaultProfile(nickname) {
  return {
    nickname,
    passwordHash: "",
    salt: "",
    sessionToken: "",
    createdAt: Date.now(),
    level: 1,
    xp: 0,
    totalXp: 0,
    coins: 0,
    wins: 0,
    losses: 0,
    games: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    wordsUsed: 0,
    titles: ["🌱 초보자"],
    selectedTitle: "🌱 초보자",
    achievements: [],
    achievementRewardsClaimed: [],
    levelUps: 0,
    claimedLevelRewards: [],
    inventory: [],
    equipped: {
      nameColor: "default",
      chatBubble: "default",
      profileBorder: "default",
      entranceEffect: "default",
      nameEffect: "default",
      profileBackground: "default",
      profileBadge: "default",
      chatEffect: "default",
      victoryEffect: "default",
      levelUpEffect: "default"
    },
    boxes: { common: 0, rare: 0, epic: 0, legendary: 0 },
    boxPity: { common: 0, rare: 0, epic: 0, legendary: 0 },
    quests: {
      dailyKey: "",
      weeklyKey: "",
      dailyStats: { games: 0, wins: 0, words: 0, xp: 0 },
      weeklyStats: { games: 0, wins: 0, words: 0, xp: 0 },
      claimed: []
    },
    friends: [],
    friendRequests: [],
    blockedPlayers: [],
    favoriteFriends: [],
    socialStatus: "online",
    notifications: [],
    dailyLogin: {
      lastClaimDate: "",
      streak: 0,
      totalDays: 0
    },
    prestige: 0,
    collectionRewardsClaimed: [],
    favorites: { cosmeticId: "", title: "", badgeId: "" },
    rankTier: "Unranked",
    rankDivision: 4,
    rankLP: 0,
    rankedWins: 0,
    rankedLosses: 0,
    placementMatchesPlayed: 0,
    placementWins: 0,
    rankedMatchHistory: [],
    seasonHighestTier: "Unranked",
    seasonHighestLP: 0
  };
}


function ensureGrowthFields(profile) {
  if (!profile) return;
  if (!Number.isFinite(profile.level) || profile.level < 1) profile.level = 1;
  if (!Number.isFinite(profile.xp) || profile.xp < 0) profile.xp = 0;
  if (!Number.isFinite(profile.totalXp) || profile.totalXp < 0) profile.totalXp = profile.xp || 0;
  if (!Number.isFinite(profile.levelUps) || profile.levelUps < 0) profile.levelUps = Math.max(0, profile.level - 1);
  if (!Array.isArray(profile.claimedLevelRewards)) profile.claimedLevelRewards = [];
  profile.prestige = Math.max(0, Math.floor(Number(profile.prestige) || 0));
  if (!Array.isArray(profile.collectionRewardsClaimed)) profile.collectionRewardsClaimed = [];
  if (!profile.favorites || typeof profile.favorites !== "object") profile.favorites = {};
  if (typeof profile.favorites.cosmeticId !== "string") profile.favorites.cosmeticId = "";
  if (typeof profile.favorites.title !== "string") profile.favorites.title = "";
  if (typeof profile.favorites.badgeId !== "string") profile.favorites.badgeId = "";
  if (profile.level > 100) profile.level = 100;
  ensureRankedFields(profile);
}

function getNextLevelXp(level) {
  return 100 + (Math.max(1, level) - 1) * 50;
}


const LEVEL_REWARDS = [
  { level: 2, coins: 100, title: "", itemId: "" },
  { level: 3, coins: 150, title: "", itemId: "" },
  { level: 5, coins: 300, title: "🌟 성장하는 자", itemId: "" },
  { level: 7, coins: 500, title: "", itemId: "name_green" },
  { level: 10, coins: 800, title: "⚔ 아레나 입문자", itemId: "bubble_yellow" },
  { level: 15, coins: 1200, title: "🔥 성장의 불꽃", itemId: "effect_sparkle" },
  { level: 20, coins: 2000, title: "👑 레벨 장인", itemId: "border_gold" },
  { level: 30, coins: 3500, title: "💎 성장의 왕", itemId: "name_gold" }
];

function getLevelRewardsForLevel(level) {
  return LEVEL_REWARDS.filter(reward => reward.level <= level);
}

function getNextLevelReward(profile) {
  ensureGrowthFields(profile);
  return LEVEL_REWARDS.find(reward => reward.level > profile.level) || null;
}

function claimLevelRewards(profile) {
  ensureGrowthFields(profile);
  ensureShopFields(profile);

  const claimed = [];

  for (const reward of LEVEL_REWARDS) {
    if (profile.level < reward.level) continue;
    if (profile.claimedLevelRewards.includes(reward.level)) continue;

    profile.claimedLevelRewards.push(reward.level);

    if (reward.coins) {
      profile.coins += reward.coins;
    }

    if (reward.title && !profile.titles.includes(reward.title)) {
      profile.titles.push(reward.title);
    }

    if (reward.itemId && !profile.inventory.includes(reward.itemId)) {
      profile.inventory.push(reward.itemId);
    }

    claimed.push(reward);
  }

  return claimed;
}

function ensureProfile(nickname) {
  const key = safePlayerKey(nickname);

  if (!playerData[key]) {
    playerData[key] = getDefaultProfile(key);
  }

  ensureGrowthFields(playerData[key]);
  ensureShopFields(playerData[key]);
  ensureQuestFields(playerData[key]);
  ensureSocialFields(playerData[key]);
  ensureDailyLoginFields(playerData[key]);

  return playerData[key];
}

function addXp(profile, amount) {
  ensureGrowthFields(profile);

  const baseGain = Math.max(0, Math.floor(Number(amount) || 0));
  const gain = Math.floor(baseGain * (1 + (profile.prestige || 0) * 0.1));
  const beforeLevel = profile.level;
  const beforeXp = profile.xp;
  const beforeNextXp = getNextLevelXp(profile.level);

  profile.xp += gain;
  profile.totalXp += gain;

  let levelsGained = 0;

  while (profile.level < 100 && profile.xp >= getNextLevelXp(profile.level)) {
    profile.xp -= getNextLevelXp(profile.level);
    profile.level++;
    profile.levelUps++;
    levelsGained++;
  }
  if (profile.level >= 100) profile.xp = 0;

  return {
    gain,
    baseGain,
    prestigeBonus: gain - baseGain,
    beforeLevel,
    afterLevel: profile.level,
    beforeXp,
    afterXp: profile.xp,
    beforeNextXp,
    nextXp: getNextLevelXp(profile.level),
    totalXp: profile.totalXp,
    levelsGained,
    leveledUp: levelsGained > 0
  };
}



const SHOP_ITEMS = [
  {
    id: "name_green",
    name: "🟢 초록 닉네임",
    type: "nameColor",
    rarity: "normal",
    price: 500,
    value: "#7CFF8A",
    preview: "닉네임이 초록색으로 표시됩니다."
  },
  {
    id: "name_blue",
    name: "🔵 파랑 닉네임",
    type: "nameColor",
    rarity: "normal",
    price: 700,
    value: "#7CC7FF",
    preview: "닉네임이 파란색으로 표시됩니다."
  },
  {
    id: "name_purple",
    name: "🟣 보라 닉네임",
    type: "nameColor",
    rarity: "rare",
    price: 1000,
    value: "#D69CFF",
    preview: "닉네임이 보라색으로 표시됩니다."
  },
  {
    id: "name_gold",
    name: "🟡 황금 닉네임",
    type: "nameColor",
    rarity: "epic",
    price: 3000,
    value: "#FFD700",
    preview: "닉네임이 황금색으로 표시됩니다."
  },
  {
    id: "bubble_yellow",
    name: "🟨 노랑 말풍선",
    type: "chatBubble",
    rarity: "normal",
    price: 800,
    value: "yellow",
    preview: "채팅 말풍선이 노란 느낌으로 표시됩니다."
  },
  {
    id: "bubble_blue",
    name: "🟦 파랑 말풍선",
    type: "chatBubble",
    rarity: "rare",
    price: 1200,
    value: "blue",
    preview: "채팅 말풍선이 파란 느낌으로 표시됩니다."
  },
  {
    id: "bubble_purple",
    name: "🟪 보라 말풍선",
    type: "chatBubble",
    rarity: "epic",
    price: 2000,
    value: "purple",
    preview: "채팅 말풍선이 보라 느낌으로 표시됩니다."
  },
  {
    id: "border_gold",
    name: "👑 황금 프로필 테두리",
    type: "profileBorder",
    rarity: "epic",
    price: 2500,
    value: "gold",
    preview: "프로필 카드에 황금 테두리가 표시됩니다."
  },
  {
    id: "entrance_fire",
    name: "🔥 불꽃 입장 효과",
    type: "entranceEffect",
    rarity: "rare",
    price: 1500,
    value: "fire",
    preview: "입장할 때 불꽃 메시지가 표시됩니다."
  },
  {
    id: "entrance_king",
    name: "👑 왕의 입장 효과",
    type: "entranceEffect",
    rarity: "epic",
    price: 3000,
    value: "king",
    preview: "입장할 때 특별한 왕관 메시지가 표시됩니다."
  },
  {
    id: "effect_sparkle",
    name: "✨ 반짝 이름 효과",
    type: "nameEffect",
    rarity: "rare",
    price: 1800,
    value: "sparkle",
    preview: "닉네임 양옆에 반짝 효과가 붙습니다."
  },
  {
    id: "effect_devil",
    name: "👿 지옥 이름 효과",
    type: "nameEffect",
    rarity: "legend",
    price: 5000,
    value: "devil",
    preview: "닉네임 양옆에 지옥 효과가 붙습니다."
  }
,
  {
    id: "name_rainbow",
    name: "🌈 무지개 닉네임",
    type: "nameColor",
    rarity: "legend",
    price: 6000,
    value: "rainbow",
    preview: "닉네임이 무지개 그라데이션으로 표시됩니다."
  },
  {
    id: "effect_crown",
    name: "👑 왕관 이름 효과",
    type: "nameEffect",
    rarity: "legend",
    price: 7000,
    value: "crown",
    preview: "닉네임 양옆에 왕관 효과가 붙습니다."
  }];

const COSMETIC_RARITIES = ["normal", "rare", "epic", "legend", "mythic"];
const COSMETIC_ICONS = ["✦","◆","✧","❖","✺","☄","♛","⚜","☾","☀","❄","🔥","🌊","🌸","💫","🪽","🐉","🦊","🦋","💎","👑","🌌","⚡","🪐","🎇","🛡","🔮","🗡","🏆","🌈"];
const COLOR_VALUES = ["#ff6b6b","#ff9f43","#ffd93d","#6bff95","#45e6c8","#52b8ff","#7289ff","#a66bff","#e66bff","#ff6bd6","#ffffff","#b9c6d8","#8afff3","#ffb3c8","#c9ff6b","#ff8a5b","#81a8ff","#df8cff","#f5e6a8","#8ff0ff","#ff477e","#00f5d4","#fee440","#9b5de5","#f15bb5","#00bbf9","#fb5607","#8338ec","#3a86ff","rainbow"];

function addGeneratedCosmetics() {
  const add = item => {
    if (!SHOP_ITEMS.some(existing => existing.id === item.id)) SHOP_ITEMS.push(item);
  };
  const rarityAt = index => COSMETIC_RARITIES[Math.min(4, Math.floor(index / 6))];
  const priceAt = index => [350, 900, 2200, 5200, 11000][COSMETIC_RARITIES.indexOf(rarityAt(index))] + index * 35;
  for (let i = 0; i < 30; i++) add({ id:`v26_color_${i+1}`, name:`${COSMETIC_ICONS[i]} 오로라 컬러 ${i+1}`, icon:COSMETIC_ICONS[i], type:"nameColor", rarity:rarityAt(i), price:priceAt(i), value:COLOR_VALUES[i], preview:`닉네임을 오로라 컬러 ${i+1} 스타일로 표시합니다.`, description:"V2.6 프리미엄 닉네임 컬러" });
  const groups = [
    ["bubble","chatBubble","말풍선",25],
    ["entrance","entranceEffect","입장 효과",25],
    ["victory","victoryEffect","승리 효과",25],
    ["border","profileBorder","테두리",25],
    ["background","profileBackground","프로필 배경",12],
    ["badge","profileBadge","프로필 배지",12],
    ["chatfx","chatEffect","채팅 효과",12],
    ["levelup","levelUpEffect","레벨업 효과",12]
  ];
  for (const [prefix,type,label,count] of groups) for (let i=0;i<count;i++) add({ id:`v26_${prefix}_${i+1}`, name:`${COSMETIC_ICONS[i]} ${label} ${i+1}`, icon:COSMETIC_ICONS[i], type, rarity:rarityAt(i), price:priceAt(i), value:`v26-${prefix}-${i+1}`, preview:`${label} ${i+1}의 전용 빛과 움직임을 적용합니다.`, description:`V2.6 프리미엄 ${label}` });
  for (let i=0;i<40;i++) {
    const rarity = COSMETIC_RARITIES[Math.min(4, Math.floor(i / 8))];
    add({ id:`v26_title_${i+1}`, name:`${COSMETIC_ICONS[i%30]} 아레나 칭호 ${i+1}`, icon:COSMETIC_ICONS[i%30], type:"title", rarity, price:[300,800,1800,4500,9500][COSMETIC_RARITIES.indexOf(rarity)] + i*30, value:`${COSMETIC_ICONS[i%30]} 아레나의 전설 ${i+1}`, preview:`프로필에 표시할 수 있는 아레나 칭호 ${i+1}입니다.`, description:"V2.6 수집형 프리미엄 칭호" });
  }
}
addGeneratedCosmetics();

const LEGACY_COSMETICS = [
  ["profile_bg_midnight","🌙 자정 배경","profileBackground","legend","midnight"],
  ["profile_bg_ocean","🌊 심해 배경","profileBackground","rare","ocean"],
  ["profile_bg_flame","🔥 화염 배경","profileBackground","epic","flame"],
  ["profile_bg_royal","👑 왕실 배경","profileBackground","legend","royal"],
  ["border_diamond","💎 다이아 테두리","profileBorder","legend","diamond"],
  ["border_neon","⚡ 네온 테두리","profileBorder","epic","neon"],
  ["border_rainbow","🌈 무지개 테두리","profileBorder","mythic","rainbow"],
  ["badge_wins","🏆 승리 배지","profileBadge","rare","wins"],
  ["badge_streak","🔥 연승 배지","profileBadge","epic","streak"],
  ["badge_level","⭐ 레벨 배지","profileBadge","epic","level"],
  ["badge_veteran","⚔ 베테랑 배지","profileBadge","legend","veteran"],
  ["chat_fx_spark","✨ 반짝 채팅","chatEffect","rare","spark"],
  ["chat_fx_flame","🔥 화염 채팅","chatEffect","epic","flame"],
  ["chat_fx_lightning","⚡ 번개 채팅","chatEffect","legend","lightning"],
  ["chat_fx_rainbow","🌈 무지개 채팅","chatEffect","mythic","rainbow"],
  ["victory_fx_gold","🏆 황금 승리","victoryEffect","epic","gold"],
  ["victory_fx_royal","👑 왕실 승리","victoryEffect","legend","royal"],
  ["victory_fx_rainbow","🌈 무지개 승리","victoryEffect","mythic","rainbow"],
  ["levelup_fx_star","⭐ 별빛 레벨업","levelUpEffect","rare","star"],
  ["levelup_fx_burst","💥 폭발 레벨업","levelUpEffect","epic","burst"]
];
for (const [id,name,type,rarity,value] of LEGACY_COSMETICS) {
  if (!SHOP_ITEMS.some(item => item.id === id)) SHOP_ITEMS.push({
    id, name, icon:[...name][0], type, rarity, value,
    price:{normal:500,rare:1200,epic:2800,legend:6000,mythic:12000}[rarity],
    preview:`${name}의 프리미엄 시각 효과를 적용합니다.`,
    description:"기존 플레이어 호환 프리미엄 코스메틱"
  });
}

const COLLECTION_EXCLUSIVES = [
  { id:"collection_title_master",name:"🏛 컬렉션 마스터",icon:"🏛",type:"title",rarity:"mythic",value:"🏛 컬렉션 마스터" },
  { id:"collection_border_master",name:"💠 완성자의 테두리",icon:"💠",type:"profileBorder",rarity:"mythic",value:"collection-master" },
  { id:"collection_badge_master",name:"🌟 완성자의 배지",icon:"🌟",type:"profileBadge",rarity:"mythic",value:"collection-master" },
  { id:"collection_bg_master",name:"🌌 완성자의 배경",icon:"🌌",type:"profileBackground",rarity:"mythic",value:"collection-master" },
  { id:"collection_mythic_aura",name:"🪐 궁극의 신화 오라",icon:"🪐",type:"chatEffect",rarity:"mythic",value:"collection-master" },
  { id:"prestige_badge",name:"♛ 프레스티지 배지",icon:"♛",type:"profileBadge",rarity:"mythic",value:"prestige" },
  { id:"prestige_border",name:"🔱 프레스티지 테두리",icon:"🔱",type:"profileBorder",rarity:"mythic",value:"prestige" },
  { id:"prestige_frame",name:"✨ 프레스티지 프레임",icon:"✨",type:"profileBackground",rarity:"mythic",value:"prestige" }
];
for (const item of COLLECTION_EXCLUSIVES) if (!SHOP_ITEMS.some(existing => existing.id === item.id)) SHOP_ITEMS.push({
  ...item, price:0, minLevel:1, tag:"한정", collectionExclusive:true,
  preview:`${item.name} 전용 프레스티지 컬렉션 효과입니다.`,
  description:"상점에서 구매할 수 없는 업적 전용 코스메틱"
});

const BOX_TYPES = {
  common: {
    name: "일반 상자",
    price: 100,
    icon: "📦", color: "#b8c4d6", pity: 10, cosmeticChance: 0.08,
    coinRange: [40, 120], xpRange: [20, 70],
    itemRarities: { normal: 85, rare: 15 }
  },
  rare: {
    name: "희귀 상자",
    price: 500,
    icon: "💎", color: "#62b8ff", pity: 10, cosmeticChance: 0.18,
    coinRange: [180, 550], xpRange: [90, 260],
    itemRarities: { normal: 45, rare: 45, epic: 10 }
  },
  epic: {
    name: "영웅 상자",
    price: 2000,
    icon: "🔮", color: "#c479ff", pity: 15, cosmeticChance: 0.3,
    coinRange: [700, 2200], xpRange: [350, 900],
    itemRarities: { rare: 45, epic: 45, legend: 10 }
  },
  legendary: {
    name: "전설 상자",
    price: 10000,
    icon: "👑", color: "#ffd54a", pity: 20, cosmeticChance: 0.5,
    coinRange: [3500, 11000], xpRange: [1500, 4000],
    itemRarities: { epic: 35, legend: 50, mythic: 15 }
  }
};


function enhanceShopItems() {
  const meta = {
    name_green: { minLevel: 1, tag: "기본 추천" },
    name_blue: { minLevel: 3, tag: "인기" },
    name_purple: { minLevel: 5, tag: "희귀" },
    name_gold: { minLevel: 12, tag: "고급" },
    bubble_yellow: { minLevel: 2, tag: "추천" },
    bubble_blue: { minLevel: 6, tag: "인기" },
    bubble_purple: { minLevel: 10, tag: "영웅" },
    border_gold: { minLevel: 15, tag: "고급" },
    entrance_fire: { minLevel: 8, tag: "인기" },
    entrance_king: { minLevel: 18, tag: "전설" },
    effect_sparkle: { minLevel: 7, tag: "추천" },
    effect_devil: { minLevel: 20, tag: "전설" },
    name_rainbow: { minLevel: 25, tag: "신화" },
    effect_crown: { minLevel: 30, tag: "신화" }
  };

  for (const item of SHOP_ITEMS) {
    const extra = meta[item.id] || {};
    item.minLevel = extra.minLevel || 1;
    item.tag = extra.tag || item.tag || "";
  }
}

enhanceShopItems();

function rarityLabel(rarity) {
  if (rarity === "normal") return "⚪ 일반";
  if (rarity === "rare") return "🔵 희귀";
  if (rarity === "epic") return "🟣 영웅";
  if (rarity === "legend") return "🟠 전설";
  if (rarity === "mythic") return "🔴 신화";
  return "⚪ 일반";
}

function ensureShopFields(profile) {
  if (!Array.isArray(profile.inventory)) profile.inventory = [];
  if (!profile.equipped) {
    profile.equipped = {
      nameColor: "default",
      chatBubble: "default",
      profileBorder: "default",
      entranceEffect: "default",
      nameEffect: "default"
    };
  }
  for (const type of ["nameColor","chatBubble","profileBorder","entranceEffect","nameEffect","profileBackground","profileBadge","chatEffect","victoryEffect","levelUpEffect"]) {
    if (!profile.equipped[type]) profile.equipped[type] = "default";
    if (profile.equipped[type] !== "default" && !SHOP_ITEMS.some(item => item.id === profile.equipped[type] && item.type === type)) {
      profile.equipped[type] = "default";
    }
  }
  if (!profile.boxes && profile.equipped.boxes) profile.boxes = profile.equipped.boxes;
  if (!profile.boxPity && profile.equipped.boxPity) profile.boxPity = profile.equipped.boxPity;
  delete profile.equipped.boxes;
  delete profile.equipped.boxPity;

  if (!profile.boxes || typeof profile.boxes !== "object") profile.boxes = {};
  if (!profile.boxPity || typeof profile.boxPity !== "object") profile.boxPity = {};

  for (const type of Object.keys(BOX_TYPES)) {
    profile.boxes[type] = Math.max(0, Math.floor(Number(profile.boxes[type]) || 0));
    profile.boxPity[type] = Math.max(
      0,
      Math.min(Math.floor(Number(profile.boxPity[type]) || 0), BOX_TYPES[type].pity - 1)
    );
  }
}

function pickBoxCosmetic(profile, box) {
  const targetRarity = weightedPick(box.itemRarities);
  const order = ["normal", "rare", "epic", "legend", "mythic"];
  const targetIndex = order.indexOf(targetRarity);
  let candidates = SHOP_ITEMS.filter(item => item.rarity === targetRarity && !item.collectionExclusive);
  if (!candidates.length) {
    candidates = SHOP_ITEMS.filter(item => order.indexOf(item.rarity) <= targetIndex && !item.collectionExclusive);
  }
  const unowned = candidates.filter(item => !profile.inventory.includes(item.id));
  const pool = unowned.length ? unowned : candidates;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function openRandomBox(profile, boxType) {
  ensureGrowthFields(profile);
  ensureShopFields(profile);
  const box = BOX_TYPES[boxType];
  if (!box) return null;

  const pityBefore = profile.boxPity[boxType];
  const pityTriggered = pityBefore + 1 >= box.pity;

  if (pityTriggered || Math.random() < box.cosmeticChance) {
    const item = pickBoxCosmetic(profile, box);
    if (item) {
      profile.boxPity[boxType] = 0;
      const duplicate = profile.inventory.includes(item.id);
      const duplicateCoins = duplicate ? Math.max(50, Math.floor(item.price * 0.35)) : 0;
      if (duplicate) profile.coins += duplicateCoins;
      else {
        profile.inventory.push(item.id);
        if (item.type === "title" && !profile.titles.includes(item.value)) profile.titles.push(item.value);
      }
      return {
        kind: "item", boxType, duplicate, duplicateCoins, pityTriggered,
        pity: 0, pityLimit: box.pity,
        item: {
          id: item.id, name: item.name, rarity: item.rarity,
          rarityLabel: rarityLabel(item.rarity)
        }
      };
    }
  }

  profile.boxPity[boxType] = Math.min(box.pity - 1, pityBefore + 1);
  const kind = Math.random() < 0.55 ? "coins" : "xp";
  if (kind === "coins") {
    const amount = randomInteger(...box.coinRange);
    profile.coins += amount;
    return { kind, boxType, amount, pity: profile.boxPity[boxType], pityLimit: box.pity };
  }

  const amount = randomInteger(...box.xpRange);
  const xpResult = addXp(profile, amount);
  const levelRewards = claimLevelRewards(profile);
  return {
    kind, boxType, amount, xpResult, levelRewards,
    pity: profile.boxPity[boxType], pityLimit: box.pity
  };
}

function getShopItem(id) {
  return SHOP_ITEMS.find(item => item.id === id);
}

function getEquippedItem(profile, type) {
  ensureShopFields(profile);
  const id = profile.equipped[type];
  return SHOP_ITEMS.find(item => item.id === id) || null;
}

function decorateNickname(profile) {
  if (!profile) return "";

  ensureShopFields(profile);

  let name = profile.nickname;

  const effect = getEquippedItem(profile, "nameEffect");

  if (effect && effect.value === "sparkle") {
    name = `✨ ${name} ✨`;
  } else if (effect && effect.value === "devil") {
    name = `👿 ${name} 👿`;
  } else if (effect && effect.value === "crown") {
    name = `👑 ${name} 👑`;
  }

  return name;
}

function publicShopProfile(nickname) {
  const profile = ensureProfile(nickname);
  ensureShopFields(profile);
  const boxCatalog = Object.entries(BOX_TYPES).map(([id, box]) => ({
    id,
    name: box.name,
    price: box.price,
    icon: box.icon,
    color: box.color,
    pityLimit: box.pity,
    cosmeticChance: Math.round(box.cosmeticChance * 100),
    coinRange: box.coinRange,
    xpRange: box.xpRange,
    owned: profile.boxes[id],
    pity: profile.boxPity[id]
  }));

  return {
    level: profile.level,
    coins: profile.coins,
    inventory: profile.inventory || [],
    equipped: profile.equipped || {},
    selectedTitle: profile.selectedTitle || "",
    boxes: profile.boxes,
    boxPity: profile.boxPity,
    boxCatalog,
    boxTypes: boxCatalog,
    items: SHOP_ITEMS.map(item => ({
      ...item,
      rarityLabel: rarityLabel(item.rarity),
      locked: profile.level < (item.minLevel || 1),
      owned: (profile.inventory || []).includes(item.id),
      equipped: item.type === "title"
        ? profile.selectedTitle === item.value
        : profile.equipped && profile.equipped[item.type] === item.id,
      exclusive: !!item.collectionExclusive
    }))
  };
}

const COLLECTION_CATEGORIES = [
  ["nameColor","닉네임 컬러"],["nameEffect","닉네임 효과"],["chatBubble","채팅 말풍선"],["chatEffect","채팅 효과"],
  ["entranceEffect","입장 효과"],["victoryEffect","승리 효과"],["profileBorder","테두리"],
  ["profileBackground","프로필 배경"],["profileBadge","배지"],["title","칭호"],["levelUpEffect","레벨업 효과"]
];
const COLLECTION_MILESTONES = [
  { percent:25, reward:{ coins:2000 }, label:"2,000 코인" },
  { percent:50, reward:{ xp:2500 }, label:"2,500 XP" },
  { percent:75, reward:{ box:"rare", amount:2 }, label:"희귀 상자 2개" },
  { percent:100, reward:{ itemIds:COLLECTION_EXCLUSIVES.slice(0,5).map(item=>item.id), title:"🏛 컬렉션 마스터" }, label:"한정 신화 세트" }
];

function collectionItems() {
  return SHOP_ITEMS.filter(item => COLLECTION_CATEGORIES.some(([type]) => type === item.type));
}

function publicCollection(profile, includeItems = true) {
  ensureShopFields(profile);
  const all = collectionItems();
  const eligible = all.filter(item => !item.collectionExclusive);
  const ownedEligible = eligible.filter(item => profile.inventory.includes(item.id));
  const percent = eligible.length ? Math.floor(ownedEligible.length / eligible.length * 100) : 0;
  const categories = COLLECTION_CATEGORIES.map(([type,label]) => {
    const items = all.filter(item => item.type === type);
    const completionItems = items.filter(item => !item.collectionExclusive);
    const collected = completionItems.filter(item => profile.inventory.includes(item.id)).length;
    const rarityStats = {};
    for (const rarity of COSMETIC_RARITIES) rarityStats[rarity] = {
      owned:items.filter(item=>item.rarity===rarity && profile.inventory.includes(item.id)).length,
      total:items.filter(item=>item.rarity===rarity).length
    };
    return {
      type,label,collected,total:completionItems.length,
      percent:completionItems.length ? Math.floor(collected/completionItems.length*100) : 0,
      rarityStats,
      items:includeItems ? items.map(item=>({
        id:item.id,name:item.name,icon:item.icon||"🎁",rarity:item.rarity,
        rarityLabel:rarityLabel(item.rarity),owned:profile.inventory.includes(item.id),
        exclusive:!!item.collectionExclusive,preview:item.preview||""
      })) : []
    };
  });
  return {
    collected:ownedEligible.length,total:eligible.length,percent,categories,
    milestones:COLLECTION_MILESTONES.map(milestone=>({
      percent:milestone.percent,label:milestone.label,
      unlocked:percent>=milestone.percent,
      claimed:profile.collectionRewardsClaimed.includes(milestone.percent)
    }))
  };
}

function grantCollectionReward(profile, milestone) {
  const granted = grantReward(profile, milestone.reward);
  for (const itemId of milestone.reward.itemIds || []) {
    const item = getShopItem(itemId);
    if (item && !profile.inventory.includes(itemId)) profile.inventory.push(itemId);
  }
  return granted.concat((milestone.reward.itemIds || []).map(id=>getShopItem(id)?.name).filter(Boolean));
}

const QUEST_DEFINITIONS = [
  { id: "starter_play_1", category: "starter", name: "첫 아레나", desc: "게임 1회 플레이", stat: "games", target: 1, reward: { coins: 150, xp: 50 } },
  { id: "starter_words_10", category: "starter", name: "말잇기 입문", desc: "단어 10개 입력", stat: "words", target: 10, reward: { box: "common", amount: 1 } },
  { id: "daily_play_1", category: "daily", name: "오늘의 첫 경기", desc: "게임 1회 플레이", stat: "games", target: 1, reward: { coins: 120, xp: 40 } },
  { id: "daily_win_3", category: "daily", name: "오늘의 승부사", desc: "게임 3회 승리", stat: "wins", target: 3, reward: { box: "rare", amount: 1 } },
  { id: "daily_words_30", category: "daily", name: "오늘의 단어 수집", desc: "단어 30개 입력", stat: "words", target: 30, reward: { coins: 350 } },
  { id: "weekly_play_10", category: "weekly", name: "주간 도전자", desc: "게임 10회 플레이", stat: "games", target: 10, reward: { box: "rare", amount: 2 } },
  { id: "weekly_win_20", category: "weekly", name: "주간 챔피언", desc: "게임 20회 승리", stat: "wins", target: 20, reward: { coins: 2500, xp: 1000 } },
  { id: "weekly_xp_1000", category: "weekly", name: "성장의 일주일", desc: "경험치 1,000 획득", stat: "xp", target: 1000, reward: { box: "epic", amount: 1 } },
  { id: "achievement_words_100", category: "achievement", name: "백 마디의 달인", desc: "누적 단어 100개 입력", stat: "words", target: 100, reward: { itemId: "name_blue", title: "📘 백 마디의 달인" } },
  { id: "achievement_games_100", category: "achievement", name: "아레나 베테랑", desc: "누적 게임 100회 플레이", stat: "games", target: 100, reward: { box: "legendary", amount: 1, title: "⚔ 아레나 베테랑" } }
];

const DAILY_LOGIN_REWARDS = Array.from({ length: 30 }, (_, index) => {
  const day = index + 1;
  if (day === 30) return { day, box: "legendary", amount: 1, label: "전설 상자 1개" };
  if (day % 7 === 0) return { day, box: "rare", amount: 1, label: "희귀 상자 1개" };
  if (day % 5 === 0) return { day, box: "common", amount: 2, label: "일반 상자 2개" };
  if (day % 2 === 0) return { day, xp: 100 + day * 10, label: `${100 + day * 10} XP` };
  return { day, coins: 150 + day * 25, label: `${150 + day * 25} 코인` };
});

function koreaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function koreaWeekKey(date = new Date()) {
  const key = koreaDateKey(date);
  const utc = new Date(`${key}T00:00:00Z`);
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return koreaDateKey(utc);
}

function emptyQuestStats() {
  return { games: 0, wins: 0, words: 0, xp: 0 };
}

function ensureQuestFields(profile) {
  if (!profile.quests || typeof profile.quests !== "object") profile.quests = {};
  const dailyKey = koreaDateKey();
  const weeklyKey = koreaWeekKey();
  if (profile.quests.dailyKey !== dailyKey) {
    profile.quests.dailyKey = dailyKey;
    profile.quests.dailyStats = emptyQuestStats();
  }
  if (profile.quests.weeklyKey !== weeklyKey) {
    profile.quests.weeklyKey = weeklyKey;
    profile.quests.weeklyStats = emptyQuestStats();
  }
  if (!profile.quests.dailyStats) profile.quests.dailyStats = emptyQuestStats();
  if (!profile.quests.weeklyStats) profile.quests.weeklyStats = emptyQuestStats();
  if (!Array.isArray(profile.quests.claimed)) profile.quests.claimed = [];
  profile.quests.claimed = profile.quests.claimed.filter(entry => {
    if (entry.startsWith("daily:")) return entry.startsWith(`daily:${dailyKey}:`);
    if (entry.startsWith("weekly:")) return entry.startsWith(`weekly:${weeklyKey}:`);
    return true;
  });
}

function ensureSocialFields(profile) {
  if (!Array.isArray(profile.friends)) profile.friends = [];
  if (!Array.isArray(profile.friendRequests)) profile.friendRequests = [];
  if (!Array.isArray(profile.blockedPlayers)) profile.blockedPlayers = [];
  if (!Array.isArray(profile.favoriteFriends)) profile.favoriteFriends = [];
  if (!Array.isArray(profile.notifications)) profile.notifications = [];
  if (!["online","dnd"].includes(profile.socialStatus)) profile.socialStatus = "online";
  profile.friends = [...new Set(profile.friends.filter(name => name && name !== profile.nickname))];
  profile.friendRequests = [...new Set(profile.friendRequests.filter(name => name && name !== profile.nickname))];
  profile.blockedPlayers = [...new Set(profile.blockedPlayers.filter(name => name && name !== profile.nickname))];
  profile.favoriteFriends = [...new Set(profile.favoriteFriends.filter(name => profile.friends.includes(name)))];
  profile.notifications = profile.notifications.slice(-100);
}

function ensureDailyLoginFields(profile) {
  if (!profile.dailyLogin || typeof profile.dailyLogin !== "object") profile.dailyLogin = {};
  if (typeof profile.dailyLogin.lastClaimDate !== "string") profile.dailyLogin.lastClaimDate = "";
  profile.dailyLogin.streak = Math.max(0, Math.floor(Number(profile.dailyLogin.streak) || 0));
  profile.dailyLogin.totalDays = Math.max(0, Math.floor(Number(profile.dailyLogin.totalDays) || 0));
}

function questClaimKey(quest, profile) {
  if (quest.category === "daily") return `daily:${profile.quests.dailyKey}:${quest.id}`;
  if (quest.category === "weekly") return `weekly:${profile.quests.weeklyKey}:${quest.id}`;
  return `${quest.category}:${quest.id}`;
}

function questValue(profile, quest) {
  if (quest.category === "daily") return Number(profile.quests.dailyStats[quest.stat]) || 0;
  if (quest.category === "weekly") return Number(profile.quests.weeklyStats[quest.stat]) || 0;
  if (quest.stat === "words") return profile.wordsUsed || 0;
  if (quest.stat === "games") return profile.games || 0;
  if (quest.stat === "wins") return profile.wins || 0;
  if (quest.stat === "xp") return profile.totalXp || 0;
  return 0;
}

function publicQuestData(profile) {
  ensureQuestFields(profile);
  return {
    dailyKey: profile.quests.dailyKey,
    weeklyKey: profile.quests.weeklyKey,
    quests: QUEST_DEFINITIONS.map(quest => {
      const value = Math.min(quest.target, questValue(profile, quest));
      const claimed = profile.quests.claimed.includes(questClaimKey(quest, profile));
      return {
        ...quest, value, claimed,
        completed: value >= quest.target,
        percent: Math.min(100, Math.floor((value / quest.target) * 100))
      };
    })
  };
}

function recordQuestProgress(profile, gains) {
  ensureQuestFields(profile);
  for (const stat of ["games", "wins", "words", "xp"]) {
    const amount = Math.max(0, Math.floor(Number(gains[stat]) || 0));
    profile.quests.dailyStats[stat] += amount;
    profile.quests.weeklyStats[stat] += amount;
  }
}

function grantReward(profile, reward) {
  ensureShopFields(profile);
  const granted = [];
  if (reward.coins) {
    profile.coins += reward.coins;
    granted.push(`${reward.coins} 코인`);
  }
  if (reward.xp) {
    addXp(profile, reward.xp);
    claimLevelRewards(profile);
    granted.push(`${reward.xp} XP`);
  }
  if (reward.box && BOX_TYPES[reward.box]) {
    const amount = Math.max(1, Math.floor(Number(reward.amount) || 1));
    profile.boxes[reward.box] += amount;
    granted.push(`${BOX_TYPES[reward.box].name} ${amount}개`);
  }
  if (reward.itemId && getShopItem(reward.itemId) && !profile.inventory.includes(reward.itemId)) {
    profile.inventory.push(reward.itemId);
    granted.push(getShopItem(reward.itemId).name);
  }
  if (reward.title && !profile.titles.includes(reward.title)) {
    profile.titles.push(reward.title);
    granted.push(`칭호 ${reward.title}`);
  }
  return granted;
}

function publicDailyLogin(profile) {
  ensureDailyLoginFields(profile);
  const today = koreaDateKey();
  const nextDay = (profile.dailyLogin.totalDays % 30) + 1;
  const claimedDay = profile.dailyLogin.totalDays > 0
    ? ((profile.dailyLogin.totalDays - 1) % 30) + 1
    : 0;
  return {
    canClaim: profile.dailyLogin.lastClaimDate !== today,
    streak: profile.dailyLogin.streak,
    totalDays: profile.dailyLogin.totalDays,
    nextDay,
    rewards: DAILY_LOGIN_REWARDS,
    today: profile.dailyLogin.lastClaimDate === today ? claimedDay : nextDay
  };
}

function socketForNickname(nickname) {
  return [...io.sockets.sockets.values()].find(client => client.connected && client.data.nickname === nickname) || null;
}

function presenceForNickname(nickname) {
  const profile=playerData[nickname] ? ensureProfile(nickname) : null;
  const client=socketForNickname(nickname);
  if (!client) return "offline";
  if (profile && profile.socialStatus==="dnd") return "dnd";
  const room=client.data.roomCode && rooms[client.data.roomCode];
  const player=room && findPlayer(room,client.data.playerId);
  if (player?.isSpectator) return "spectating";
  if (room?.status==="playing") return "match";
  if (room) return "room";
  return "lobby";
}

function pushNotification(nickname,type,text,data={}) {
  if (!playerData[nickname]) return;
  const profile=ensureProfile(nickname);
  const notification={id:makeToken().slice(0,12),type,text:String(text).slice(0,220),data,time:Date.now(),read:false};
  profile.notifications.push(notification);
  profile.notifications=profile.notifications.slice(-100);
  savePlayerData();
  const client=socketForNickname(nickname);
  if (client) client.emit("socialNotification",notification);
}

function publicFriendsData(profile) {
  ensureSocialFields(profile);
  return {
    count: profile.friends.length,
    requests: profile.friendRequests.slice(),
    blocked: profile.blockedPlayers.slice(),
    friends: profile.friends.map(nickname => {
      const friendSocket = socketForNickname(nickname);
      return {
        nickname,
        online: !!friendSocket,
        status: presenceForNickname(nickname),
        favorite: profile.favoriteFriends.includes(nickname),
        roomCode: friendSocket && friendSocket.data.roomCode ? friendSocket.data.roomCode : "",
        inRoom: !!(friendSocket && friendSocket.data.roomCode)
      };
    }).sort((a,b)=>(Number(b.favorite)-Number(a.favorite))||a.nickname.localeCompare(b.nickname,"ko"))
  };
}

function emitFriendsData(nickname) {
  const targetSocket = socketForNickname(nickname);
  if (targetSocket && playerData[nickname]) {
    targetSocket.emit("friendsData", publicFriendsData(ensureProfile(nickname)));
  }
}

function broadcastFriendPresence(nickname) {
  const profile = playerData[nickname];
  if (!profile) return;
  ensureSocialFields(profile);
  for (const friend of profile.friends) emitFriendsData(friend);
}

function ownedRoomForSocket(socket) {
  const room=rooms[socket.data.roomCode];
  return room&&room.hostId===socket.data.playerId ? room : null;
}

function emitPremiumData(socket) {
  const nickname = socket.data.nickname;
  if (!nickname) return;
  const profile = ensureProfile(nickname);
  socket.emit("questData", publicQuestData(profile));
  socket.emit("friendsData", publicFriendsData(profile));
  socket.emit("dailyLoginData", publicDailyLogin(profile));
  socket.emit("notificationData",{items:profile.notifications.slice().reverse(),unread:profile.notifications.filter(item=>!item.read).length});
  broadcastFriendPresence(nickname);
  if (!socket.data.presenceAnnounced && profile.socialStatus!=="dnd") {
    socket.data.presenceAnnounced=true;
    for (const friend of profile.friends) pushNotification(friend,"friend_online",`${nickname}님이 온라인입니다.`,{nickname});
  }
}

function publicStyleForNickname(nickname) {
  const profile = ensureProfile(nickname);
  ensureShopFields(profile);

  const nameColor = getEquippedItem(profile, "nameColor");
  const chatBubble = getEquippedItem(profile, "chatBubble");
  const profileBorder = getEquippedItem(profile, "profileBorder");
  const entranceEffect = getEquippedItem(profile, "entranceEffect");
  const nameEffect = getEquippedItem(profile, "nameEffect");
  const victoryEffect = getEquippedItem(profile, "victoryEffect");
  const profileBackground = getEquippedItem(profile, "profileBackground");
  const profileBadge = getEquippedItem(profile, "profileBadge");
  const chatEffect = getEquippedItem(profile, "chatEffect");
  const levelUpEffect = getEquippedItem(profile, "levelUpEffect");

  return {
    displayName: decorateNickname(profile),
    nameColor: nameColor && nameColor.value !== "rainbow" ? nameColor.value : "",
    nameGradient: nameColor && nameColor.value === "rainbow" ? "rainbow" : "",
    chatBubble: chatBubble ? chatBubble.value : "",
    profileBorder: profileBorder ? profileBorder.value : "",
    entranceEffect: entranceEffect ? entranceEffect.value : "",
    nameEffect: nameEffect ? nameEffect.value : "",
    victoryEffect: victoryEffect ? victoryEffect.value : "",
    profileBackground: profileBackground ? profileBackground.value : "",
    profileBadge: profileBadge ? profileBadge.value : "",
    profileBadgeIcon: profileBadge ? profileBadge.icon : "",
    chatEffect: chatEffect ? chatEffect.value : "",
    levelUpEffect: levelUpEffect ? levelUpEffect.value : ""
  };
}

function entranceMessage(nickname) {
  const profile = ensureProfile(nickname);
  const effect = getEquippedItem(profile, "entranceEffect");
  const displayName = decorateNickname(profile);

  if (!effect) return `✅ ${displayName}님 입장했습니다.`;
  if (effect.value === "fire") return `🔥 ${displayName}님이 불꽃처럼 입장했습니다!`;
  if (effect.value === "king") return `👑 ${displayName}님이 왕처럼 등장했습니다!`;
  if (String(effect.value).startsWith("v26-entrance-")) return `${effect.icon || "✨"} ${displayName}님이 프리미엄 오라와 함께 입장했습니다!`;

  return `✅ ${displayName}님 입장했습니다.`;
}

function buyShopItem(nickname, itemId) {
  const profile = ensureProfile(nickname);
  ensureShopFields(profile);

  const item = getShopItem(itemId);

  if (!item) {
    return { ok: false, message: "존재하지 않는 아이템입니다." };
  }
  if (item.collectionExclusive) return { ok:false, message:"컬렉션 또는 프레스티지 보상 전용 아이템입니다." };

  if (profile.inventory.includes(item.id)) {
    return { ok: false, message: "이미 보유한 아이템입니다." };
  }

  if (profile.level < (item.minLevel || 1)) {
    return { ok: false, message: `레벨이 부족합니다. Lv.${item.minLevel}부터 구매할 수 있습니다.` };
  }

  if (profile.coins < item.price) {
    return { ok: false, message: `코인이 부족합니다. 필요 코인: ${item.price}` };
  }

  profile.coins -= item.price;
  profile.inventory.push(item.id);
  if (item.type === "title" && !profile.titles.includes(item.value)) profile.titles.push(item.value);

  savePlayerData();

  return { ok: true, message: `${item.name} 구매 완료!`, item };
}

function equipShopItem(nickname, itemId) {
  const profile = ensureProfile(nickname);
  ensureShopFields(profile);

  const item = getShopItem(itemId);

  if (!item) {
    return { ok: false, message: "존재하지 않는 아이템입니다." };
  }

  if (!profile.inventory.includes(item.id)) {
    return { ok: false, message: "보유하지 않은 아이템입니다." };
  }

  if (item.type === "title") {
    if (!profile.titles.includes(item.value)) profile.titles.push(item.value);
    profile.selectedTitle = item.value;
  } else {
    profile.equipped[item.type] = item.id;
  }

  savePlayerData();

  return { ok: true, message: `${item.name} 장착 완료!`, item };
}

function unequipShopType(nickname, type) {
  const profile = ensureProfile(nickname);
  ensureShopFields(profile);

  if (type === "title") {
    profile.selectedTitle = profile.titles[0] || "";
    savePlayerData();
    return { ok: true, message: "칭호 장착 해제 완료!" };
  }

  if (!profile.equipped[type]) {
    return { ok: false, message: "해제할 아이템이 없습니다." };
  }

  profile.equipped[type] = "default";

  savePlayerData();

  return { ok: true, message: "장착 해제 완료!" };
}

const ACHIEVEMENTS = [
  {
    id: "first_win",
    name: "🏆 첫 승",
    desc: "처음으로 1승 달성",
    rarity: "normal",
    target: 1,
    xp: 100,
    coins: 100,
    title: "🏆 첫 승",
    getValue: p => p.wins
  },
  {
    id: "games_10",
    name: "🎮 게임 10판",
    desc: "게임 10판 플레이",
    rarity: "normal",
    target: 10,
    xp: 150,
    coins: 150,
    title: "🎮 꾸준한 도전자",
    getValue: p => p.games
  },
  {
    id: "words_100",
    name: "📚 단어 100개",
    desc: "단어 100개 사용",
    rarity: "normal",
    target: 100,
    xp: 200,
    coins: 200,
    title: "📚 단어 수집가",
    getValue: p => p.wordsUsed
  },
  {
    id: "streak_3",
    name: "🔥 3연승",
    desc: "최고 3연승 달성",
    rarity: "rare",
    target: 3,
    xp: 250,
    coins: 300,
    title: "🔥 연승러",
    getValue: p => p.bestWinStreak
  },
  {
    id: "streak_5",
    name: "🔥 5연승",
    desc: "최고 5연승 달성",
    rarity: "rare",
    target: 5,
    xp: 400,
    coins: 600,
    title: "🔥 불꽃 연승",
    getValue: p => p.bestWinStreak
  },
  {
    id: "wins_10",
    name: "👑 10승",
    desc: "10승 달성",
    rarity: "rare",
    target: 10,
    xp: 500,
    coins: 800,
    title: "👑 끝말장인",
    getValue: p => p.wins
  },
  {
    id: "words_1000",
    name: "📖 단어 1000개",
    desc: "단어 1000개 사용",
    rarity: "epic",
    target: 1000,
    xp: 1000,
    coins: 1500,
    title: "📖 단어왕",
    getValue: p => p.wordsUsed
  },
  {
    id: "wins_50",
    name: "🏅 50승",
    desc: "50승 달성",
    rarity: "epic",
    target: 50,
    xp: 1500,
    coins: 2500,
    title: "🏅 승리 수집가",
    getValue: p => p.wins
  },
  {
    id: "streak_10",
    name: "⚡ 10연승",
    desc: "최고 10연승 달성",
    rarity: "epic",
    target: 10,
    xp: 1600,
    coins: 3000,
    title: "⚡ 무패 질주",
    getValue: p => p.bestWinStreak
  },
  {
    id: "wins_100",
    name: "💯 100승",
    desc: "100승 달성",
    rarity: "legend",
    target: 100,
    xp: 3000,
    coins: 5000,
    title: "💯 백전백승",
    getValue: p => p.wins
  }
];

function ensureAchievementFields(profile) {
  if (!profile.achievements) profile.achievements = [];
  if (!profile.achievementRewardsClaimed) profile.achievementRewardsClaimed = [];
  if (!profile.titles) profile.titles = ["🌱 초보자"];
  if (!profile.selectedTitle) profile.selectedTitle = "🌱 초보자";
}

function grantAchievement(profile, achievement) {
  ensureAchievementFields(profile);

  if (profile.achievements.includes(achievement.id)) return null;

  profile.achievements.push(achievement.id);

  let leveledUp = false;

  if (!profile.achievementRewardsClaimed.includes(achievement.id)) {
    profile.achievementRewardsClaimed.push(achievement.id);
    const xpResult = addXp(profile, achievement.xp);
    leveledUp = xpResult.leveledUp;
    profile.coins += achievement.coins;
  }

  if (achievement.title && !profile.titles.includes(achievement.title)) {
    profile.titles.push(achievement.title);
  }

  return {
    id: achievement.id,
    name: achievement.name,
    desc: achievement.desc,
    rarity: achievement.rarity,
    xp: achievement.xp,
    coins: achievement.coins,
    title: achievement.title,
    leveledUp
  };
}

function checkAchievements(profile) {
  ensureAchievementFields(profile);

  const unlocked = [];

  for (const achievement of ACHIEVEMENTS) {
    const value = achievement.getValue(profile);

    if (value >= achievement.target && !profile.achievements.includes(achievement.id)) {
      const result = grantAchievement(profile, achievement);
      if (result) unlocked.push(result);
    }
  }

  return unlocked;
}

function getAchievementProgress(profile) {
  ensureAchievementFields(profile);

  return ACHIEVEMENTS.map(achievement => {
    const value = achievement.getValue(profile);
    const unlocked = profile.achievements.includes(achievement.id);

    return {
      id: achievement.id,
      name: achievement.name,
      desc: achievement.desc,
      rarity: achievement.rarity,
      value: Math.min(value, achievement.target),
      target: achievement.target,
      percent: Math.min(100, Math.floor((value / achievement.target) * 100)),
      unlocked,
      xp: achievement.xp,
      coins: achievement.coins,
      title: achievement.title
    };
  });
}

function updateTitles(profile) {
  ensureAchievementFields(profile);

  if (profile.wins >= 1 && !profile.titles.includes("🏆 첫 승")) {
    profile.titles.push("🏆 첫 승");
  }

  if (profile.wordsUsed >= 100 && !profile.titles.includes("📚 단어왕")) {
    profile.titles.push("📚 단어왕");
  }

  if (profile.bestWinStreak >= 3 && !profile.titles.includes("🔥 연승러")) {
    profile.titles.push("🔥 연승러");
  }

  if (profile.wins >= 10 && !profile.titles.includes("👑 끝말장인")) {
    profile.titles.push("👑 끝말장인");
  }
}

function publicProfile(nickname) {
  const profile = ensureProfile(nickname);
  const nextXp = getNextLevelXp(profile.level);
  const winRate = profile.games > 0 ? Math.round((profile.wins / profile.games) * 100) : 0;
  const achievementPercent = ACHIEVEMENTS.length > 0
    ? Math.floor(((profile.achievements || []).length / ACHIEVEMENTS.length) * 100)
    : 0;

  ensureShopFields(profile);
  ensureSocialFields(profile);
  const eligibleCollection = collectionItems().filter(item => !item.collectionExclusive);
  const collectionOwned = eligibleCollection.filter(item => profile.inventory.includes(item.id)).length;
  const collectionPercent = eligibleCollection.length ? Math.floor(collectionOwned / eligibleCollection.length * 100) : 0;
  const rankedNames = Object.values(playerData).slice().sort((a,b)=>(b.level-a.level)||(b.totalXp-a.totalXp)).map(item=>item.nickname);
  const favoriteItem = getShopItem(profile.favorites.cosmeticId) || getShopItem(Object.values(profile.equipped).find(id=>id&&id!=="default"));
  const favoriteBadge = getShopItem(profile.favorites.badgeId) || getEquippedItem(profile,"profileBadge");

  return {
    nickname: profile.nickname,
    displayName: decorateNickname(profile),
    style: publicStyleForNickname(profile.nickname),
    level: profile.level,
    xp: profile.xp,
    nextXp,
    xpPercent: Math.min(100, Math.floor((profile.xp / nextXp) * 100)),
    totalXp: profile.totalXp || 0,
    levelUps: profile.levelUps || 0,
    claimedLevelRewards: profile.claimedLevelRewards || [],
    nextLevelReward: getNextLevelReward(profile),
    levelRewards: LEVEL_REWARDS,
    coins: profile.coins,
    wins: profile.wins,
    losses: profile.losses,
    games: profile.games,
    winRate,
    currentWinStreak: profile.currentWinStreak,
    bestWinStreak: profile.bestWinStreak,
    wordsUsed: profile.wordsUsed,
    selectedTitle: profile.selectedTitle || "",
    titles: profile.titles || [],
    achievements: profile.achievements || [],
    achievementCount: (profile.achievements || []).length,
    achievementTotal: ACHIEVEMENTS.length,
    achievementPercent,
    season: "Season 1",
    growthPower: (profile.level * 100) + (profile.totalXp || 0) + (profile.coins || 0)
    ,prestige: profile.prestige || 0
    ,prestigeXpBonus: (profile.prestige || 0) * 10
    ,canPrestige: profile.level >= 100
    ,collectionPercent
    ,collectionOwned
    ,collectionTotal: eligibleCollection.length
    ,friendCount: profile.friends.length
    ,currentRank: rankedNames.indexOf(profile.nickname) + 1
    ,favoriteCosmetic: favoriteItem ? { id:favoriteItem.id,name:favoriteItem.name,icon:favoriteItem.icon||"🎁" } : null
    ,favoriteTitle: profile.favorites.title || profile.selectedTitle || ""
    ,favoriteBadge: favoriteBadge ? { id:favoriteBadge.id,name:favoriteBadge.name,icon:favoriteBadge.icon||"🏅" } : null
    ,...publicRankedData(profile)
    ,currentCosmetics: Object.fromEntries(["profileBorder","profileBackground","chatEffect","entranceEffect","victoryEffect","levelUpEffect"].map(type=>{
      const item=getEquippedItem(profile,type);return [type,item?{id:item.id,name:item.name,icon:item.icon||"🎁"}:null];
    }))
  };
}


function getAllPublicProfiles() {
  return Object.keys(playerData)
    .map(nickname => publicProfile(nickname))
    .filter(profile => profile && profile.nickname);
}

function makeRankingList(type) {
  const profiles = getAllPublicProfiles();

  let filtered = profiles.slice();
  let valueLabel = "";

  if (type === "wins") {
    valueLabel = "승";
    filtered.sort((a, b) => b.wins - a.wins || b.level - a.level || a.nickname.localeCompare(b.nickname));
  } else if (type === "winRate") {
    valueLabel = "%";
    filtered = filtered.filter(p => p.games >= 10);
    filtered.sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
  } else if (type === "level") {
    valueLabel = "Lv";
    filtered.sort((a, b) => b.level - a.level || b.xp - a.xp || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
  } else if (type === "coins") {
    valueLabel = "코인";
    filtered.sort((a, b) => b.coins - a.coins || b.level - a.level || a.nickname.localeCompare(b.nickname));
  } else if (type === "streak") {
    valueLabel = "연승";
    filtered.sort((a, b) => b.bestWinStreak - a.bestWinStreak || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
  } else {
    valueLabel = "점";
    filtered.sort((a, b) => b.level - a.level || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
  }

  return filtered.slice(0, 10).map((profile, index) => {
    let value = "";

    if (type === "wins") value = `${profile.wins}승`;
    else if (type === "winRate") value = `${profile.winRate}% (${profile.wins}승 ${profile.losses}패)`;
    else if (type === "level") value = `Lv.${profile.level}`;
    else if (type === "coins") value = `${profile.coins}코인`;
    else if (type === "streak") value = `${profile.bestWinStreak}연승`;
    else value = `${profile.level}`;

    return {
      rank: index + 1,
      nickname: profile.nickname,
      selectedTitle: profile.selectedTitle || "",
      level: profile.level,
      wins: profile.wins,
      losses: profile.losses,
      games: profile.games,
      winRate: profile.winRate,
      coins: profile.coins,
      bestWinStreak: profile.bestWinStreak,
      value
    };
  });
}

function getMyRankings(nickname) {
  const me = publicProfile(nickname);
  const types = ["wins", "winRate", "level", "coins", "streak"];
  const result = {};

  for (const type of types) {
    let profiles = getAllPublicProfiles();

    if (type === "wins") {
      profiles.sort((a, b) => b.wins - a.wins || b.level - a.level || a.nickname.localeCompare(b.nickname));
    } else if (type === "winRate") {
      profiles = profiles.filter(p => p.games >= 10);
      profiles.sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
    } else if (type === "level") {
      profiles.sort((a, b) => b.level - a.level || b.xp - a.xp || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
    } else if (type === "coins") {
      profiles.sort((a, b) => b.coins - a.coins || b.level - a.level || a.nickname.localeCompare(b.nickname));
    } else if (type === "streak") {
      profiles.sort((a, b) => b.bestWinStreak - a.bestWinStreak || b.wins - a.wins || a.nickname.localeCompare(b.nickname));
    }

    const index = profiles.findIndex(p => p.nickname === me.nickname);
    result[type] = index >= 0 ? index + 1 : null;
  }

  return result;
}

function getRankings(nickname) {
  return {
    wins: makeRankingList("wins"),
    winRate: makeRankingList("winRate"),
    level: makeRankingList("level"),
    coins: makeRankingList("coins"),
    streak: makeRankingList("streak"),
    myRanks: nickname ? getMyRankings(nickname) : {}
  };
}


loadPlayerData();
for (const nickname of Object.keys(playerData)) ensureProfile(nickname);
if (Object.keys(playerData).length > 0) savePlayerData();

const wordsDir = path.join(PROJECT_ROOT, "words");
loadDictionaries({ fs, path, wordsDir, wordDB, allWords, startMap });

function makeRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

function wordExists(word) {
  const target = "/" + word + "/";
  return wordDB.some(db => db.includes(target));
}

function isKoreanWord(word) {
  return /^[가-힣]{2,}$/.test(word);
}

function getDueumStarts(char) {
  const code = char.charCodeAt(0);

  if (code < 0xac00 || code > 0xd7a3) {
    return [char];
  }

  const base = code - 0xac00;
  const cho = Math.floor(base / 588);
  const rest = base % 588;

  const result = [char];

  // ㄴ → ㅇ
  if (cho === 2) {
    result.push(String.fromCharCode(0xac00 + 11 * 588 + rest));
  }

  // ㄹ → ㄴ 또는 ㅇ
  if (cho === 5) {
    result.push(String.fromCharCode(0xac00 + 2 * 588 + rest));
    result.push(String.fromCharCode(0xac00 + 11 * 588 + rest));
  }

  return [...new Set(result)];
}

function isValidChain(last, first) {
  return getDueumStarts(last).includes(first);
}

function getNextStartsForWord(word) {
  if (!word) return [];
  const last = word[word.length - 1];
  return getDueumStarts(last).filter(ch => ch !== last);
}

function hasNextWord(word) {
  if (!word) return true;

  const last = word[word.length - 1];
  const starts = getDueumStarts(last);

  for (const start of starts) {
    const words = startMap.get(start);
    if (words && words.length > 0) {
      return true;
    }
  }

  return false;
}

function isOneShotWord(word) {
  if (oneShotCache.has(word)) {
    return oneShotCache.get(word);
  }

  const result = !hasNextWord(word);
  oneShotCache.set(word, result);
  return result;
}

function getRandomStartWord() {
  const candidates = [];

  for (const word of allWords) {
    if (!isKoreanWord(word)) continue;
    if (word.length < 2 || word.length > 4) continue;
    if (isOneShotWord(word)) continue;

    const last = word[word.length - 1];
    const starts = getDueumStarts(last);

    let nextCount = 0;

    for (const start of starts) {
      const words = startMap.get(start) || [];
      nextCount += words.length;
    }

    if (nextCount >= 10) {
      candidates.push(word);
    }

    if (candidates.length >= 1000) break;
  }

  if (candidates.length === 0) {
    return "";
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function stopTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  room.turnDeadline = 0;

  if (room.botTimeout) {
    clearTimeout(room.botTimeout);
    room.botTimeout = null;
  }

  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
}

function activePlayers(room) {
  return room.players.filter(p => !p.eliminated && p.connected && !p.isSpectator);
}

function findPlayer(room, playerId) {
  return room.players.find(p => p.playerId === playerId);
}

function normalizeTurn(room) {
  const alive = activePlayers(room);

  if (alive.length === 0) {
    room.turn = 0;
    return null;
  }

  const current = room.players[room.turn];

  if (current && !current.eliminated && current.connected) {
    return current;
  }

  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p && !p.eliminated && p.connected) {
      room.turn = i;
      return p;
    }
  }

  room.turn = 0;
  return null;
}

function currentPlayer(room) {
  return normalizeTurn(room);
}

function nextActiveTurn(room, startIndex) {
  const alive = activePlayers(room);
  if (alive.length === 0) return 0;

  for (let i = 1; i <= room.players.length; i++) {
    const idx = (startIndex + i) % room.players.length;
    const p = room.players[idx];

    if (p && !p.eliminated && p.connected) {
      return idx;
    }
  }

  return 0;
}

function getWinnerText(room) {
  const alive = activePlayers(room);

  if (alive.length === 1) return alive[0].nickname;
  if (alive.length === 0) return "승자 없음";

  return alive.map(p => p.nickname).join(", ");
}


function getNextWordInfo(room) {
  if (room.status !== "playing" || !room.currentWord) {
    return {
      requiredStarts: [],
      remainingWordCount: 0,
      recommendedWords: []
    };
  }

  const last = room.currentWord[room.currentWord.length - 1];
  const requiredStarts = getDueumStarts(last);
  const usedSet = new Set(room.usedWords || []);
  usedSet.add(room.startWord);

  const candidates = [];
  const seen = new Set();

  for (const start of requiredStarts) {
    const words = startMap.get(start) || [];

    for (const word of words) {
      if (seen.has(word)) continue;
      seen.add(word);

      if (usedSet.has(word)) continue;
      if (!isKoreanWord(word)) continue;

      candidates.push(word);
    }
  }

  const safeWords = candidates.filter(word => !isOneShotWord(word));
  const source = safeWords.length >= 5 ? safeWords : candidates;

  const recommendedWords = [];

  for (let i = 0; i < source.length && recommendedWords.length < 5; i++) {
    const word = source[i];

    if (!recommendedWords.includes(word)) {
      recommendedWords.push(word);
    }
  }

  return {
    requiredStarts,
    remainingWordCount: candidates.length,
    recommendedWords
  };
}


function humanPlayers(room) {
  return room.players.filter(p => !p.isBot && p.connected && !p.isSpectator);
}

function totalPlayablePlayers(room) {
  return room.players.filter(p => p.connected && !p.isSpectator).length;
}

function isReady(room, playerId) {
  return !!(room.readyPlayers && room.readyPlayers[playerId]);
}

function allHumansReady(room) {
  const humans = humanPlayers(room);
  if (humans.length === 0) return false;
  return humans.every(p => isReady(room, p.playerId));
}

function canStartRoom(room) {
  return room.status === "waiting" && totalPlayablePlayers(room) >= 2 && allHumansReady(room);
}

function resetReady(room) {
  room.readyPlayers = {};
}

function getMatchResult(room) {
  const started = room.matchStartedAt || 0;
  const ended = room.matchEndedAt || Date.now();
  const durationSec = started ? Math.max(0, Math.floor((ended - started) / 1000)) : 0;

  return {
    winnerText: room.winnerText || "",
    durationSec,
    usedWordCount: room.usedWords ? room.usedWords.length : 0,
    eliminationOrder: room.eliminationOrder || [],
    rewards: room.rewards || []
  };
}

function addElimination(room, player, reason) {
  if (!room.eliminationOrder) {
    room.eliminationOrder = [];
  }

  if (!player) return;

  const already = room.eliminationOrder.some(item => item.playerId === player.playerId);
  if (already) return;

  room.eliminationOrder.push({
    playerId: player.playerId,
    nickname: player.nickname,
    reason,
    time: Date.now()
  });
}

function ensureRoomSocialFields(room) {
  if (!room) return;
  if (room.mode !== "ranked") room.mode = "normal";
  if (!Number.isFinite(room.maxPlayers)) room.maxPlayers=8;
  room.maxPlayers=Math.max(2,Math.min(12,Math.floor(room.maxPlayers)));
  if (typeof room.customTitle!=="string") room.customTitle="";
  if (typeof room.isLocked!=="boolean") room.isLocked=false;
  if (typeof room.spectatorsEnabled!=="boolean") room.spectatorsEnabled=true;
  if (typeof room.chatEnabled!=="boolean") room.chatEnabled=true;
  if (!room.announcement || typeof room.announcement!=="object") room.announcement={text:"",color:"#ffd54a"};
  for (const player of room.players||[]) {
    player.isSpectator=!!player.isSpectator;
    if (typeof player.watchedPlayerId!=="string") player.watchedPlayerId="";
  }
}

function publicRoom(room) {
  ensureRoomSocialFields(room);
  const turnPlayer = normalizeTurn(room);
  const nextWordInfo = getNextWordInfo(room);

  return {
    mode: room.mode,
    readyPlayers: room.readyPlayers || {},
    canStart: canStartRoom(room),
    allReady: allHumansReady(room),
    countdown: room.countdown || 0,
    matchResult: getMatchResult(room),
    turnPlayerId: turnPlayer ? turnPlayer.playerId : "",
    turnPlayerName: turnPlayer ? turnPlayer.nickname : "",
    players: room.players.map(p => ({
      playerId: p.playerId,
      socketId: p.socketId,
      nickname: p.nickname,
      connected: p.connected,
      eliminated: p.eliminated,
      isBot: !!p.isBot,
      botDifficulty: p.botDifficulty || "",
      isSpectator: !!p.isSpectator,
      watchedPlayerId: p.watchedPlayerId || "",
      profile: p.isBot ? null : publicProfile(p.nickname),
      style: p.isBot ? null : publicStyleForNickname(p.nickname)
    })),
    hostId: room.hostId,
    title: room.customTitle || "",
    maxPlayers: room.maxPlayers,
    isLocked: room.isLocked,
    spectatorsEnabled: room.spectatorsEnabled,
    chatEnabled: room.chatEnabled,
    announcement: room.announcement,
    currentWord: room.currentWord,
    nextStarts: getNextStartsForWord(room.currentWord),
    turn: room.turn,
    usedWords: room.usedWords,
    status: room.status,
    timeLimit: room.timeLimit,
    timeLeft: room.timeLeft,
    wrongCount: room.wrongCount,
    gameoverReason: room.gameoverReason,
    winnerText: room.winnerText,
    lastNotice: room.lastNotice,
    notice: room.notice || "",
    noticeUntil: room.noticeUntil || 0,
    startWord: room.startWord,
    requiredStarts: nextWordInfo.requiredStarts,
    remainingWordCount: nextWordInfo.remainingWordCount,
    recommendedWords: nextWordInfo.recommendedWords,
    chatMessages: room.chatMessages || []
  };
}


function cleanupBotOnlyRooms() {
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    const humanCount = room.players.filter(p => !p.isBot && p.connected).length;

    if (humanCount === 0) {
      stopTimer(room);
      delete rooms[code];
    }
  }
}

function makeRoomList() {
  cleanupBotOnlyRooms();

  const list = Object.keys(rooms).map(code => {
    const room = rooms[code];
    ensureRoomSocialFields(room);
    const host = room.players.find(p => p.playerId === room.hostId);
    const connectedPlayers = room.players.filter(p => p.connected && !p.eliminated && !p.isSpectator).length;
    const spectators = room.players.filter(p => p.connected && p.isSpectator).length;

    return {
      code,
      title: room.customTitle || `${host ? host.nickname : "방장"}님의 방`,
      hostName: host ? host.nickname : "방장",
      players: connectedPlayers,
      spectators,
      maxPlayers: room.maxPlayers,
      status: room.status,
      isPublic: !!room.isPublic,
      locked: !!room.password,
      createdAt: room.createdAt || 0,
      mode: room.mode
    };
  }).filter(room => room.mode !== "ranked");

  return list
    .filter(r => r.isPublic)
    .sort((a, b) => {
      if (a.status === "waiting" && b.status !== "waiting") return -1;
      if (a.status !== "waiting" && b.status === "waiting") return 1;
      if (a.players !== b.players) return b.players - a.players;
      return b.createdAt - a.createdAt;
    });
}

function broadcastRoomList() {
  io.emit("roomList", makeRoomList());
}

function sendRoomUpdate(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  normalizeTurn(room);
  io.to(roomCode).emit("roomUpdate", publicRoom(room));
  broadcastRoomList();
}

function addChatMessage(roomCode, message) {
  const room = rooms[roomCode];
  if (!room) return;

  if (!room.chatMessages) {
    room.chatMessages = [];
  }

  room.chatMessages.push(message);

  if (room.chatMessages.length > 100) {
    room.chatMessages = room.chatMessages.slice(-100);
  }

  io.to(roomCode).emit("chatUpdate", room.chatMessages);
}

function addSystemMessage(roomCode, text) {
  addChatMessage(roomCode, {
    type: "system",
    nickname: "SYSTEM",
    text,
    time: Date.now()
  });
}

function setRoomNotice(roomCode, text, duration = 2500) {
  const room = rooms[roomCode];
  if (!room) return;

  room.notice = text;
  room.noticeUntil = Date.now() + duration;

  sendRoomUpdate(roomCode);

  setTimeout(() => {
    const r = rooms[roomCode];
    if (!r) return;

    if (r.notice === text && Date.now() >= r.noticeUntil) {
      r.notice = "";
      r.noticeUntil = 0;
      sendRoomUpdate(roomCode);
    }
  }, duration + 100);
}



function calculateMatchGrowthReward(room, player, isWinner) {
  const usedCount = Array.isArray(room.usedWords) ? room.usedWords.length : 0;
  const humanCount = room.players.filter(p => !p.isBot).length;
  const botCount = room.players.filter(p => p.isBot).length;

  const breakdown = [];

  function add(label, xp, coins = 0) {
    if (xp || coins) breakdown.push({ label, xp, coins });
  }

  add("참가", 20, 10);
  add(isWinner ? "승리" : "패배 보상", isWinner ? 90 : 35, isWinner ? 60 : 20);

  if (humanCount >= 2) {
    add("온라인 대전", isWinner ? 35 : 15, isWinner ? 25 : 5);
  } else if (botCount > 0) {
    add("AI 대전", isWinner ? 20 : 10, isWinner ? 10 : 5);
  }

  if (isWinner && player && !player.isBot) {
    const profile = ensureProfile(player.nickname);
    const streakBonus = Math.min(profile.currentWinStreak * 5, 50);
    if (streakBonus > 0) add(`${profile.currentWinStreak}연승 보너스`, streakBonus, Math.floor(streakBonus / 2));
  }

  const wordBonus = Math.min(Math.floor(usedCount / 3) * 5, 40);
  if (wordBonus > 0) add("긴 경기 보너스", wordBonus, Math.floor(wordBonus / 2));

  return {
    xp: breakdown.reduce((sum, item) => sum + item.xp, 0),
    coins: breakdown.reduce((sum, item) => sum + item.coins, 0),
    breakdown
  };
}

function applyMatchRewards(room) {
  if (!room || room.statsApplied) return;

  room.statsApplied = true;
  room.rewards = [];

  const winnerNames = (room.winnerText || "")
    .split(",")
    .map(name => name.trim())
    .filter(Boolean);

  const rewardedPlayers = new Set();

  for (const player of room.players) {
    if (player.isBot) continue;
    if (room.mode === "ranked" && player.isSpectator) continue;

    const rewardKey = player.playerId || player.nickname;
    if (rewardedPlayers.has(rewardKey)) continue;
    rewardedPlayers.add(rewardKey);

    const profile = ensureProfile(player.nickname);
    const isWinner = winnerNames.includes(player.nickname);
    const rankedResult = room.mode === "ranked"
      ? applyRankedResult(profile, isWinner)
      : null;

    profile.games++;

    if (isWinner) {
      profile.wins++;
      profile.currentWinStreak++;
      profile.bestWinStreak = Math.max(profile.bestWinStreak, profile.currentWinStreak);
    } else {
      profile.losses++;
      profile.currentWinStreak = 0;
    }

    const matchReward = calculateMatchGrowthReward(room, player, isWinner);
    const xpResult = addXp(profile, matchReward.xp);
    profile.coins += matchReward.coins;
    recordQuestProgress(profile, {
      games: 1,
      wins: isWinner ? 1 : 0,
      xp: matchReward.xp
    });

    updateTitles(profile);
    const levelRewards = claimLevelRewards(profile);
    const unlockedAchievements = checkAchievements(profile);
    if (xpResult.leveledUp) pushNotification(profile.nickname,"level_up",`레벨 ${profile.level} 달성`,{level:profile.level});
    for (const achievement of unlockedAchievements) pushNotification(profile.nickname,"achievement",`${achievement.name} 달성`,{achievementId:achievement.id});

    room.rewards.push({
      nickname: player.nickname,
      result: isWinner ? "win" : "loss",
      xp: matchReward.xp,
      coins: matchReward.coins,
      breakdown: matchReward.breakdown,
      levelBefore: xpResult.beforeLevel,
      level: profile.level,
      xpBefore: xpResult.beforeXp,
      xpAfter: profile.xp,
      nextXp: getNextLevelXp(profile.level),
      totalXp: profile.totalXp,
      levelsGained: xpResult.levelsGained,
      leveledUp: xpResult.leveledUp,
      levelRewards,
      achievements: unlockedAchievements
      ,ranked: rankedResult
    });

    if (room.mode === "ranked" && player.socketId) {
      io.to(player.socketId).emit("rankedData", publicRankedData(profile));
    }
  }

  savePlayerData();
}

function gameOver(roomCode, reason) {
  const room = rooms[roomCode];
  if (!room) return;

  room.status = "gameover";
  room.gameoverReason = reason;
  room.winnerText = getWinnerText(room);
  room.matchEndedAt = Date.now();
  applyMatchRewards(room);
  room.countdown = 0;

  addSystemMessage(roomCode, `🏆 최종 승리: ${room.winnerText}`);
  setRoomNotice(roomCode, `🏆 최종 승리!\n\n${room.winnerText}`, 5000);

  stopTimer(room);
  sendRoomUpdate(roomCode);
}

function resetRoundAfterElimination(room) {
  const newStartWord = getRandomStartWord();

  room.currentWord = newStartWord;
  room.startWord = newStartWord;
  room.usedWords = [];
  room.timeLimit = 20;
  room.timeLeft = 20;
}

function eliminatePlayer(roomCode, player, reason) {
  const room = rooms[roomCode];
  if (!room || !player || player.eliminated) return;

  player.eliminated = true;
  room.wrongCount = 0;
  room.lastNotice = `${player.nickname} 탈락! ${reason}`;
  addElimination(room, player, reason);
  addSystemMessage(roomCode, `💀 ${player.nickname}님 탈락! (${reason})`);
  setRoomNotice(roomCode, `💀 탈락!\n\n${player.nickname}\n${reason}`, 3000);

  const alive = activePlayers(room);

  if (alive.length <= 1) {
    gameOver(roomCode, `${player.nickname}님이 탈락했습니다!`);
    return;
  }

  resetRoundAfterElimination(room);
  room.turn = nextActiveTurn(room, room.turn);
  startTurnTimer(roomCode);
}

function startTurnTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  normalizeTurn(room);

  if (room.status === "playing" && activePlayers(room).length <= 1) {
    gameOver(roomCode, "마지막 1명만 남았습니다!");
    return;
  }

  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  room.turnDeadline = 0;

  if (room.botTimeout) {
    clearTimeout(room.botTimeout);
    room.botTimeout = null;
  }

  room.timeLeft = room.timeLimit;
  room.turnDeadline = Date.now() + room.timeLimit * 1000;
  room.timerToken = (room.timerToken || 0) + 1;

  const token = room.timerToken;

  room.timer = setInterval(() => {
    const r = rooms[roomCode];

    if (!r || r.status !== "playing") {
      if (r && r.timer) {
        clearInterval(r.timer);
        r.timer = null;
      }
      return;
    }

    if (r.timerToken !== token) {
      clearInterval(r.timer);
      r.timer = null;
      return;
    }

    normalizeTurn(r);

    if (activePlayers(r).length <= 1) {
      gameOver(roomCode, "마지막 1명만 남았습니다!");
      return;
    }

    const remaining = Math.ceil((r.turnDeadline - Date.now()) / 1000);
    r.timeLeft = Math.max(0, remaining);

    if (r.timeLeft <= 0) {
      const player = currentPlayer(r);
      eliminatePlayer(roomCode, player, "시간 초과");
      return;
    }

    sendRoomUpdate(roomCode);
  }, 500);

  sendRoomUpdate(roomCode);
  scheduleBotTurn(roomCode);
}

function setTimeLimitByTurn(room) {
  const turnCount = room.usedWords.length;

  if (turnCount <= 5) {
    room.timeLimit = 20;
  } else if (turnCount <= 10) {
    room.timeLimit = 17;
  } else if (turnCount <= 15) {
    room.timeLimit = 14;
  } else if (turnCount <= 20) {
    room.timeLimit = 11;
  } else if (turnCount <= 25) {
    room.timeLimit = 8;
  } else {
    room.timeLimit = 5;
  }

  room.timeLeft = room.timeLimit;
}

function upsertPlayer(room, socket, playerId, nickname, isSpectator = false) {
  let player = findPlayer(room, playerId);

  if (player) {
    player.socketId = socket.id;
    player.nickname = nickname;
    player.connected = true;
    player.isSpectator = !!isSpectator;
    return player;
  }

  player = {
    playerId,
    socketId: socket.id,
    nickname,
    connected: true,
    eliminated: false
    ,isSpectator: !!isSpectator
    ,watchedPlayerId: ""
  };

  room.players.push(player);
  return player;
}


function getBotDelay(difficulty) {
  if (difficulty === "veryEasy") return 6000 + Math.floor(Math.random() * 4000);
  if (difficulty === "easy") return 4000 + Math.floor(Math.random() * 3000);
  if (difficulty === "normal") return 2000 + Math.floor(Math.random() * 2500);
  if (difficulty === "hard") return 1000 + Math.floor(Math.random() * 1500);
  if (difficulty === "hell") return 300 + Math.floor(Math.random() * 800);
  return 3000;
}

function getNextCount(word) {
  if (!word) return 0;

  const last = word[word.length - 1];
  const starts = getDueumStarts(last);
  let count = 0;

  for (const start of starts) {
    const words = startMap.get(start) || [];
    count += words.length;
  }

  return count;
}

function getCandidateWords(room) {
  if (!room.currentWord) return [];

  const last = room.currentWord[room.currentWord.length - 1];
  const starts = getDueumStarts(last);
  const usedSet = new Set(room.usedWords || []);
  usedSet.add(room.startWord);

  const candidates = [];
  const seen = new Set();

  for (const start of starts) {
    const words = startMap.get(start) || [];

    for (const word of words) {
      if (seen.has(word)) continue;
      seen.add(word);

      if (!isKoreanWord(word)) continue;
      if (usedSet.has(word)) continue;

      if (room.usedWords.length === 0 && isOneShotWord(word)) continue;

      candidates.push(word);

      if (candidates.length >= 1500) break;
    }

    if (candidates.length >= 1500) break;
  }

  return candidates;
}


function pickRandomFrom(source, limit = source.length) {
  if (!source || source.length === 0) return "";

  const max = Math.max(1, Math.min(source.length, limit));
  return source[Math.floor(Math.random() * max)];
}


function isSameStartEndWord(word) {
  return !!word && word.length >= 2 && word[0] === word[word.length - 1];
}

function getWordScoreForAttack(word) {
  // 점수가 낮을수록 상대가 이어가기 어려운 단어
  return getNextCount(word);
}

function getEasyWordScore(word) {
  // 쉬운 봇은 짧고, 다음 단어가 많은 안전한 단어를 선호
  const lengthPenalty = word.length * 10;
  const safetyBonus = Math.min(getNextCount(word), 80);
  const oneShotPenalty = isOneShotWord(word) ? 1000 : 0;

  return lengthPenalty - safetyBonus + oneShotPenalty;
}

function getNormalWordScore(word) {
  // 중간 봇은 너무 위험하지 않은 단어를 고르되, 약간 공격성 있음
  const nextCount = getNextCount(word);
  const lengthPenalty = word.length * 2;

  return Math.abs(nextCount - 30) + lengthPenalty;
}

function chooseBotWord(room, difficulty) {
  const candidates = getCandidateWords(room);

  if (candidates.length === 0) return "";

  const safeWords = candidates.filter(word => !isOneShotWord(word));
  const oneShotWords = candidates.filter(word => isOneShotWord(word));

  if (difficulty === "veryEasy") {
    // 완전 쉬움: 짧고 쉬운 단어 위주, 아주 가끔 실수
    if (Math.random() < 0.05) return "";

    const shortSafe = safeWords
      .filter(word => word.length >= 2 && word.length <= 3)
      .sort((a, b) => getEasyWordScore(a) - getEasyWordScore(b));

    const source = shortSafe.length > 0
      ? shortSafe
      : safeWords.slice().sort((a, b) => getEasyWordScore(a) - getEasyWordScore(b));

    return pickRandomFrom(source.length > 0 ? source : candidates, 25);
  }

  if (difficulty === "easy") {
    // 쉬움: 2~4글자 안전 단어, 가끔 좋은 수
    if (Math.random() < 0.02) return "";

    const easyWords = safeWords
      .filter(word => word.length >= 2 && word.length <= 4)
      .sort((a, b) => getEasyWordScore(a) - getEasyWordScore(b));

    const source = easyWords.length > 0
      ? easyWords
      : safeWords.slice().sort((a, b) => getEasyWordScore(a) - getEasyWordScore(b));

    return pickRandomFrom(source.length > 0 ? source : candidates, 50);
  }

  if (difficulty === "normal") {
    // 중간: 사람처럼 평범하게, 가끔 한방단어
    if (oneShotWords.length > 0 && Math.random() < 0.18) {
      return pickRandomFrom(oneShotWords, 20);
    }

    const normalWords = safeWords
      .filter(word => word.length >= 2 && word.length <= 5)
      .sort((a, b) => getNormalWordScore(a) - getNormalWordScore(b));

    const source = normalWords.length > 0 ? normalWords : safeWords;

    return pickRandomFrom(source.length > 0 ? source : candidates, 80);
  }

  if (difficulty === "hard") {
    // 어려움: 한방단어 적극 사용, 없으면 상대가 힘든 단어 선택
    if (oneShotWords.length > 0 && Math.random() < 0.65) {
      return pickRandomFrom(oneShotWords, oneShotWords.length);
    }

    const sorted = candidates
      .slice()
      .sort((a, b) => getWordScoreForAttack(a) - getWordScoreForAttack(b));

    return pickRandomFrom(sorted, Math.min(20, sorted.length));
  }

  if (difficulty === "hell") {
    // 지옥: "컥컥"처럼 첫 글자와 마지막 글자가 같은 단어는 역공당하기 쉬워서 사용 금지
    const hellCandidates = candidates.filter(word => !isSameStartEndWord(word));
    const hellOneShotWords = oneShotWords.filter(word => !isSameStartEndWord(word));

    // 한방단어는 강하지만 너무 자주 쓰면 재미가 떨어져서 70%만 사용
    if (hellOneShotWords.length > 0 && Math.random() < 0.7) {
      return hellOneShotWords
        .slice()
        .sort((a, b) => a.length - b.length)[0];
    }

    const nonOneShot = hellCandidates.filter(word => !isOneShotWord(word));
    const source = nonOneShot.length > 0 ? nonOneShot : hellCandidates;

    // 다음 사람이 받을 수 있는 단어 수가 1~5개인 단어를 최우선으로 선택
    // 바로 끝내기보다 5턴 안에 몰아붙이는 압박형 플레이
    const killSoonWords = source
      .filter(word => {
        const nextCount = getNextCount(word);
        return nextCount > 0 && nextCount <= 5;
      })
      .sort((a, b) => {
        const scoreDiff = getNextCount(a) - getNextCount(b);
        if (scoreDiff !== 0) return scoreDiff;
        return a.length - b.length;
      });

    if (killSoonWords.length > 0) {
      return killSoonWords[0];
    }

    if (source.length > 0) {
      return source
        .slice()
        .sort((a, b) => {
          const scoreDiff = getWordScoreForAttack(a) - getWordScoreForAttack(b);
          if (scoreDiff !== 0) return scoreDiff;
          return a.length - b.length;
        })[0];
    }

    // 정말 후보가 없을 때만 기존 후보 사용
    return candidates
      .slice()
      .sort((a, b) => {
        const scoreDiff = getWordScoreForAttack(a) - getWordScoreForAttack(b);
        if (scoreDiff !== 0) return scoreDiff;
        return a.length - b.length;
      })[0];
  }

  return pickRandomFrom(candidates);
}

function scheduleBotTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.status !== "playing") return;

  const player = currentPlayer(room);

  if (!player || !player.isBot || player.eliminated || !player.connected) return;

  const delay = getBotDelay(player.botDifficulty);

  if (room.botTimeout) {
    clearTimeout(room.botTimeout);
    room.botTimeout = null;
  }

  room.botTimeout = setTimeout(() => {
    const r = rooms[roomCode];
    if (!r || r.status !== "playing") return;

    const bot = currentPlayer(r);

    if (!bot || !bot.isBot || bot.playerId !== player.playerId || bot.eliminated) return;

    const word = chooseBotWord(r, bot.botDifficulty);

    if (!word) {
      eliminatePlayer(roomCode, bot, "낼 단어가 없음");
      return;
    }

    r.currentWord = word;
    r.usedWords.push(word);
    r.wrongCount = 0;
    r.lastNotice = `🤖 ${bot.nickname}: ${word}`;
    addSystemMessage(roomCode, `🤖 ${bot.nickname} → ${word}`);
    r.turn = nextActiveTurn(r, r.turn);

    setTimeLimitByTurn(r);
    startTurnTimer(roomCode);
  }, delay);
}

function addBotsToRoom(room, roomCode, botCount, botDifficulty) {
  const count = Math.max(0, Math.min(Number(botCount) || 0, 3));
  const difficulty = botDifficulty || "normal";
  const names = {
    veryEasy: ["🤖 초보봇", "🤖 졸린봇", "🤖 느림봇"],
    easy: ["🤖 연습봇", "🤖 쉬운봇", "🤖 말잇봇"],
    normal: ["🤖 보통봇", "🤖 단어봇", "🤖 체인봇"],
    hard: ["🔥 공격봇", "🔥 고수봇", "🔥 전략봇"],
    hell: ["👿 끝말귀신", "👿 지옥사신", "👿 심판자", "👿 그림자", "👿 심연", "👿 악몽", "👿 파멸자", "👿 흑염룡", "👿 종말", "👿 어둠군주"]
  };

  const pool = names[difficulty] || names.normal;

  for (let i = 0; i < count; i++) {
    const botId = `bot_${roomCode}_${i}_${Date.now()}`;
    room.players.push({
      playerId: botId,
      socketId: botId,
      nickname: pool[Math.floor(Math.random() * pool.length)],
      connected: true,
      eliminated: false,
      isBot: true,
      botDifficulty: difficulty
    });
  }
}


function beginGame(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const startWord = getRandomStartWord();

  if (!startWord) {
    addSystemMessage(roomCode, "시작 단어를 고를 수 없습니다. words 폴더를 확인하세요.");
    return;
  }

  room.players.forEach(p => {
    if (p.connected || p.isBot) {
      p.eliminated = false;
    }
    if (p.isBot) {
      p.connected = true;
    }
  });

  room.status = "playing";
  room.turn = 0;
  room.currentWord = startWord;
  room.startWord = startWord;
  room.usedWords = [];
  room.timeLimit = 20;
  room.timeLeft = 20;
  room.turnDeadline = 0;
  room.wrongCount = 0;
  room.gameoverReason = "";
  room.winnerText = "";
  room.lastNotice = `🎲 시작 단어: ${startWord}`;
  room.countdown = 0;
  room.matchStartedAt = Date.now();
  room.matchEndedAt = 0;
  room.eliminationOrder = [];
  room.rewards = [];
  room.statsApplied = false;

  addSystemMessage(roomCode, `🎮 게임 시작! 시작 단어는 ${startWord}`);
  setRoomNotice(roomCode, `🎮 게임 시작!\n\n시작 단어: ${startWord}`, 2500);
  startTurnTimer(roomCode);
}

function startCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  if (!canStartRoom(room)) {
    sendRoomUpdate(roomCode);
    return;
  }

  stopTimer(room);
  room.status = "countdown";
  room.countdown = 3;
  room.currentWord = "";
  room.startWord = "";
  room.usedWords = [];
  room.lastNotice = "⏳ 3초 후 시작!";
  addSystemMessage(roomCode, "⏳ 재경기/게임 시작 준비!");

  sendRoomUpdate(roomCode);

  room.countdownTimer = setInterval(() => {
    const r = rooms[roomCode];
    if (!r) return;

    r.countdown--;

    if (r.countdown <= 0) {
      if (r.countdownTimer) {
        clearInterval(r.countdownTimer);
        r.countdownTimer = null;
      }
      beginGame(roomCode);
      return;
    }

    r.lastNotice = `⏳ ${r.countdown}초 후 시작!`;
    sendRoomUpdate(roomCode);
  }, 1000);
}

function prepareRematch(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  stopTimer(room);

  room.status = "waiting";
  room.currentWord = "";
  room.startWord = "";
  room.turn = 0;
  room.usedWords = [];
  room.timeLimit = 20;
  room.timeLeft = 20;
  room.wrongCount = 0;
  room.gameoverReason = "";
  room.winnerText = "";
  room.lastNotice = "🔄 재경기 준비 중!";
  room.countdown = 0;
  room.matchEndedAt = 0;
  room.rewards = [];
  room.statsApplied = false;

  room.players.forEach(p => {
    if (p.connected || p.isBot) {
      p.eliminated = false;
    }
    if (p.isBot) {
      p.connected = true;
    }
  });

  resetReady(room);
  addSystemMessage(roomCode, "🔄 재경기 준비! 모두 준비 버튼을 눌러 주세요.");
  sendRoomUpdate(roomCode);
}

registerSocketHandlers(io, (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = null;

  socket.emit("roomList", makeRoomList());

  socket.on("getRoomList", () => {
    socket.emit("roomList", makeRoomList());
  });

  socket.on("buyBox", ({ boxType }) => {
    const nickname = socket.data.nickname;
    const box = BOX_TYPES[boxType];
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    if (!box) return socket.emit("errorMessage", "존재하지 않는 상자입니다.");

    const profile = ensureProfile(nickname);
    ensureShopFields(profile);
    if (profile.coins < box.price) {
      return socket.emit("errorMessage", `코인이 부족합니다. 필요 코인: ${box.price}`);
    }

    profile.coins -= box.price;
    profile.boxes[boxType]++;
    savePlayerData();
    socket.emit("shopNotice", `${box.name} 구매 완료!`);
    socket.emit("shopData", publicShopProfile(nickname));
    socket.emit("profileData", publicProfile(nickname));
  });

  socket.on("openBox", ({ boxType }) => {
    const nickname = socket.data.nickname;
    const box = BOX_TYPES[boxType];
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    if (!box) return socket.emit("errorMessage", "존재하지 않는 상자입니다.");

    const profile = ensureProfile(nickname);
    ensureShopFields(profile);
    if (profile.boxes[boxType] < 1) {
      return socket.emit("errorMessage", "보유한 상자가 없습니다.");
    }

    profile.boxes[boxType]--;
    const reward = openRandomBox(profile, boxType);
    savePlayerData();
    socket.emit("shopData", publicShopProfile(nickname));
    socket.emit("boxResult", reward);
    socket.emit("profileData", publicProfile(nickname));
  });

  socket.on("getQuests", () => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    socket.emit("questData", publicQuestData(ensureProfile(nickname)));
  });

  socket.on("getCollection", ({ nickname: requestedNickname } = {}) => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    const target = playerData[safePlayerKey(requestedNickname)] ? safePlayerKey(requestedNickname) : nickname;
    socket.emit("collectionData", { nickname:target, ...publicCollection(ensureProfile(target), true) });
  });

  socket.on("claimCollectionReward", ({ percent }) => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    const profile = ensureProfile(nickname);
    const milestone = COLLECTION_MILESTONES.find(item=>item.percent===Number(percent));
    if (!milestone) return socket.emit("errorMessage", "존재하지 않는 컬렉션 보상입니다.");
    const collection = publicCollection(profile, false);
    if (collection.percent < milestone.percent) return socket.emit("errorMessage", "컬렉션 완성도가 부족합니다.");
    if (profile.collectionRewardsClaimed.includes(milestone.percent)) return socket.emit("errorMessage", "이미 받은 컬렉션 보상입니다.");
    profile.collectionRewardsClaimed.push(milestone.percent);
    const rewards = grantCollectionReward(profile,milestone);
    savePlayerData();
    socket.emit("collectionRewardClaimed",{percent:milestone.percent,rewards});
    pushNotification(nickname,"collection",`컬렉션 ${milestone.percent}% 보상 획득`,{percent:milestone.percent});
    socket.emit("collectionData",{nickname,...publicCollection(profile,true)});
    socket.emit("profileData",publicProfile(nickname));
    socket.emit("shopData",publicShopProfile(nickname));
  });

  socket.on("prestigePlayer", () => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    const profile = ensureProfile(nickname);
    if (profile.level < 100) return socket.emit("errorMessage", "레벨 100에서만 프레스티지할 수 있습니다.");
    profile.prestige++;
    profile.level=1;
    profile.xp=0;
    for (const id of ["prestige_badge","prestige_border","prestige_frame"]) if (!profile.inventory.includes(id)) profile.inventory.push(id);
    const title=`♛ 프레스티지 ${profile.prestige}`;
    if (!profile.titles.includes(title)) profile.titles.push(title);
    profile.selectedTitle=title;
    savePlayerData();
    socket.emit("prestigeComplete",{prestige:profile.prestige,title});
    pushNotification(nickname,"prestige",`${title} 달성`,{prestige:profile.prestige});
    socket.emit("profileData",publicProfile(nickname));
    socket.emit("shopData",publicShopProfile(nickname));
  });

  socket.on("setFavorite", ({ kind, value }) => {
    const nickname=socket.data.nickname;
    if (!nickname) return;
    const profile=ensureProfile(nickname);
    if (kind==="cosmetic" && profile.inventory.includes(value)) profile.favorites.cosmeticId=value;
    else if (kind==="badge" && profile.inventory.includes(value) && getShopItem(value)?.type==="profileBadge") profile.favorites.badgeId=value;
    else if (kind==="title" && profile.titles.includes(value)) profile.favorites.title=value;
    else return socket.emit("errorMessage","보유한 항목만 즐겨찾기로 지정할 수 있습니다.");
    savePlayerData();
    socket.emit("profileData",publicProfile(nickname));
  });

  socket.on("claimQuest", ({ questId }) => {
    const nickname = socket.data.nickname;
    const quest = QUEST_DEFINITIONS.find(entry => entry.id === String(questId || ""));
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    if (!quest) return socket.emit("errorMessage", "존재하지 않는 퀘스트입니다.");

    const profile = ensureProfile(nickname);
    ensureQuestFields(profile);
    const key = questClaimKey(quest, profile);
    if (profile.quests.claimed.includes(key)) {
      return socket.emit("errorMessage", "이미 받은 퀘스트 보상입니다.");
    }
    if (questValue(profile, quest) < quest.target) {
      return socket.emit("errorMessage", "아직 퀘스트를 완료하지 않았습니다.");
    }

    profile.quests.claimed.push(key);
    const granted = grantReward(profile, quest.reward);
    savePlayerData();
    socket.emit("questClaimed", { questId: quest.id, rewards: granted });
    pushNotification(nickname,"quest",`${quest.name} 완료`,{questId:quest.id});
    socket.emit("questData", publicQuestData(profile));
    socket.emit("profileData", publicProfile(nickname));
    socket.emit("shopData", publicShopProfile(nickname));
  });

  socket.on("getDailyLogin", () => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    socket.emit("dailyLoginData", publicDailyLogin(ensureProfile(nickname)));
  });

  socket.on("claimDailyLogin", () => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    const profile = ensureProfile(nickname);
    ensureDailyLoginFields(profile);
    const today = koreaDateKey();
    if (profile.dailyLogin.lastClaimDate === today) {
      return socket.emit("errorMessage", "오늘의 출석 보상을 이미 받았습니다.");
    }

    const yesterday = new Date(`${today}T00:00:00+09:00`);
    yesterday.setDate(yesterday.getDate() - 1);
    profile.dailyLogin.streak = profile.dailyLogin.lastClaimDate === koreaDateKey(yesterday)
      ? profile.dailyLogin.streak + 1
      : 1;
    const rewardDay = (profile.dailyLogin.totalDays % 30) + 1;
    const reward = DAILY_LOGIN_REWARDS[rewardDay - 1];
    profile.dailyLogin.totalDays++;
    profile.dailyLogin.lastClaimDate = today;
    const granted = grantReward(profile, reward);
    savePlayerData();
    socket.emit("dailyLoginClaimed", { day: rewardDay, rewards: granted });
    pushNotification(nickname,"daily",`DAY ${rewardDay} 출석 보상 획득`,{day:rewardDay});
    socket.emit("dailyLoginData", publicDailyLogin(profile));
    socket.emit("profileData", publicProfile(nickname));
    socket.emit("shopData", publicShopProfile(nickname));
  });

  socket.on("getFriends", () => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    socket.emit("friendsData", publicFriendsData(ensureProfile(nickname)));
  });

  socket.on("searchPlayers", ({ query }) => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
    const cleanQuery = String(query || "").trim().toLowerCase().slice(0, 20);
    if (cleanQuery.length < 2) return socket.emit("playerSearchResults", []);
    const profile = ensureProfile(nickname);
    const results = Object.keys(playerData)
      .filter(name => name !== nickname && name.toLowerCase().includes(cleanQuery))
      .slice(0, 12)
      .map(name => ({
        nickname: name,
        online: !!socketForNickname(name),
        isFriend: profile.friends.includes(name),
        requested: ensureProfile(name).friendRequests.includes(nickname)
      }));
    socket.emit("playerSearchResults", results);
  });

  socket.on("sendFriendRequest", ({ nickname: targetName }) => {
    const nickname = socket.data.nickname;
    targetName = safePlayerKey(targetName);
    if (!nickname || !playerData[targetName] || targetName === nickname) {
      return socket.emit("errorMessage", "친구 요청 대상을 확인해 주세요.");
    }
    const profile = ensureProfile(nickname);
    const target = ensureProfile(targetName);
    if (profile.blockedPlayers.includes(targetName) || target.blockedPlayers.includes(nickname)) return socket.emit("errorMessage","차단된 플레이어에게 친구 요청을 보낼 수 없습니다.");
    if (profile.friends.includes(targetName)) return socket.emit("errorMessage", "이미 친구입니다.");
    if (!target.friendRequests.includes(nickname)) target.friendRequests.push(nickname);
    savePlayerData();
    socket.emit("friendNotice", `${targetName}님에게 친구 요청을 보냈습니다.`);
    const targetSocket = socketForNickname(targetName);
    if (targetSocket) targetSocket.emit("friendNotice", `${nickname}님의 친구 요청이 도착했습니다.`);
    pushNotification(targetName,"friend_request",`${nickname}님의 친구 요청`,{nickname});
    emitFriendsData(nickname);
    emitFriendsData(targetName);
  });

  socket.on("respondFriendRequest", ({ nickname: requesterName, accept }) => {
    const nickname = socket.data.nickname;
    requesterName = safePlayerKey(requesterName);
    if (!nickname || !playerData[requesterName]) return socket.emit("errorMessage", "친구 요청을 찾을 수 없습니다.");
    const profile = ensureProfile(nickname);
    const requester = ensureProfile(requesterName);
    if (!profile.friendRequests.includes(requesterName)) {
      return socket.emit("errorMessage", "친구 요청을 찾을 수 없습니다.");
    }
    profile.friendRequests = profile.friendRequests.filter(name => name !== requesterName);
    if (accept) {
      if (!profile.friends.includes(requesterName)) profile.friends.push(requesterName);
      if (!requester.friends.includes(nickname)) requester.friends.push(nickname);
    }
    savePlayerData();
    socket.emit("friendNotice", accept ? `${requesterName}님과 친구가 되었습니다.` : "친구 요청을 거절했습니다.");
    emitFriendsData(nickname);
    emitFriendsData(requesterName);
  });

  socket.on("removeFriend", ({ nickname: targetName }) => {
    const nickname = socket.data.nickname;
    targetName = safePlayerKey(targetName);
    if (!nickname || !playerData[targetName]) return socket.emit("errorMessage", "친구를 찾을 수 없습니다.");
    const profile = ensureProfile(nickname);
    const target = ensureProfile(targetName);
    profile.friends = profile.friends.filter(name => name !== targetName);
    target.friends = target.friends.filter(name => name !== nickname);
    savePlayerData();
    emitFriendsData(nickname);
    emitFriendsData(targetName);
  });

  socket.on("toggleFavoriteFriend", ({nickname:targetName}) => {
    const nickname=socket.data.nickname;targetName=safePlayerKey(targetName);
    if (!nickname) return;
    const profile=ensureProfile(nickname);
    if (!profile.friends.includes(targetName)) return socket.emit("errorMessage","친구만 즐겨찾기할 수 있습니다.");
    profile.favoriteFriends=profile.favoriteFriends.includes(targetName)
      ? profile.favoriteFriends.filter(name=>name!==targetName)
      : [...profile.favoriteFriends,targetName];
    savePlayerData();emitFriendsData(nickname);
  });

  socket.on("setSocialStatus", ({status}) => {
    const nickname=socket.data.nickname;
    if (!nickname||!["online","dnd"].includes(status)) return;
    ensureProfile(nickname).socialStatus=status;savePlayerData();emitFriendsData(nickname);broadcastFriendPresence(nickname);
  });

  socket.on("getNotifications", () => {
    const nickname=socket.data.nickname;if(!nickname)return;
    const profile=ensureProfile(nickname);
    socket.emit("notificationData",{items:profile.notifications.slice().reverse(),unread:profile.notifications.filter(n=>!n.read).length});
  });

  socket.on("markNotificationsRead", () => {
    const nickname=socket.data.nickname;if(!nickname)return;
    const profile=ensureProfile(nickname);profile.notifications.forEach(item=>item.read=true);savePlayerData();
    socket.emit("notificationData",{items:profile.notifications.slice().reverse(),unread:0});
  });

  socket.on("reportPlayer", ({nickname:targetName,reason}) => {
    const nickname=socket.data.nickname;targetName=safePlayerKey(targetName);
    if (!nickname||!playerData[targetName]||targetName===nickname) return socket.emit("errorMessage","신고 대상을 확인해 주세요.");
    console.log(`[REPORT] ${nickname} -> ${targetName}: ${String(reason||"사유 없음").slice(0,120)}`);
    socket.emit("friendNotice",`${targetName}님에 대한 신고가 접수되었습니다.`);
  });

  socket.on("whisperFriend", ({ nickname: targetName, text }) => {
    const nickname = socket.data.nickname;
    targetName = safePlayerKey(targetName);
    const cleanText = String(text || "").trim().slice(0, 500);
    if (!nickname || !cleanText) return;
    const profile = ensureProfile(nickname);
    const targetProfile = playerData[targetName] ? ensureProfile(targetName) : null;
    if (!profile.friends.includes(targetName)) return socket.emit("errorMessage", "친구에게만 귓속말을 보낼 수 있습니다.");
    if (!targetProfile || profile.blockedPlayers.includes(targetName) || targetProfile.blockedPlayers.includes(nickname)) {
      return socket.emit("errorMessage", "차단된 플레이어와는 귓속말을 주고받을 수 없습니다.");
    }
    const targetSocket = socketForNickname(targetName);
    if (!targetSocket) return socket.emit("errorMessage", "친구가 오프라인입니다.");
    const message = { from: nickname, to: targetName, text: cleanText, time: Date.now() };
    targetSocket.emit("whisperMessage", message);
    pushNotification(targetName,"whisper",`${nickname}님의 귓속말`,{from:nickname});
    socket.emit("whisperMessage", message);
  });

  socket.on("blockPlayer", ({ nickname: targetName }) => {
    const nickname = socket.data.nickname;
    targetName = safePlayerKey(targetName);
    if (!nickname || !playerData[targetName] || targetName === nickname) return socket.emit("errorMessage", "차단 대상을 확인해 주세요.");
    const profile = ensureProfile(nickname);
    if (!profile.blockedPlayers.includes(targetName)) profile.blockedPlayers.push(targetName);
    savePlayerData();
    socket.emit("friendNotice", `${targetName}님을 차단했습니다.`);
    emitFriendsData(nickname);
  });

  socket.on("unblockPlayer", ({ nickname: targetName }) => {
    const nickname = socket.data.nickname;
    if (!nickname) return;
    const profile = ensureProfile(nickname);
    profile.blockedPlayers = profile.blockedPlayers.filter(name => name !== safePlayerKey(targetName));
    savePlayerData();
    socket.emit("friendNotice", `${safePlayerKey(targetName)}님의 차단을 해제했습니다.`);
    emitFriendsData(nickname);
  });

  socket.on("inviteFriend", ({ nickname: targetName }) => {
    const nickname = socket.data.nickname;
    targetName = safePlayerKey(targetName);
    const profile = ensureProfile(nickname);
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms[roomCode]) return socket.emit("errorMessage", "먼저 방에 입장해 주세요.");
    const room=rooms[roomCode];
    ensureRoomSocialFields(room);
    if (room.mode === "ranked") return socket.emit("errorMessage", "랭크 방에는 친구를 초대할 수 없습니다.");
    if (!profile.friends.includes(targetName)) return socket.emit("errorMessage", "친구만 초대할 수 있습니다.");
    const targetProfile=playerData[targetName] ? ensureProfile(targetName) : null;
    if (!targetProfile || profile.blockedPlayers.includes(targetName) || targetProfile.blockedPlayers.includes(nickname)) return socket.emit("errorMessage","차단된 플레이어는 초대할 수 없습니다.");
    const targetSocket = socketForNickname(targetName);
    if (!targetSocket) return socket.emit("errorMessage", "친구가 오프라인입니다.");
    if (targetSocket.data.roomCode===roomCode) return socket.emit("errorMessage","이미 같은 방에 있습니다.");
    if (room.players.filter(p=>p.connected&&!p.isSpectator).length>=room.maxPlayers) return socket.emit("errorMessage","방이 가득 찼습니다.");
    if (!targetSocket.data.roomInvites) targetSocket.data.roomInvites = {};
    targetSocket.data.roomInvites[roomCode] = { from: nickname, expiresAt: Date.now() + 60000 };
    targetSocket.emit("roomInvite", { from: nickname, roomCode, expiresAt:Date.now()+60000, title:room.customTitle||`${nickname}님의 방` });
    pushNotification(targetName,"party_invite",`${nickname}님의 파티 초대`,{from:nickname,roomCode});
    socket.emit("friendNotice", `${targetName}님에게 방 초대를 보냈습니다.`);
  });

  socket.on("declineRoomInvite", ({roomCode}) => {
    const invite=socket.data.roomInvites&&socket.data.roomInvites[String(roomCode||"")];
    if (!invite) return;
    delete socket.data.roomInvites[String(roomCode)];
    const inviter=socketForNickname(invite.from);
    if (inviter) inviter.emit("friendNotice",`${socket.data.nickname}님이 초대를 거절했습니다.`);
  });

  socket.on("joinFriendRoom", ({ roomCode, playerId: requestedPlayerId }) => {
    const nickname = socket.data.nickname;
    const room = rooms[String(roomCode || "")];
    if (!nickname || !room) return socket.emit("errorMessage", "유효하지 않은 친구 초대입니다.");
    const invite = socket.data.roomInvites && socket.data.roomInvites[String(roomCode || "")];
    if (!invite || invite.expiresAt < Date.now()) {
      return socket.emit("errorMessage", "만료되었거나 유효하지 않은 친구 초대입니다.");
    }
    const targetProfile=ensureProfile(nickname);
    const inviterProfile=ensureProfile(invite.from);
    if (targetProfile.blockedPlayers.includes(invite.from)||inviterProfile.blockedPlayers.includes(nickname)) return socket.emit("errorMessage","차단된 플레이어의 초대에는 참가할 수 없습니다.");
    const inviter = room.players.find(player =>
      !player.isBot &&
      player.nickname === invite.from &&
      ensureProfile(nickname).friends.includes(player.nickname)
    );
    if (!inviter) return socket.emit("errorMessage", "유효하지 않은 친구 초대입니다.");
    ensureRoomSocialFields(room);
    if (room.mode === "ranked") return socket.emit("errorMessage", "랭크 방은 친구 초대로 참가할 수 없습니다.");
    const asSpectator=room.status!=="waiting";
    if (asSpectator&&!room.spectatorsEnabled) return socket.emit("errorMessage","이 방은 관전을 허용하지 않습니다.");
    if (!asSpectator&&room.players.filter(p=>p.connected&&!p.isSpectator).length>=room.maxPlayers) return socket.emit("errorMessage", "방이 가득 찼습니다.");
    const safePlayerId = String(requestedPlayerId || "").slice(0, 80);
    if (!safePlayerId) return socket.emit("errorMessage", "플레이어 정보가 없습니다.");
    upsertPlayer(room, socket, safePlayerId, nickname, asSpectator);
    socket.data.roomCode = String(roomCode);
    socket.data.playerId = safePlayerId;
    delete socket.data.roomInvites[String(roomCode)];
    socket.join(String(roomCode));
    broadcastFriendPresence(nickname);
    socket.emit("joinedRoom", String(roomCode));
    addSystemMessage(String(roomCode), `🤝 ${nickname}님이 친구 초대로 입장했습니다.`);
    sendRoomUpdate(String(roomCode));
  });

  socket.on("register", ({ nickname, password }) => {
    nickname = safePlayerKey(nickname);

    if (!isValidNickname(nickname)) {
      socket.emit("authError", "닉네임은 2~12자 한글/영어/숫자/_ 만 가능!");
      return;
    }

    if (!isValidPassword(password)) {
      socket.emit("authError", "비밀번호는 4~30자로 입력!");
      return;
    }

    if (playerData[nickname]) {
      socket.emit("authError", "이미 사용 중인 닉네임입니다.");
      return;
    }

    const profile = getDefaultProfile(nickname);
    profile.salt = makeSalt();
    profile.passwordHash = hashPassword(password, profile.salt);
    profile.sessionToken = makeToken();

    playerData[nickname] = profile;
    savePlayerData();

    socket.data.nickname = nickname;
    socket.emit("authSuccess", {
      nickname,
      token: profile.sessionToken,
      profile: publicProfile(nickname)
    });
    emitPremiumData(socket);
  });

  socket.on("login", ({ nickname, password }) => {
    nickname = safePlayerKey(nickname);
    const profile = playerData[nickname];

    if (!profile || !profile.passwordHash || !profile.salt) {
      socket.emit("authError", "존재하지 않는 닉네임입니다.");
      return;
    }

    if (hashPassword(password, profile.salt) !== profile.passwordHash) {
      socket.emit("authError", "비밀번호가 틀렸습니다.");
      return;
    }

    profile.sessionToken = makeToken();
    savePlayerData();

    socket.data.nickname = nickname;
    socket.emit("authSuccess", {
      nickname,
      token: profile.sessionToken,
      profile: publicProfile(nickname)
    });
    emitPremiumData(socket);
  });

  socket.on("autoLogin", ({ nickname, token }) => {
    nickname = safePlayerKey(nickname);
    const profile = playerData[nickname];

    if (!profile || !token || profile.sessionToken !== token) {
      socket.emit("authError", "자동 로그인 실패");
      return;
    }

    socket.data.nickname = nickname;
    socket.emit("authSuccess", {
      nickname,
      token: profile.sessionToken,
      profile: publicProfile(nickname)
    });
    emitPremiumData(socket);
  });

  socket.on("logout", () => {
    const nickname = socket.data.nickname;
    socket.data.nickname = null;
    socket.emit("loggedOut");
    if (nickname) broadcastFriendPresence(nickname);
  });


  socket.on("createRoom", ({ password, playerId, isPublic, botCount, botDifficulty }) => {
    const nickname = socket.data.nickname;

    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 방을 만들 수 있습니다.");
      return;
    }

    if (!playerId) {
      socket.emit("errorMessage", "플레이어 정보가 없습니다.");
      return;
    }

    const roomCode = makeRoomCode();

    rooms[roomCode] = {
      mode: "normal",
      players: [],
      password: String(password || ""),
      isPublic: isPublic !== false,
      createdAt: Date.now(),
      hostId: playerId,
      currentWord: "",
      startWord: "",
      turn: 0,
      usedWords: [],
      status: "waiting",
      timeLimit: 20,
      timeLeft: 20,
      wrongCount: 0,
      gameoverReason: "",
      winnerText: "",
      lastNotice: "",
      notice: "",
      noticeUntil: 0,
      chatMessages: [],
      readyPlayers: {},
      countdown: 0,
      countdownTimer: null,
      botTimeout: null,
      matchStartedAt: 0,
      matchEndedAt: 0,
      eliminationOrder: [],
      rewards: [],
      statsApplied: false,
      turnDeadline: 0,
      timerToken: 0,
      timer: null
    };

    upsertPlayer(rooms[roomCode], socket, playerId, nickname);
    addBotsToRoom(rooms[roomCode], roomCode, botCount, botDifficulty);

    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;

    socket.join(roomCode);
    broadcastFriendPresence(nickname);
    socket.emit("roomCreated", roomCode);
    addSystemMessage(roomCode, `🟢 ${nickname}님이 방을 만들었습니다.`);
    sendRoomUpdate(roomCode);
  });

  socket.on("randomMatch", ({ playerId }) => {
    const nickname = socket.data.nickname;

    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 랜덤 매칭을 사용할 수 있습니다.");
      return;
    }

    if (!playerId) {
      socket.emit("errorMessage", "플레이어 정보가 없습니다.");
      return;
    }

    let matchedCode = "";

    for (const code of Object.keys(rooms)) {
      const room = rooms[code];

      if (!room) continue;
      ensureRoomSocialFields(room);
      if (room.mode !== "normal") continue;
      if (!room.isPublic) continue;
      if (room.password) continue;
      if (room.status !== "waiting") continue;
      if (room.players.length >= 8 && !findPlayer(room, playerId)) continue;

      matchedCode = code;
      break;
    }

    let created = false;

    if (!matchedCode) {
      matchedCode = makeRoomCode();
      created = true;

      rooms[matchedCode] = {
        mode: "normal",
        players: [],
        password: "",
        isPublic: true,
        createdAt: Date.now(),
        hostId: playerId,
        currentWord: "",
        startWord: "",
        turn: 0,
        usedWords: [],
        status: "waiting",
        timeLimit: 20,
        timeLeft: 20,
        wrongCount: 0,
        gameoverReason: "",
        winnerText: "",
        lastNotice: "",
        notice: "",
        noticeUntil: 0,
        chatMessages: [],
        readyPlayers: {},
        countdown: 0,
        countdownTimer: null,
        botTimeout: null,
        matchStartedAt: 0,
        matchEndedAt: 0,
        eliminationOrder: [],
        rewards: [],
        statsApplied: false,
        turnDeadline: 0,
        timerToken: 0,
        timer: null
      };
    }

    const room = rooms[matchedCode];

    upsertPlayer(room, socket, playerId, nickname);

    socket.data.roomCode = matchedCode;
    socket.data.playerId = playerId;

    socket.join(matchedCode);
    broadcastFriendPresence(nickname);

    if (created) {
      socket.emit("roomCreated", matchedCode);
    } else {
      socket.emit("joinedRoom", matchedCode);
    }

    addSystemMessage(matchedCode, created ? `🎲 ${nickname}님이 랜덤 매칭방을 만들었습니다.` : `🎉 ${nickname}님이 랜덤 매칭으로 입장했습니다.`);

    sendRoomUpdate(matchedCode);
    broadcastRoomList();
  });

  socket.on("getRankedData", () => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 랭크 정보를 확인할 수 있습니다.");
    socket.emit("rankedData", publicRankedData(ensureProfile(nickname)));
  });

  socket.on("getRankedLeaderboard", () => {
  const board = Object.keys(playerData)
    .map(nickname => {
      const profile = ensureProfile(nickname);
      const ranked = publicRankedData(profile);
      return {
        nickname,
        ...ranked
      };
    })
    .filter(p => p.placementMatchesPlayed > 0 || p.rankedWins > 0 || p.rankedLosses > 0)
    .sort((a, b) => {
      const tierOrder = ["Bronze","Silver","Gold","Platinum","Diamond","Emerald","Ruby","Master","Grandmaster","Mythic"];
      const at = tierOrder.indexOf(a.rankTier);
      const bt = tierOrder.indexOf(b.rankTier);
      if (bt !== at) return bt - at;
      if (a.rankDivision !== b.rankDivision) return a.rankDivision - b.rankDivision;
      if (b.rankLP !== a.rankLP) return b.rankLP - a.rankLP;
      return b.rankedWins - a.rankedWins;
    })
    .slice(0, 100);

  socket.emit("rankedLeaderboard", board);
});

  socket.on("rankedMatch", ({ playerId } = {}) => {
    const nickname = socket.data.nickname;
    if (!nickname) return socket.emit("errorMessage", "로그인 후 랭크 매칭을 이용할 수 있습니다.");
    if (!playerId) return socket.emit("errorMessage", "플레이어 정보가 없습니다.");

    const currentRoom = rooms[socket.data.roomCode];
    const currentPlayer = currentRoom && findPlayer(currentRoom, socket.data.playerId);
    if (currentPlayer?.connected) {
      return socket.emit("errorMessage", "현재 방을 나간 뒤 랭크 매칭을 시작해 주세요.");
    }

    let matchedCode = Object.keys(rooms).find(code => {
      const room = rooms[code];
      if (!room) return false;
      ensureRoomSocialFields(room);
      const activePlayers = room.players.filter(p => p.connected && !p.isBot && !p.isSpectator);
      return room.mode === "ranked"
        && room.status === "waiting"
        && activePlayers.length === 1
        && !findPlayer(room, playerId);
    }) || "";
    let created = false;

    if (!matchedCode) {
      matchedCode = makeRoomCode();
      created = true;
      rooms[matchedCode] = {
        mode: "ranked",
        players: [],
        password: "",
        isPublic: false,
        createdAt: Date.now(),
        hostId: playerId,
        maxPlayers: 2,
        currentWord: "",
        startWord: "",
        turn: 0,
        usedWords: [],
        status: "waiting",
        timeLimit: 20,
        timeLeft: 20,
        wrongCount: 0,
        gameoverReason: "",
        winnerText: "",
        lastNotice: "",
        notice: "",
        noticeUntil: 0,
        chatMessages: [],
        readyPlayers: {},
        countdown: 0,
        countdownTimer: null,
        botTimeout: null,
        matchStartedAt: 0,
        matchEndedAt: 0,
        eliminationOrder: [],
        rewards: [],
        statsApplied: false,
        turnDeadline: 0,
        timerToken: 0,
        timer: null
      };
    }

    const room = rooms[matchedCode];
    upsertPlayer(room, socket, String(playerId).slice(0, 80), nickname);
    socket.data.roomCode = matchedCode;
    socket.data.playerId = String(playerId).slice(0, 80);
    socket.join(matchedCode);
    broadcastFriendPresence(nickname);
    socket.emit(created ? "roomCreated" : "joinedRoom", matchedCode);
    addSystemMessage(
      matchedCode,
      created
        ? `🏆 ${nickname}님이 랭크 매칭을 시작했습니다.`
        : `⚔️ ${nickname}님이 랭크 매칭에 참가했습니다.`
    );
    sendRoomUpdate(matchedCode);
  });

  socket.on("joinRoom", ({ roomCode, password, playerId }) => {
    const nickname = socket.data.nickname;
    const room = rooms[roomCode];

    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 참가할 수 있습니다.");
      return;
    }

    if (!room) {
      socket.emit("errorMessage", "없는 방입니다.");
      return;
    }

    if (!playerId) {
      socket.emit("errorMessage", "플레이어 정보가 없습니다.");
      return;
    }
    ensureRoomSocialFields(room);
    if (room.mode === "ranked") {
      return socket.emit("errorMessage", "랭크 방은 랭크 매칭을 통해서만 참가할 수 있습니다.");
    }
    if (room.isLocked) return socket.emit("errorMessage","방장이 방을 잠갔습니다.");

    if (room.password && room.password !== String(password)) {
      socket.emit("errorMessage", "비밀번호가 올바르지 않습니다.");
      return;
    }

    if (room.status === "playing") {
      socket.emit("errorMessage", "이미 게임이 시작된 방입니다.");
      return;
    }

    if (room.players.filter(p=>p.connected&&!p.isSpectator).length >= room.maxPlayers && !findPlayer(room, playerId)) {
      socket.emit("errorMessage", "방이 가득 찼습니다.");
      return;
    }

    upsertPlayer(room, socket, playerId, nickname);

    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;

    socket.join(roomCode);
    broadcastFriendPresence(nickname);
    socket.emit("joinedRoom", roomCode);
    addSystemMessage(roomCode, `🟢 ${nickname}님이 입장했습니다.`);

    setTimeout(() => {
      sendRoomUpdate(roomCode);
    }, 100);
  });

  socket.on("spectateRoom", ({roomCode,playerId}) => {
    const nickname=socket.data.nickname;
    const room=rooms[String(roomCode||"")];
    if (!nickname||!room||!playerId) return socket.emit("errorMessage","관전할 방을 찾을 수 없습니다.");
    ensureRoomSocialFields(room);
    if (!room.spectatorsEnabled) return socket.emit("errorMessage","관전이 비활성화된 방입니다.");
    if (ensureProfile(nickname).blockedPlayers.some(name=>room.players.some(p=>p.nickname===name))) return socket.emit("errorMessage","차단 관계가 있는 방은 관전할 수 없습니다.");
    upsertPlayer(room,socket,String(playerId).slice(0,80),nickname,true);
    socket.data.roomCode=String(roomCode);socket.data.playerId=String(playerId).slice(0,80);
    socket.join(String(roomCode));socket.emit("joinedRoom",String(roomCode));
    addSystemMessage(String(roomCode),`👀 ${nickname}님이 관전을 시작했습니다.`);
    sendRoomUpdate(String(roomCode));
  });

  socket.on("switchWatchedPlayer", ({playerId}) => {
    const room=rooms[socket.data.roomCode];const player=room&&findPlayer(room,socket.data.playerId);
    if (!player?.isSpectator) return;
    if (!room.players.some(p=>p.playerId===playerId&&!p.isSpectator)) return;
    player.watchedPlayerId=String(playerId);sendRoomUpdate(socket.data.roomCode);
  });

  socket.on("updateRoomSettings", settings => {
    const room=ownedRoomForSocket(socket);
    if (!room) return socket.emit("errorMessage","방장만 방 설정을 변경할 수 있습니다.");
    ensureRoomSocialFields(room);
    if (room.mode === "ranked") return socket.emit("errorMessage", "랭크 방 설정은 변경할 수 없습니다.");
    if (typeof settings.title==="string") room.customTitle=settings.title.trim().slice(0,30);
    if (Number.isFinite(Number(settings.maxPlayers))) {
      const next=Math.max(2,Math.min(12,Math.floor(Number(settings.maxPlayers))));
      if (next<room.players.filter(p=>p.connected&&!p.isSpectator).length) return socket.emit("errorMessage","현재 플레이어 수보다 작게 설정할 수 없습니다.");
      room.maxPlayers=next;
    }
    if (typeof settings.password==="string") room.password=settings.password.slice(0,30);
    if (typeof settings.locked==="boolean") room.isLocked=settings.locked;
    if (typeof settings.spectatorsEnabled==="boolean") room.spectatorsEnabled=settings.spectatorsEnabled;
    if (typeof settings.chatEnabled==="boolean") room.chatEnabled=settings.chatEnabled;
    addSystemMessage(socket.data.roomCode,"⚙ 방 설정이 변경되었습니다.");
    sendRoomUpdate(socket.data.roomCode);broadcastRoomList();
  });

  socket.on("setRoomAnnouncement", ({text,color}) => {
    const room=ownedRoomForSocket(socket);
    if (!room) return socket.emit("errorMessage","방장만 공지를 편집할 수 있습니다.");
    ensureRoomSocialFields(room);
    room.announcement={text:String(text||"").trim().slice(0,180),color:/^#[0-9a-f]{6}$/i.test(color)?color:"#ffd54a"};
    sendRoomUpdate(socket.data.roomCode);
  });

  socket.on("kickPlayer", ({playerId}) => {
    const room=ownedRoomForSocket(socket);
    if (!room||playerId===room.hostId) return socket.emit("errorMessage","추방할 수 없는 플레이어입니다.");
    const target=findPlayer(room,String(playerId));if (!target||target.isBot) return socket.emit("errorMessage","플레이어를 찾을 수 없습니다.");
    const client=io.sockets.sockets.get(target.socketId);
    if (client) { client.leave(socket.data.roomCode);client.data.roomCode=null;client.emit("kickedFromRoom","방장에 의해 추방되었습니다."); }
    if (room.status==="playing") {target.connected=false;target.eliminated=true;addElimination(room,target,"방장 추방");}
    else room.players=room.players.filter(p=>p.playerId!==target.playerId);
    addSystemMessage(socket.data.roomCode,`🚫 ${target.nickname}님이 추방되었습니다.`);
    sendRoomUpdate(socket.data.roomCode);broadcastRoomList();
  });

  socket.on("transferRoomOwnership", ({playerId}) => {
    const room=ownedRoomForSocket(socket);const target=room&&findPlayer(room,String(playerId));
    if (!room||!target||target.isBot||target.isSpectator||!target.connected) return socket.emit("errorMessage","방장을 위임할 수 없습니다.");
    room.hostId=target.playerId;addSystemMessage(socket.data.roomCode,`👑 ${target.nickname}님이 새 방장이 되었습니다.`);
    sendRoomUpdate(socket.data.roomCode);
  });

  socket.on("leaveRoom", () => {
    const roomCode=socket.data.roomCode;const room=rooms[roomCode];const player=room&&findPlayer(room,socket.data.playerId);
    if (!room||!player) return;
    socket.leave(roomCode);room.players=room.players.filter(p=>p.playerId!==player.playerId);
    delete room.readyPlayers[player.playerId];
    if (room.hostId===player.playerId) {
      const next=room.players.find(p=>p.connected&&!p.isBot&&!p.isSpectator);
      if (next) room.hostId=next.playerId;
    }
    socket.data.roomCode=null;socket.emit("leftRoom");
    if (!room.players.some(p=>p.connected&&!p.isBot)) {stopTimer(room);delete rooms[roomCode];}
    else {addSystemMessage(roomCode,`🚪 ${player.nickname}님이 나갔습니다.`);sendRoomUpdate(roomCode);}
    broadcastRoomList();broadcastFriendPresence(player.nickname);
  });

  socket.on("startGame", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.hostId !== socket.data.playerId) {
      socket.emit("errorMessage", "방장만 게임을 시작할 수 있습니다.");
      return;
    }

    if (room.status === "playing" || room.status === "countdown") return;

    if (!canStartRoom(room)) {
      socket.emit("errorMessage", "모든 플레이어가 준비해야 시작할 수 있습니다.");
      sendRoomUpdate(roomCode);
      return;
    }

    startCountdown(roomCode);
  });

  socket.on("toggleReady", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.status !== "waiting") return;

    const player = findPlayer(room, socket.data.playerId);

    if (!player || player.isBot || player.isSpectator) return;

    if (!room.readyPlayers) {
      room.readyPlayers = {};
    }

    room.readyPlayers[player.playerId] = !room.readyPlayers[player.playerId];

    addSystemMessage(
      roomCode,
      room.readyPlayers[player.playerId]
        ? `✅ ${player.nickname}님 준비 완료`
        : `⏳ ${player.nickname}님 준비 취소`
    );

    sendRoomUpdate(roomCode);
  });

  socket.on("requestRematch", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.status !== "gameover") return;

    if (room.hostId !== socket.data.playerId) {
      socket.emit("errorMessage", "방장만 재경기를 준비할 수 있습니다.");
      return;
    }

    prepareRematch(roomCode);
  });

    socket.on("submitWord", ({ roomCode, word }) => {
    const room = rooms[roomCode];
    if (!room || room.status !== "playing") return;

    normalizeTurn(room);
    word = String(word || "").trim();

    const submittingPlayer=findPlayer(room,socket.data.playerId);
    if (submittingPlayer?.isSpectator) return socket.emit("errorMessage","관전자는 단어를 제출할 수 없습니다.");
    const player = currentPlayer(room);

    if (!player || player.socketId !== socket.id || player.eliminated || !player.connected) {
      socket.emit("errorMessage", "네 차례가 아닙니다.");
      return;
    }

    function wrong(msg) {
      room.wrongCount++;

      const chance =
        room.wrongCount === 4
          ? "\n\n🚨 마지막 기회!"
          : room.wrongCount >= 3
            ? "\n\n⚠️ 조심! 곧 탈락!"
            : "";

      const noticeText = `❌ 오답!\n\n${msg}\n\n(${room.wrongCount}/5)${chance}`;

      socket.emit("errorMessage", noticeText);
      setRoomNotice(roomCode, noticeText, 2600);

      if (room.wrongCount >= 5) {
        eliminatePlayer(roomCode, player, "한 턴에 5번 틀림");
      } else {
        sendRoomUpdate(roomCode);
      }
    }

    if (!isKoreanWord(word)) {
      wrong("👉 두 글자 이상의 한글 단어만 입력!");
      return;
    }

    if (!wordExists(word)) {
      wrong("👉 사전에 없는 단어입니다!");
      return;
    }

    if (room.usedWords.includes(word) || word === room.startWord) {
      wrong("👉 이미 사용한 단어입니다!");
      return;
    }

    if (room.usedWords.length === 0 && isOneShotWord(word)) {
      wrong("👉 첫 번째 단어로는 한방단어 금지!");
      return;
    }

    if (room.currentWord) {
      const last = room.currentWord[room.currentWord.length - 1];
      const first = word[0];

      if (!isValidChain(last, first)) {
        const starts = getDueumStarts(last).join(" 또는 ");
        wrong(`👉 ${starts}로 시작!`);
        return;
      }
    }

    room.currentWord = word;
    room.usedWords.push(word);

    if (!player.isBot) {
      const profile = ensureProfile(player.nickname);
      profile.wordsUsed++;
      addXp(profile, 1);
      recordQuestProgress(profile, { words: 1, xp: 1 });
      updateTitles(profile);
      checkAchievements(profile);
      savePlayerData();
    }

    room.wrongCount = 0;
    room.lastNotice = "";
    room.turn = nextActiveTurn(room, room.turn);

    setTimeLimitByTurn(room);
    startTurnTimer(roomCode);
  });

  socket.on("getShop", () => {
    const nickname = socket.data.nickname;

    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
      return;
    }

    socket.emit("shopData", publicShopProfile(nickname));
  });

  socket.on("buyItem", ({ itemId }) => {
    const nickname = socket.data.nickname;

    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
      return;
    }

    const result = buyShopItem(nickname, itemId);

    if (!result.ok) {
      socket.emit("errorMessage", result.message);
      return;
    }

    socket.emit("shopNotice", result.message);
    socket.emit("shopData", publicShopProfile(nickname));
    socket.emit("profileData", publicProfile(nickname));
  });

  socket.on("equipItem", ({ itemId }) => {
    const nickname = socket.data.nickname;

    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
      return;
    }

    const result = equipShopItem(nickname, itemId);

    if (!result.ok) {
      socket.emit("errorMessage", result.message);
      return;
    }

    socket.emit("shopNotice", result.message);
    socket.emit("shopData", publicShopProfile(nickname));
    socket.emit("profileData", publicProfile(nickname));

    const roomCode = socket.data.roomCode;
    if (roomCode) sendRoomUpdate(roomCode);
  });

  socket.on("unequipItem", ({ type }) => {
    const nickname = socket.data.nickname;

    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
      return;
    }

    const result = unequipShopType(nickname, type);

    if (!result.ok) {
      socket.emit("errorMessage", result.message);
      return;
    }

    socket.emit("shopNotice", result.message);
    socket.emit("shopData", publicShopProfile(nickname));
    socket.emit("profileData", publicProfile(nickname));

    const roomCode = socket.data.roomCode;
    if (roomCode) sendRoomUpdate(roomCode);
  });

  socket.on("getRankings", () => {
    socket.emit("rankingData", getRankings(socket.data.nickname));
  });

  socket.on("getProfile", ({ nickname }) => {
    socket.emit("profileData", publicProfile(nickname));
  });

  socket.on("getAchievements", ({ nickname }) => {
    const profile = ensureProfile(nickname || socket.data.nickname);
    socket.emit("achievementData", {
      profile: publicProfile(profile.nickname),
      achievements: getAchievementProgress(profile)
    });
  });

  socket.on("selectTitle", ({ title }) => {
    const nickname = socket.data.nickname;
    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 사용할 수 있습니다.");
      return;
    }

    const profile = ensureProfile(nickname);
    ensureAchievementFields(profile);

    if (!profile.titles.includes(title)) {
      socket.emit("errorMessage", "보유하지 않은 칭호입니다.");
      return;
    }

    profile.selectedTitle = title;
    savePlayerData();

    socket.emit("profileData", publicProfile(nickname));
    socket.emit("achievementData", {
      profile: publicProfile(nickname),
      achievements: getAchievementProgress(profile)
    });
  });

  socket.on("sendChat", ({ roomCode, text }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("errorMessage", "방이 없습니다.");
      return;
    }
    ensureRoomSocialFields(room);
    if (!room.chatEnabled && room.hostId!==socket.data.playerId) return socket.emit("errorMessage","방장이 채팅을 비활성화했습니다.");

    const player = findPlayer(room, socket.data.playerId);

    if (!player) {
      socket.emit("errorMessage", "채팅을 보낼 수 없습니다.");
      return;
    }

    const cleanText = String(text || "").trim().slice(0, 100);

    if (!cleanText) {
      return;
    }

    addChatMessage(roomCode, {
      type: "user",
      nickname: player.nickname,
      style: player.isBot ? null : publicStyleForNickname(player.nickname),
      text: cleanText,
      time: Date.now()
    });
  });

  socket.on("roomTyping", ({roomCode,typing}) => {
    const room=rooms[String(roomCode||"")];const player=room&&findPlayer(room,socket.data.playerId);
    if (!room||!player) return;
    socket.to(String(roomCode)).emit("roomTyping",{nickname:player.nickname,typing:!!typing});
  });

  socket.on("disconnect", () => {
    const nickname = socket.data.nickname;
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;

    if (nickname) broadcastFriendPresence(nickname);
    if (!roomCode || !playerId || !rooms[roomCode]) return;

    const room = rooms[roomCode];
    const player = findPlayer(room, playerId);

    if (player && player.socketId === socket.id) {
      player.connected = false;
    }

    sendRoomUpdate(roomCode);

    setTimeout(() => {
      const r = rooms[roomCode];
      if (!r) return;

      const humanCount = r.players.filter(player => !player.isBot && player.connected).length;

      if (humanCount === 0) {
        stopTimer(r);
        delete rooms[roomCode];
        broadcastRoomList();
        return;
      }

      const p = findPlayer(r, playerId);

      if (p && p.connected) return;

      if (r.status === "playing" && p && !p.eliminated) {
        p.eliminated = true;
        p.connected = false;
        addElimination(r, p, "연결 끊김");
        addSystemMessage(roomCode, `💀 ${p.nickname}님 탈락! (연결 끊김)`);

        if (activePlayers(r).length <= 1) {
          gameOver(roomCode, `${p.nickname}님이 나가서 게임오버!`);
          return;
        }

        resetRoundAfterElimination(r);
        r.turn = nextActiveTurn(r, r.turn);
        startTurnTimer(roomCode);
        return;
      }

      const oldTurnPlayer = r.players[r.turn];

      r.players = r.players.filter(player => player.playerId !== playerId);

      if (r.players.length === 0) {
        stopTimer(r);
        delete rooms[roomCode];
        broadcastRoomList();
        return;
      }

      if (r.hostId === playerId) {
        r.hostId = r.players[0].playerId;
      }

      if (oldTurnPlayer && oldTurnPlayer.playerId === playerId) {
        r.turn = nextActiveTurn(r, r.turn);
      }

      sendRoomUpdate(roomCode);
    }, 30000);
  });
});

function start(port = process.env.PORT || 3000) {
  return server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = { start, app, server, io };

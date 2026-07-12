"use strict";

function createJsonStore({ fs, path, dataDir, filename, defaultValue }) {
  const file = path.join(dataDir, filename);
  function ensureDir() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  }
  function load() {
    ensureDir();
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2), "utf8");
      return JSON.parse(JSON.stringify(defaultValue));
    }
    try {
      return { ...JSON.parse(JSON.stringify(defaultValue)), ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch {
      return JSON.parse(JSON.stringify(defaultValue));
    }
  }
  function save(data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  }
  return { file, load, save };
}

const ROLE_ORDER = { owner: 4, viceLeader: 3, officer: 2, member: 1 };
const ROLE_LABELS = { owner: "Owner", viceLeader: "Vice Leader", officer: "Officer", member: "Member" };
const LEVEL_REWARDS = [
  { level: 1, maxMembers: 20 },
  { level: 2, maxMembers: 25 },
  { level: 3, unlock: "clan_banner" },
  { level: 5, unlock: "animated_emblem" },
  { level: 10, unlock: "special_frame" }
];

function xpForLevel(level) {
  return 800 + Math.max(1, level) * 450;
}

function cleanText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function createClanService({ fs, path, dataDir, makeToken, safePlayerKey }) {
  const store = createJsonStore({
    fs, path, dataDir, filename: "clans.json",
    defaultValue: { version: 1, clans: {}, deletedClans: [] }
  });
  let data = store.load();

  function save() { store.save(data); }
  function allClans() { return Object.values(data.clans || {}); }
  function getClan(id) { return data.clans[String(id || "")] || null; }
  function findPlayerClan(nickname) {
    nickname = safePlayerKey(nickname);
    return allClans().find(clan => clan.members && clan.members[nickname]) || null;
  }
  function getRole(clan, nickname) {
    return clan?.members?.[safePlayerKey(nickname)]?.role || "";
  }
  function hasPermission(clan, nickname, permission) {
    const role = getRole(clan, nickname);
    if (role === "owner") return true;
    if (permission === "chat") return !!role;
    if (["invite", "edit", "kick", "requests"].includes(permission)) {
      if (role === "viceLeader") return true;
      if (permission === "requests" || permission === "invite") return role === "officer";
    }
    return false;
  }
  function normalizeClan(clan) {
    clan.members = clan.members || {};
    clan.requests = Array.isArray(clan.requests) ? clan.requests : [];
    clan.invites = Array.isArray(clan.invites) ? clan.invites : [];
    clan.chat = Array.isArray(clan.chat) ? clan.chat.slice(-120) : [];
    clan.announcements = Array.isArray(clan.announcements) ? clan.announcements.slice(-10) : [];
    clan.history = Array.isArray(clan.history) ? clan.history.slice(-50) : [];
    clan.level = Math.max(1, Math.floor(Number(clan.level) || 1));
    clan.xp = Math.max(0, Math.floor(Number(clan.xp) || 0));
    clan.coins = Math.max(0, Math.floor(Number(clan.coins) || 0));
    clan.wins = Math.max(0, Math.floor(Number(clan.wins) || 0));
    clan.losses = Math.max(0, Math.floor(Number(clan.losses) || 0));
    clan.seasonPoints = Math.max(0, Math.floor(Number(clan.seasonPoints) || 0));
    clan.maxMembers = Math.max(20, Math.floor(Number(clan.maxMembers) || 20));
    clan.warStats = clan.warStats || { wins: 0, losses: 0, longestStreak: 0, currentStreak: 0, seasonRating: 1000 };
    clan.missions = clan.missions || defaultClanMissions();
    return clan;
  }
  function defaultClanMissions() {
    return [
      { id: "clan_play_50", name: "단체전 준비", type: "matches", target: 50, progress: 0, claimed: false, reward: { xp: 1000, coins: 250 } },
      { id: "clan_win_20", name: "승리의 깃발", type: "wins", target: 20, progress: 0, claimed: false, reward: { xp: 1500, coins: 400 } },
      { id: "clan_words_500", name: "단어의 보고", type: "words", target: 500, progress: 0, claimed: false, reward: { xp: 1800, coins: 500 } },
      { id: "clan_long_100", name: "장문 연구회", type: "longWords", target: 100, progress: 0, claimed: false, reward: { xp: 2200, coins: 650 } },
      { id: "clan_combo_100", name: "콤보 합주", type: "combo", target: 100, progress: 0, claimed: false, reward: { xp: 2500, coins: 800 } }
    ];
  }
  function applyClanXp(clan, amount) {
    clan.xp += Math.max(0, Math.floor(Number(amount) || 0));
    const unlocked = [];
    while (clan.xp >= xpForLevel(clan.level)) {
      clan.xp -= xpForLevel(clan.level);
      clan.level++;
      const reward = LEVEL_REWARDS.find(item => item.level === clan.level);
      if (reward?.maxMembers) clan.maxMembers = Math.max(clan.maxMembers, reward.maxMembers);
      if (reward?.unlock) {
        clan.unlocks = Array.isArray(clan.unlocks) ? clan.unlocks : [];
        if (!clan.unlocks.includes(reward.unlock)) clan.unlocks.push(reward.unlock);
      }
      unlocked.push({ level: clan.level, reward });
    }
    return unlocked;
  }
  function publicClan(clan, viewer = "") {
    if (!clan) return null;
    normalizeClan(clan);
    const members = Object.entries(clan.members).map(([nickname, member]) => ({ nickname, ...member, roleLabel: ROLE_LABELS[member.role] || "Member" }));
    const wins = clan.wins || 0;
    const losses = clan.losses || 0;
    return {
      id: clan.id, name: clan.name, tag: clan.tag, description: clan.description,
      banner: clan.banner, emblem: clan.emblem, isPublic: !!clan.isPublic,
      createdAt: clan.createdAt, level: clan.level, xp: clan.xp, nextXp: xpForLevel(clan.level),
      coins: clan.coins, memberCount: members.length, maxMembers: clan.maxMembers,
      wins, losses, winRate: wins + losses ? Math.round(wins / (wins + losses) * 100) : 0,
      seasonPoints: clan.seasonPoints, members, requests: hasPermission(clan, viewer, "requests") ? clan.requests : [],
      announcements: clan.announcements, chat: clan.chat.slice(-60), missions: clan.missions,
      warStats: clan.warStats, unlocks: clan.unlocks || [], viewerRole: getRole(clan, viewer), canManage: hasPermission(clan, viewer, "requests")
    };
  }
  function listPublicClans(viewer = "") {
    return allClans().map(clan => publicClan(clan, viewer)).sort((a, b) => (b.seasonPoints - a.seasonPoints) || (b.level - a.level) || a.name.localeCompare(b.name, "ko"));
  }
  function rankings(sortBy = "seasonPoints") {
    const key = ["seasonPoints", "xp", "wins", "activity"].includes(sortBy) ? sortBy : "seasonPoints";
    return allClans().map(clan => {
      normalizeClan(clan);
      return { id: clan.id, name: clan.name, tag: clan.tag, level: clan.level, seasonPoints: clan.seasonPoints, xp: clan.xp, wins: clan.wins, activity: clan.history.length };
    }).sort((a, b) => (b[key] - a[key]) || (b.seasonPoints - a.seasonPoints)).slice(0, 100);
  }
  function createClan(owner, payload) {
    owner = safePlayerKey(owner);
    if (findPlayerClan(owner)) return { ok: false, message: "이미 클랜에 가입되어 있습니다." };
    const name = cleanText(payload.name, 24);
    const tag = cleanText(payload.tag, 5).toUpperCase();
    if (name.length < 2 || tag.length < 2) return { ok: false, message: "클랜 이름과 태그는 2글자 이상이어야 합니다." };
    if (allClans().some(c => c.name.toLowerCase() === name.toLowerCase() || c.tag.toLowerCase() === tag.toLowerCase())) return { ok: false, message: "이미 사용 중인 클랜 이름 또는 태그입니다." };
    const id = makeToken().slice(0, 10);
    const clan = normalizeClan({
      id, name, tag, description: cleanText(payload.description, 220), banner: cleanText(payload.banner, 48) || "aurora",
      emblem: cleanText(payload.emblem, 12) || "🛡️", isPublic: payload.isPublic !== false, createdAt: Date.now(),
      level: 1, xp: 0, coins: 0, maxMembers: 20, wins: 0, losses: 0, seasonPoints: 0,
      owner, members: { [owner]: { role: "owner", joinedAt: Date.now(), contribution: 0 } }
    });
    data.clans[id] = clan;
    save();
    return { ok: true, clan };
  }
  function deleteClan(actor, clanId) {
    const clan = getClan(clanId);
    if (!clan || getRole(clan, actor) !== "owner") return { ok: false, message: "클랜 삭제 권한이 없습니다." };
    delete data.clans[clan.id];
    data.deletedClans.push({ id: clan.id, name: clan.name, deletedAt: Date.now(), by: safePlayerKey(actor) });
    save();
    return { ok: true, clan };
  }
  function requestJoin(nickname, clanId) {
    const clan = getClan(clanId);
    nickname = safePlayerKey(nickname);
    if (!clan) return { ok: false, message: "클랜을 찾을 수 없습니다." };
    if (findPlayerClan(nickname)) return { ok: false, message: "이미 클랜에 가입되어 있습니다." };
    if (Object.keys(clan.members).length >= clan.maxMembers) return { ok: false, message: "클랜 정원이 가득 찼습니다." };
    if (clan.isPublic) {
      clan.members[nickname] = { role: "member", joinedAt: Date.now(), contribution: 0 };
      clan.chat.push({ type: "system", text: `${nickname}님이 클랜에 가입했습니다.`, time: Date.now() });
    } else if (!clan.requests.includes(nickname)) clan.requests.push(nickname);
    save();
    return { ok: true, clan, joined: !!clan.members[nickname] };
  }
  function manageRequest(actor, clanId, target, accept) {
    const clan = getClan(clanId);
    target = safePlayerKey(target);
    if (!clan || !hasPermission(clan, actor, "requests")) return { ok: false, message: "가입 요청 관리 권한이 없습니다." };
    if (!clan.requests.includes(target)) return { ok: false, message: "가입 요청을 찾을 수 없습니다." };
    clan.requests = clan.requests.filter(name => name !== target);
    if (accept) {
      if (Object.keys(clan.members).length >= clan.maxMembers) return { ok: false, message: "클랜 정원이 가득 찼습니다." };
      clan.members[target] = { role: "member", joinedAt: Date.now(), contribution: 0 };
      clan.chat.push({ type: "system", text: `${target}님이 클랜에 가입했습니다.`, time: Date.now() });
    }
    save();
    return { ok: true, clan };
  }
  function leaveClan(nickname) {
    const clan = findPlayerClan(nickname);
    nickname = safePlayerKey(nickname);
    if (!clan) return { ok: false, message: "가입한 클랜이 없습니다." };
    if (getRole(clan, nickname) === "owner" && Object.keys(clan.members).length > 1) return { ok: false, message: "소유자는 먼저 소유권을 이전해야 합니다." };
    delete clan.members[nickname];
    clan.chat.push({ type: "system", text: `${nickname}님이 클랜을 떠났습니다.`, time: Date.now() });
    if (Object.keys(clan.members).length === 0) delete data.clans[clan.id];
    save();
    return { ok: true, clan };
  }
  function kickMember(actor, clanId, target) {
    const clan = getClan(clanId);
    target = safePlayerKey(target);
    if (!clan || !hasPermission(clan, actor, "kick")) return { ok: false, message: "추방 권한이 없습니다." };
    if (!clan.members[target] || clan.members[target].role === "owner") return { ok: false, message: "추방할 수 없는 대상입니다." };
    if (ROLE_ORDER[getRole(clan, actor)] <= ROLE_ORDER[clan.members[target].role]) return { ok: false, message: "같거나 높은 권한의 멤버는 추방할 수 없습니다." };
    delete clan.members[target];
    clan.chat.push({ type: "system", text: `${target}님이 클랜에서 추방되었습니다.`, time: Date.now() });
    save();
    return { ok: true, clan };
  }
  function transferOwnership(actor, clanId, target) {
    const clan = getClan(clanId);
    target = safePlayerKey(target);
    if (!clan || getRole(clan, actor) !== "owner" || !clan.members[target]) return { ok: false, message: "소유권 이전 권한이 없습니다." };
    clan.members[safePlayerKey(actor)].role = "viceLeader";
    clan.members[target].role = "owner";
    clan.owner = target;
    save();
    return { ok: true, clan };
  }
  function setRole(actor, clanId, target, role) {
    const clan = getClan(clanId);
    target = safePlayerKey(target);
    if (!clan || getRole(clan, actor) !== "owner" || !["viceLeader", "officer", "member"].includes(role) || !clan.members[target]) return { ok: false, message: "역할 변경 권한이 없습니다." };
    clan.members[target].role = role;
    save();
    return { ok: true, clan };
  }
  function updateClan(actor, clanId, payload) {
    const clan = getClan(clanId);
    if (!clan || !hasPermission(clan, actor, "edit")) return { ok: false, message: "클랜 프로필 수정 권한이 없습니다." };
    for (const key of ["description", "banner", "emblem"]) if (payload[key] != null) clan[key] = cleanText(payload[key], key === "description" ? 220 : 48);
    if (payload.isPublic != null) clan.isPublic = !!payload.isPublic;
    save();
    return { ok: true, clan };
  }
  function addContribution(nickname, gains = {}) {
    const clan = findPlayerClan(nickname);
    if (!clan) return null;
    normalizeClan(clan);
    const xp = Math.max(0, Math.floor(Number(gains.xp) || 0)) + Math.max(0, Number(gains.matches) || 0) * 25 + Math.max(0, Number(gains.words) || 0) * 2;
    const points = Math.max(0, Number(gains.wins) || 0) * 35 + Math.max(0, Number(gains.matches) || 0) * 8;
    applyClanXp(clan, xp);
    clan.coins += Math.floor(xp / 10);
    clan.seasonPoints += points;
    clan.wins += Math.max(0, Math.floor(Number(gains.wins) || 0));
    clan.losses += Math.max(0, Math.floor(Number(gains.losses) || 0));
    const member = clan.members[safePlayerKey(nickname)];
    if (member) member.contribution = Math.max(0, Number(member.contribution) || 0) + xp;
    for (const mission of clan.missions) {
      const amount = Math.max(0, Math.floor(Number(gains[mission.type]) || 0));
      if (amount) mission.progress = Math.min(mission.target, (Number(mission.progress) || 0) + amount);
    }
    clan.history.push({ type: "contribution", nickname: safePlayerKey(nickname), gains, time: Date.now() });
    clan.history = clan.history.slice(-50);
    save();
    return clan;
  }
  function claimMission(actor, clanId, missionId) {
    const clan = getClan(clanId);
    if (!clan || !hasPermission(clan, actor, "requests")) return { ok: false, message: "클랜 미션 보상 수령 권한이 없습니다." };
    const mission = clan.missions.find(item => item.id === missionId);
    if (!mission || mission.claimed || (mission.progress || 0) < mission.target) return { ok: false, message: "수령할 수 없는 클랜 미션입니다." };
    mission.claimed = true;
    const reward = mission.reward || {};
    applyClanXp(clan, reward.xp || 0);
    clan.coins += reward.coins || 0;
    save();
    return { ok: true, clan, reward };
  }
  function addChat(clanId, message) {
    const clan = getClan(clanId);
    if (!clan) return null;
    clan.chat.push(message);
    clan.chat = clan.chat.slice(-120);
    save();
    return clan;
  }

  return { store, load: () => data = store.load(), save, getClan, findPlayerClan, getRole, hasPermission, publicClan, listPublicClans, rankings, createClan, deleteClan, requestJoin, manageRequest, leaveClan, kickMember, transferOwnership, setRole, updateClan, addContribution, claimMission, addChat, applyClanXp, normalizeClan, ROLE_LABELS };
}

module.exports = { createClanService, createJsonStore, ROLE_LABELS };

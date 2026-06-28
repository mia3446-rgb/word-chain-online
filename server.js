const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  transports: ["websocket", "polling"],
  cors: {
    origin: "*"
  }
});

app.use(express.static("public"));

const rooms = {};
const wordDB = [];
const allWords = [];
const startMap = new Map();
const oneShotCache = new Map();

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const playersFile = path.join(dataDir, "players.json");
const oldPlayersFile = path.join(__dirname, "players.json");

if (!fs.existsSync(playersFile) && fs.existsSync(oldPlayersFile)) {
  try {
    fs.copyFileSync(oldPlayersFile, playersFile);
    console.log("기존 players.json 데이터를 data 폴더로 복사했습니다.");
  } catch (err) {
    console.log("기존 players.json 복사 실패:", err.message);
  }
}

let playerData = {};

function loadPlayerData() {
  console.log(`플레이어 데이터 저장 위치: ${playersFile}`);
  try {
    if (fs.existsSync(playersFile)) {
      playerData = JSON.parse(fs.readFileSync(playersFile, "utf8"));
      console.log(`플레이어 데이터 ${Object.keys(playerData).length}명 불러옴`);
    }
  } catch (err) {
    console.log("플레이어 데이터 로드 실패:", err.message);
    playerData = {};
  }
}

function savePlayerData() {
  try {
    fs.writeFileSync(playersFile, JSON.stringify(playerData, null, 2), "utf8");
  } catch (err) {
    console.log("플레이어 데이터 저장 실패:", err.message);
  }
}


function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function hashPassword(password, salt) {
  return crypto
    .createHash("sha256")
    .update(String(password) + salt)
    .digest("hex");
}

function isValidNickname(nickname) {
  return /^[가-힣a-zA-Z0-9_]{2,12}$/.test(String(nickname || ""));
}

function isValidPassword(password) {
  return String(password || "").length >= 4 && String(password || "").length <= 30;
}


function safePlayerKey(nickname) {
  return String(nickname || "unknown").trim().slice(0, 30) || "unknown";
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
    achievementRewardsClaimed: []
  };
}

function getNextLevelXp(level) {
  return 100 + (Math.max(1, level) - 1) * 50;
}

function ensureProfile(nickname) {
  const key = safePlayerKey(nickname);

  if (!playerData[key]) {
    playerData[key] = getDefaultProfile(key);
  }

  return playerData[key];
}

function addXp(profile, amount) {
  profile.xp += amount;

  let leveledUp = false;

  while (profile.xp >= getNextLevelXp(profile.level)) {
    profile.xp -= getNextLevelXp(profile.level);
    profile.level++;
    leveledUp = true;
  }

  return leveledUp;
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
    leveledUp = addXp(profile, achievement.xp);
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

  return {
    nickname: profile.nickname,
    level: profile.level,
    xp: profile.xp,
    nextXp,
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
    achievementTotal: ACHIEVEMENTS.length
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

const wordsDir = path.join(__dirname, "words");

if (fs.existsSync(wordsDir)) {
  const files = fs.readdirSync(wordsDir).filter(file => file.endsWith(".txt"));

  for (const file of files) {
    const text = fs.readFileSync(path.join(wordsDir, file), "utf8");
    wordDB.push("/" + text.trim() + "/");

    const words = text
      .split("/")
      .map(w => w.trim())
      .filter(w => /^[가-힣]{2,}$/.test(w));

    for (const w of words) {
      allWords.push(w);

      const first = w[0];
      if (!startMap.has(first)) {
        startMap.set(first, []);
      }
      startMap.get(first).push(w);
    }
  }

  console.log(`단어 DB ${files.length}개 파일 불러옴`);
  console.log(`전체 단어 ${allWords.length}개 준비됨`);
  console.log(`첫 글자 인덱스 ${startMap.size}개 준비됨`);
} else {
  console.log("words 폴더가 없습니다.");
}

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
  return room.players.filter(p => !p.eliminated && p.connected);
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
  return room.players.filter(p => !p.isBot && p.connected);
}

function totalPlayablePlayers(room) {
  return room.players.filter(p => p.connected).length;
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

function publicRoom(room) {
  const turnPlayer = normalizeTurn(room);
  const nextWordInfo = getNextWordInfo(room);

  return {
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
      profile: p.isBot ? null : publicProfile(p.nickname)
    })),
    hostId: room.hostId,
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
    const host = room.players.find(p => p.playerId === room.hostId);
    const connectedPlayers = room.players.filter(p => p.connected && !p.eliminated).length;

    return {
      code,
      title: `${host ? host.nickname : "방장"}님의 방`,
      hostName: host ? host.nickname : "방장",
      players: connectedPlayers,
      maxPlayers: 8,
      status: room.status,
      isPublic: !!room.isPublic,
      locked: !!room.password,
      createdAt: room.createdAt || 0
    };
  });

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


function applyMatchRewards(room) {
  if (!room || room.statsApplied) return;

  room.statsApplied = true;
  room.rewards = [];

  const winnerNames = (room.winnerText || "")
    .split(",")
    .map(name => name.trim())
    .filter(Boolean);

  for (const player of room.players) {
    if (player.isBot) continue;

    const profile = ensureProfile(player.nickname);
    const isWinner = winnerNames.includes(player.nickname);

    profile.games++;

    let xpGain = 0;
    let coinGain = 0;

    if (isWinner) {
      profile.wins++;
      profile.currentWinStreak++;
      profile.bestWinStreak = Math.max(profile.bestWinStreak, profile.currentWinStreak);
      xpGain += 100;
      coinGain += 50;
    } else {
      profile.losses++;
      profile.currentWinStreak = 0;
      xpGain += 40;
      coinGain += 20;
    }

    const leveledUp = addXp(profile, xpGain);
    profile.coins += coinGain;
    updateTitles(profile);
    const unlockedAchievements = checkAchievements(profile);

    room.rewards.push({
      nickname: player.nickname,
      result: isWinner ? "win" : "loss",
      xp: xpGain,
      coins: coinGain,
      level: profile.level,
      leveledUp,
      achievements: unlockedAchievements
    });
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

function upsertPlayer(room, socket, playerId, nickname) {
  let player = findPlayer(room, playerId);

  if (player) {
    player.socketId = socket.id;
    player.nickname = nickname;
    player.connected = true;
    return player;
  }

  player = {
    playerId,
    socketId: socket.id,
    nickname,
    connected: true,
    eliminated: false
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
    // 지옥: 한방단어는 조금만 줄여서 사용, 없으면 5턴 안에 몰아붙이는 수 선택
    if (oneShotWords.length > 0 && Math.random() < 0.75) {
      return oneShotWords
        .slice()
        .sort((a, b) => a.length - b.length)[0];
    }

    const nonOneShot = candidates.filter(word => !isOneShotWord(word));
    const source = nonOneShot.length > 0 ? nonOneShot : candidates;

    // 다음 사람이 받을 수 있는 단어 수가 1~5개인 단어를 최우선으로 선택
    // 즉, 바로 끝내지는 않지만 5턴 안에 죽을 가능성이 큰 압박 수
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

    return source
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
    hell: ["👿 끝말귀신", "👿 지옥봇", "👿 보스봇"]
  };

  const pool = names[difficulty] || names.normal;

  for (let i = 0; i < count; i++) {
    const botId = `bot_${roomCode}_${i}_${Date.now()}`;
    room.players.push({
      playerId: botId,
      socketId: botId,
      nickname: pool[i % pool.length],
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

io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = null;

  socket.emit("roomList", makeRoomList());

  socket.on("getRoomList", () => {
    socket.emit("roomList", makeRoomList());
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
  });

  socket.on("logout", () => {
    socket.data.nickname = null;
    socket.emit("loggedOut");
  });


  socket.on("createRoom", ({ password, playerId, isPublic, botCount, botDifficulty }) => {
    const nickname = socket.data.nickname;

    if (!nickname) {
      socket.emit("errorMessage", "로그인 후 방을 만들 수 있습니다.");
      return;
    }

    if (!password || !playerId) {
      socket.emit("errorMessage", "방 입장 비밀번호를 입력하세요.");
      return;
    }

    const roomCode = makeRoomCode();

    rooms[roomCode] = {
      players: [],
      password: String(password),
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
    socket.emit("roomCreated", roomCode);
    addSystemMessage(roomCode, `🟢 ${nickname}님이 방을 만들었습니다.`);
    sendRoomUpdate(roomCode);
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

    if (!password || !playerId) {
      socket.emit("errorMessage", "방번호와 방 비밀번호를 입력하세요.");
      return;
    }

    if (room.password && room.password !== String(password)) {
      socket.emit("errorMessage", "비밀번호가 올바르지 않습니다.");
      return;
    }

    if (room.status === "playing") {
      socket.emit("errorMessage", "이미 게임이 시작된 방입니다.");
      return;
    }

    if (room.players.length >= 8 && !findPlayer(room, playerId)) {
      socket.emit("errorMessage", "방이 가득 찼습니다.");
      return;
    }

    upsertPlayer(room, socket, playerId, nickname);

    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;

    socket.join(roomCode);
    socket.emit("joinedRoom", roomCode);
    addSystemMessage(roomCode, `🟢 ${nickname}님이 입장했습니다.`);

    setTimeout(() => {
      sendRoomUpdate(roomCode);
    }, 100);
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

    if (!player || player.isBot) return;

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
      text: cleanText,
      time: Date.now()
    });
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;

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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

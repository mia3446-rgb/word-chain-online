const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

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
  if (allWords.length === 0) {
    return "";
  }

  // 빠른 랜덤 시도: 대부분 여기서 끝남
  for (let i = 0; i < 200; i++) {
    const word = allWords[Math.floor(Math.random() * allWords.length)];
    if (isKoreanWord(word) && !isOneShotWord(word)) {
      return word;
    }
  }

  // 혹시 랜덤으로 계속 한방단어만 걸리면 앞에서부터 안전 단어 탐색
  for (const word of allWords) {
    if (isKoreanWord(word) && !isOneShotWord(word)) {
      return word;
    }
  }

  return "";
}

function stopTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
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

function publicRoom(room) {
  normalizeTurn(room);

  return {
    players: room.players.map(p => ({
      playerId: p.playerId,
      socketId: p.socketId,
      nickname: p.nickname,
      connected: p.connected,
      eliminated: p.eliminated
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
    startWord: room.startWord,
    chatMessages: room.chatMessages || []
  };
}

function makeRoomList() {
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

function gameOver(roomCode, reason) {
  const room = rooms[roomCode];
  if (!room) return;

  room.status = "gameover";
  room.gameoverReason = reason;
  room.winnerText = getWinnerText(room);

  addSystemMessage(roomCode, `🏆 최종 승리: ${room.winnerText}`);

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
  addSystemMessage(roomCode, `💀 ${player.nickname}님 탈락! (${reason})`);

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

  stopTimer(room);
  room.timeLeft = room.timeLimit;
  sendRoomUpdate(roomCode);

  room.timer = setInterval(() => {
    const r = rooms[roomCode];

    if (!r || r.status !== "playing") {
      if (r) stopTimer(r);
      return;
    }

    normalizeTurn(r);

    if (activePlayers(r).length <= 1) {
      gameOver(roomCode, "마지막 1명만 남았습니다!");
      return;
    }

    r.timeLeft--;

    if (r.timeLeft <= 0) {
      const player = currentPlayer(r);
      eliminatePlayer(roomCode, player, "시간 초과");
      return;
    }

    sendRoomUpdate(roomCode);
  }, 1000);
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

io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = null;

  socket.emit("roomList", makeRoomList());

  socket.on("getRoomList", () => {
    socket.emit("roomList", makeRoomList());
  });

  socket.on("createRoom", ({ nickname, password, playerId, isPublic }) => {
    if (!nickname || !password || !playerId) {
      socket.emit("errorMessage", "닉네임과 비밀번호를 입력하세요.");
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
      chatMessages: [],
      timer: null
    };

    upsertPlayer(rooms[roomCode], socket, playerId, nickname);

    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;

    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
    addSystemMessage(roomCode, `🟢 ${nickname}님이 방을 만들었습니다.`);
    sendRoomUpdate(roomCode);
  });

  socket.on("joinRoom", ({ roomCode, nickname, password, playerId }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("errorMessage", "없는 방입니다.");
      return;
    }

    if (!nickname || !password || !playerId) {
      socket.emit("errorMessage", "닉네임과 비밀번호를 입력하세요.");
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

    if (room.status === "playing") return;

    room.players.forEach(p => {
      p.eliminated = false;
      p.connected = true;
    });

    if (activePlayers(room).length < 2) {
      socket.emit("errorMessage", "2명 이상이어야 시작할 수 있습니다.");
      return;
    }

    const startWord = getRandomStartWord();

    if (!startWord) {
      socket.emit("errorMessage", "시작 단어를 고를 수 없습니다. words 폴더를 확인하세요.");
      return;
    }

    room.status = "playing";
    room.turn = 0;
    room.currentWord = startWord;
    room.startWord = startWord;
    room.usedWords = [];
    room.timeLimit = 20;
    room.timeLeft = 20;
    room.wrongCount = 0;
    room.gameoverReason = "";
    room.winnerText = "";
    room.lastNotice = `🎲 시작 단어: ${startWord}`;

    addSystemMessage(roomCode, `🎮 게임 시작! 시작 단어는 ${startWord}`);
    startTurnTimer(roomCode);
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
      socket.emit("errorMessage", `${msg} (${room.wrongCount}/5)`);

      if (room.wrongCount >= 5) {
        eliminatePlayer(roomCode, player, "한 턴에 5번 틀림");
      } else {
        sendRoomUpdate(roomCode);
      }
    }

    if (!isKoreanWord(word)) {
      wrong("두 글자 이상의 한글 단어만 입력할 수 있습니다.");
      return;
    }

    if (!wordExists(word)) {
      wrong("그 단어는 없는 단어입니다.");
      return;
    }

    if (room.usedWords.includes(word) || word === room.startWord) {
      wrong("이미 사용한 단어입니다.");
      return;
    }

    if (room.usedWords.length === 0 && isOneShotWord(word)) {
  wrong("첫 번째 단어로는 한방단어를 사용할 수 없습니다!");
  return;
}

    if (room.currentWord) {
      const last = room.currentWord[room.currentWord.length - 1];
      const first = word[0];

      if (!isValidChain(last, first)) {
        const starts = getDueumStarts(last).join(" 또는 ");
        wrong(`${starts}로 시작해야 합니다!`);
        return;
      }
    }

    room.currentWord = word;
    room.usedWords.push(word);
    room.wrongCount = 0;
    room.lastNotice = "";
    room.turn = nextActiveTurn(room, room.turn);

    setTimeLimitByTurn(room);
    startTurnTimer(roomCode);
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

      const p = findPlayer(r, playerId);

      if (p && p.connected) return;

      if (r.status === "playing" && p && !p.eliminated) {
        p.eliminated = true;
        p.connected = false;
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

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};
const wordDB = [];

const wordsDir = path.join(__dirname, "words");

if (fs.existsSync(wordsDir)) {
  const files = fs.readdirSync(wordsDir).filter(file => file.endsWith(".txt"));

  for (const file of files) {
    const text = fs.readFileSync(path.join(wordsDir, file), "utf8");
    wordDB.push("/" + text.trim() + "/");
  }

  console.log(`단어 DB ${files.length}개 파일 불러옴`);
} else {
  console.log("words 폴더가 없습니다.");
}

function makeRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
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

  return starts.some(start => wordDB.some(db => db.includes("/" + start)));
}

function stopTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function getWinnerText(room, loserId) {
  const winners = room.players
    .filter(p => p.id !== loserId)
    .map(p => p.nickname);

  if (winners.length === 0) return "승자 없음";
  return winners.join(", ");
}

function sendRoomUpdate(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  io.to(roomCode).emit("roomUpdate", {
    players: room.players,
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
    winnerText: room.winnerText
  });
}

function gameOver(roomCode, reason, loserId = null) {
  const room = rooms[roomCode];
  if (!room) return;

  room.status = "gameover";
  room.gameoverReason = reason;
  room.winnerText = loserId ? getWinnerText(room, loserId) : "승자 없음";

  stopTimer(room);
  sendRoomUpdate(roomCode);
}

function startTurnTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  stopTimer(room);
  room.timeLeft = room.timeLimit;
  sendRoomUpdate(roomCode);

  room.timer = setInterval(() => {
    const r = rooms[roomCode];

    if (!r || r.status !== "playing") {
      if (r) stopTimer(r);
      return;
    }

    r.timeLeft--;

    if (r.timeLeft <= 0) {
      const player = r.players[r.turn];
      const name = player ? player.nickname : "플레이어";
      gameOver(roomCode, `${name}님이 시간 초과로 게임오버!`, player ? player.id : null);
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

io.on("connection", (socket) => {
  socket.on("createRoom", ({ nickname, password }) => {
    const roomCode = makeRoomCode();

    rooms[roomCode] = {
      players: [{ id: socket.id, nickname }],
      password,
      hostId: socket.id,
      currentWord: "",
      turn: 0,
      usedWords: [],
      status: "waiting",
      timeLimit: 20,
      timeLeft: 20,
      wrongCount: 0,
      gameoverReason: "",
      winnerText: "",
      timer: null
    };

    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
    sendRoomUpdate(roomCode);
  });

  socket.on("joinRoom", ({ roomCode, nickname, password }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("errorMessage", "없는 방입니다.");
      return;
    }

    if (room.password && room.password !== password) {
      socket.emit("errorMessage", "비밀번호가 올바르지 않습니다.");
      return;
    }

    if (room.status === "playing") {
      socket.emit("errorMessage", "이미 게임이 시작된 방입니다.");
      return;
    }

    room.players.push({ id: socket.id, nickname });
    socket.join(roomCode);

    socket.emit("joinedRoom", roomCode);

    setTimeout(() => {
      sendRoomUpdate(roomCode);
    }, 100);
  });

  socket.on("startGame", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit("errorMessage", "방장만 게임을 시작할 수 있습니다.");
      return;
    }

    if (room.status === "playing") return;

    room.status = "playing";
    room.turn = 0;
    room.currentWord = "";
    room.usedWords = [];
    room.timeLimit = 20;
    room.timeLeft = 20;
    room.wrongCount = 0;
    room.gameoverReason = "";
    room.winnerText = "";

    startTurnTimer(roomCode);
  });

  socket.on("submitWord", ({ roomCode, word }) => {
    const room = rooms[roomCode];
    if (!room || room.status !== "playing") return;

    word = String(word || "").trim();

    const currentPlayer = room.players[room.turn];

    if (!currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit("errorMessage", "네 차례가 아닙니다.");
      return;
    }

    function wrong(msg) {
      room.wrongCount++;
      socket.emit("errorMessage", `${msg} (${room.wrongCount}/5)`);

      if (room.wrongCount >= 5) {
        gameOver(roomCode, `${currentPlayer.nickname}님이 한 턴에 5번 틀려서 게임오버!`, currentPlayer.id);
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

    if (room.usedWords.includes(word)) {
      wrong("이미 사용한 단어입니다.");
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

    // 첫 단어만 한방단어 금지
    if (room.usedWords.length === 0 && !hasNextWord(word)) {
      wrong("한방단어는 첫 단어로 사용할 수 없습니다!");
      return;
    }

    room.currentWord = word;
    room.usedWords.push(word);
    room.turn = (room.turn + 1) % room.players.length;
    room.wrongCount = 0;

    setTimeLimitByTurn(room);
    startTurnTimer(roomCode);
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const oldTurnPlayer = room.players[room.turn];

      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        stopTimer(room);
        delete rooms[roomCode];
      } else {
        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
        }

        if (oldTurnPlayer && oldTurnPlayer.id === socket.id) {
          room.turn = room.turn % room.players.length;

          if (room.status === "playing") {
            startTurnTimer(roomCode);
          } else {
            sendRoomUpdate(roomCode);
          }
        } else {
          if (room.turn >= room.players.length) {
            room.turn = 0;
          }

          sendRoomUpdate(roomCode);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

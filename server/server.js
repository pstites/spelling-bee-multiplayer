// Copyright (c) 2026 Nathaniel Page Stites
// All rights reserved.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// ── App setup ────────────────────────────────────────────────────────────────

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// ── Puzzle cache ─────────────────────────────────────────────────────────────

let puzzleCache = {
  date: null,
  puzzle: null,
};

function getTodayString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York'
  }).format(new Date());
}

const { generatePuzzle } = require("./generator");

function getPuzzle(seed) {
  return new Promise((resolve, reject) => {
    const today = getTodayString();
    const isDaily = !seed || seed === today;

    if (isDaily) {
      if (puzzleCache.date === today && puzzleCache.puzzle) {
        console.log("Returning cached daily puzzle for", today);
        return resolve(puzzleCache.puzzle);
      }
      console.log("Generating daily puzzle for", today);
      try {
        const puzzle = generatePuzzle(today);
        if (!puzzle) return reject(new Error("Failed to generate puzzle"));
        puzzleCache = { date: today, puzzle };
        resolve(puzzle);
      } catch (err) {
        reject(err);
      }
    } else {
      console.log("Generating unique puzzle for seed:", seed);
      try {
        const puzzle = generatePuzzle(seed);
        if (!puzzle) return reject(new Error("Failed to generate puzzle"));
        resolve(puzzle);
      } catch (err) {
        reject(err);
      }
    }
  });
}

// ── Room management ───────────────────────────────────────────────────────────

const rooms = {};

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms[code]);
  return code;
}

function createRoom(code, puzzle, puzzleType) {
  rooms[code] = {
    code,
    puzzle,
    puzzleType: puzzleType || "daily",
    mode: "collaborative",       // or "competitive"
    players: {},                 // socketId -> { name, color }
    foundWords: {},              // word -> { playerName, color, score }
    scores: {},                  // playerName -> score
    disconnectedPlayer: null,    // name of player currently away
    rejoinTimer: null,
    gameTimer: null,             // setInterval handle for competitive countdown
    timeRemaining: 0,            // seconds remaining in competitive game
    gameStarted: false,          // true once both players have joined
  };
  return rooms[code];
}

// ── Competitive timer ─────────────────────────────────────────────────────────

const COMPETITIVE_DURATION_S = 5 * 60; // 300 seconds

function startCompetitiveTimer(room) {
  room.timeRemaining = COMPETITIVE_DURATION_S;

  room.gameTimer = setInterval(() => {
    room.timeRemaining -= 1;

    if (room.timeRemaining === 10) {
      io.to(room.code).emit("timer_warning");
    }

    if (room.timeRemaining <= 0) {
      clearInterval(room.gameTimer);
      room.gameTimer = null;
      endCompetitiveGame(room);
    }
  }, 1000);
}

function endCompetitiveGame(room, resigningPlayer = null) {
  const words = Object.values(room.foundWords);

  const playerMap = {};
  for (const player of Object.values(room.players)) {
    playerMap[player.name] = {
      name: player.name,
      color: player.color,
      score: room.scores[player.name] || 0,
      wordsFound: 0,
    };
  }
  for (const entry of words) {
    if (playerMap[entry.playerName]) {
      playerMap[entry.playerName].wordsFound++;
    }
  }

  const playerStats = Object.values(playerMap);
  let winner;
  if (resigningPlayer) {
    const opponent = playerStats.find(p => p.name !== resigningPlayer);
    winner = opponent ? opponent.name : resigningPlayer;
  } else {
    const [p1, p2] = playerStats;
    if (!p2) {
      winner = p1.name;
    } else if (p1.score > p2.score) {
      winner = p1.name;
    } else if (p2.score > p1.score) {
      winner = p2.name;
    } else {
      winner = "tie";
    }
  }

  const pangrams = words
    .filter(w => w.isPangram)
    .map(w => ({ word: w.word, playerName: w.playerName, color: w.color }));

  let longestWord = null;
  for (const entry of words) {
    if (!longestWord || entry.word.length > longestWord.word.length ||
        (entry.word.length === longestWord.word.length && entry.word < longestWord.word)) {
      longestWord = { word: entry.word, playerName: entry.playerName, color: entry.color };
    }
  }

  console.log(`Room ${room.code} competitive game ended — winner: ${winner}${resigningPlayer ? ` (${resigningPlayer} resigned)` : ""}`);
  io.to(room.code).emit("game_ended", {
    mode: "competitive",
    winner,
    resigned: resigningPlayer || null,
    playerStats,
    pangrams,
    longestWord,
  });
  delete rooms[room.code];
}

function getRoomForSocket(socketId) {
  return Object.values(rooms).find(
    (r) => r.players[socketId] !== undefined
  );
}

const PLAYER_COLORS = ["#4A90D9", "#E8821A"]; // blue, orange

// ── Socket.io events ──────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // ── Create room ────────────────────────────────────────────────────────────
  socket.on("create_room", async ({ playerName, mode, puzzleType }, callback) => {
    try {
      const today = getTodayString();
      const code = generateRoomCode();
      const seed = (puzzleType === "new") ? `${today}-${code}` : today;
      const puzzle = await getPuzzle(seed);
      const room = createRoom(code, puzzle, puzzleType || "daily");

      room.mode = mode || "collaborative";
      room.players[socket.id] = { name: playerName, color: PLAYER_COLORS[0] };
      room.scores[playerName] = 0;

      socket.join(code);
      console.log(`Room ${code} created by ${playerName} (${room.puzzleType} puzzle, seed: ${seed})`);

      callback({
        success: true,
        roomCode: code,
        color: PLAYER_COLORS[0],
        puzzle: {
          letters: puzzle.letters,
          center: puzzle.center,
          maxScore: puzzle.max_score,
        },
        mode: room.mode,
        puzzleType: room.puzzleType,
      });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  // ── Join room ──────────────────────────────────────────────────────────────
  socket.on("join_room", async ({ roomCode, playerName }, callback) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room) {
      return callback({ success: false, error: "Room not found." });
    }

    const playerCount = Object.keys(room.players).length;
    const existingEntry = Object.values(room.players).find(
      (p) => p.name === playerName
    );

    if (existingEntry) {
      // Host reconnecting during the waiting room (game not yet started, only one player)
      if (!room.gameStarted && Object.keys(room.players).length === 1) {
        const oldSocketId = Object.keys(room.players).find(
          (id) => room.players[id].name === playerName
        );
        delete room.players[oldSocketId];
        room.players[socket.id] = existingEntry;
        socket.join(code);
        return callback({
          success: true,
          roomCode: code,
          color: existingEntry.color,
          puzzle: {
            letters: room.puzzle.letters,
            center: room.puzzle.center,
            maxScore: room.puzzle.max_score,
          },
          mode: room.mode,
          puzzleType: room.puzzleType,
          foundWords: room.foundWords,
          scores: room.scores,
          opponent: null,
        });
      }

      // Player reconnecting to an active game — covers the case where they disconnected
      // during the waiting room before gameStarted was set (so disconnectedPlayer is null)
      if (room.gameStarted) {
        const oldSocketId = Object.keys(room.players).find(
          (id) => room.players[id].name === playerName
        );
        delete room.players[oldSocketId];
        room.players[socket.id] = existingEntry;
        socket.join(code);

        if (room.rejoinTimer) {
          clearTimeout(room.rejoinTimer);
          room.rejoinTimer = null;
        }
        room.disconnectedPlayer = null;

        io.to(code).emit("game_resumed", { playerName });
        console.log(`${playerName} rejoined room ${code}`);

        const opponent = Object.values(room.players).find(p => p.name !== playerName);
        return callback({
          success: true,
          roomCode: code,
          color: existingEntry.color,
          puzzle: {
            letters: room.puzzle.letters,
            center: room.puzzle.center,
            maxScore: room.puzzle.max_score,
          },
          mode: room.mode,
          puzzleType: room.puzzleType,
          foundWords: room.foundWords,
          scores: room.scores,
          opponent: opponent ? { name: opponent.name, color: opponent.color } : null,
          timeRemaining: room.mode === "competitive" ? room.timeRemaining : undefined,
        });
      }

      if (room.disconnectedPlayer !== playerName) {
        return callback({ success: false, error: "That name is already taken in this room." });
      }

      // Rejoin — reassign socket id
      const oldSocketId = Object.keys(room.players).find(
        (id) => room.players[id].name === playerName
      );
      delete room.players[oldSocketId];
      room.players[socket.id] = existingEntry;
      socket.join(code);

      // Cancel any pending session-end timer
      if (room.rejoinTimer) {
        clearTimeout(room.rejoinTimer);
        room.rejoinTimer = null;
      }
      room.disconnectedPlayer = null;

      io.to(code).emit("game_resumed", { playerName });
      console.log(`${playerName} rejoined room ${code}`);

      const opponent = Object.values(room.players).find(p => p.name !== playerName);
      return callback({
        success: true,
        roomCode: code,
        color: existingEntry.color,
        puzzle: {
          letters: room.puzzle.letters,
          center: room.puzzle.center,
          maxScore: room.puzzle.max_score,
        },
        mode: room.mode,
        puzzleType: room.puzzleType,
        foundWords: room.foundWords,
        scores: room.scores,
        opponent: opponent ? { name: opponent.name, color: opponent.color } : null,
        timeRemaining: room.mode === "competitive" ? room.timeRemaining : undefined,
      });
    }

    if (playerCount >= 2) {
      return callback({ success: false, error: "Room is full." });
    }

    // New player joining
    const color = PLAYER_COLORS[playerCount];
    room.players[socket.id] = { name: playerName, color };
    room.scores[playerName] = 0;
    socket.join(code);

    const opponent = Object.values(room.players).find(
      (p) => p.name !== playerName
    );

    // Both players are now present — game is underway
    room.gameStarted = true;

    if (room.mode === "competitive") {
      startCompetitiveTimer(room);
    }

    // Notify the first player that their opponent has joined
    socket.to(code).emit("opponent_joined", {
      playerName,
      color,
      timeRemaining: room.mode === "competitive" ? room.timeRemaining : undefined,
    });

    console.log(`${playerName} joined room ${code}`);

    callback({
      success: true,
      roomCode: code,
      color,
      puzzle: {
        letters: room.puzzle.letters,
        center: room.puzzle.center,
        maxScore: room.puzzle.max_score,
      },
      mode: room.mode,
      puzzleType: room.puzzleType,
      foundWords: room.foundWords,
      scores: room.scores,
      opponent: opponent ? { name: opponent.name, color: opponent.color } : null,
      timeRemaining: room.mode === "competitive" ? room.timeRemaining : undefined,
    });

    // Tell the new player who they're playing with
    io.to(code).emit("players_ready", {
      players: Object.values(room.players),
    });
  });

  // ── Submit word ────────────────────────────────────────────────────────────
  socket.on("submit_word", ({ word }, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return callback({ success: false, error: "Not in a room." });

    const player = room.players[socket.id];
    const w = word.toLowerCase().trim();

    // Already found?
    if (room.foundWords[w]) {
      return callback({ success: false, error: "Already found!" });
    }

    // Valid word?
    if (!room.puzzle.valid_words.includes(w)) {
      return callback({ success: false, error: "Not in word list." });
    }

    // Score the word
    const isPangram = room.puzzle.pangrams.includes(w);
    const score = w.length === 4 ? 1 : w.length + (isPangram ? 7 : 0);

    // Record the word
    room.foundWords[w] = {
      word: w,
      playerName: player.name,
      color: player.color,
      score,
      isPangram,
    };

    // Update scores
    if (room.mode === "competitive") {
      room.scores[player.name] = (room.scores[player.name] || 0) + score;
    } else {
      // Collaborative — add to a shared total stored under "shared"
      room.scores["shared"] = (room.scores["shared"] || 0) + score;
    }

    // Broadcast the new word to both players
    io.to(room.code).emit("word_found", {
      word: w,
      playerName: player.name,
      color: player.color,
      score,
      isPangram,
      scores: room.scores,
    });

    // Pangram event
    if (isPangram) {
      io.to(room.code).emit("pangram_found", {
        word: w,
        playerName: player.name,
        color: player.color,
        score,
        mode: room.mode,
      });
    }

    callback({ success: true });
  });

  // ── End game ───────────────────────────────────────────────────────────────
  socket.on("end_game", () => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.gameStarted || room.mode !== "collaborative") return;

    const words = Object.values(room.foundWords);
    const totalScore = room.scores["shared"] || 0;

    // Per-player contribution stats
    const playerMap = {};
    for (const player of Object.values(room.players)) {
      playerMap[player.name] = { name: player.name, color: player.color, wordsFound: 0, pointsContributed: 0 };
    }
    for (const entry of words) {
      if (playerMap[entry.playerName]) {
        playerMap[entry.playerName].wordsFound++;
        playerMap[entry.playerName].pointsContributed += entry.score;
      }
    }

    const pangrams = words
      .filter(w => w.isPangram)
      .map(w => ({ word: w.word, playerName: w.playerName, color: w.color }));

    let longestWord = null;
    for (const entry of words) {
      if (!longestWord || entry.word.length > longestWord.word.length ||
          (entry.word.length === longestWord.word.length && entry.word < longestWord.word)) {
        longestWord = { word: entry.word, playerName: entry.playerName, color: entry.color };
      }
    }

    const RANK_THRESHOLDS = [
      { label: "Beginner", pct: 0 }, { label: "Good Start", pct: 0.02 },
      { label: "Moving Up", pct: 0.05 }, { label: "Good", pct: 0.08 },
      { label: "Solid", pct: 0.15 }, { label: "Nice", pct: 0.25 },
      { label: "Great", pct: 0.40 }, { label: "Amazing", pct: 0.50 },
      { label: "Genius", pct: 0.70 }, { label: "Queen Bee", pct: 1.00 },
    ];
    const pct = room.puzzle.max_score > 0 ? totalScore / room.puzzle.max_score : 0;
    let rank = "Beginner";
    for (const r of RANK_THRESHOLDS) {
      if (pct >= r.pct) rank = r.label;
    }

    const totalWords = words.length;

    io.to(room.code).emit("game_ended", {
      mode: "collaborative",
      totalScore,
      maxScore: room.puzzle.max_score,
      rank,
      totalWords,
      playerStats: Object.values(playerMap),
      pangrams,
      longestWord,
    });

    console.log(`Room ${room.code} ended by ${room.players[socket.id]?.name} — ${totalWords} words, ${totalScore} pts, rank: ${rank}`);
    delete rooms[room.code];
  });

  // ── Resign ─────────────────────────────────────────────────────────────────
  socket.on("resign", () => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.gameStarted || room.mode !== "competitive") return;

    const player = room.players[socket.id];
    if (!player) return;

    if (room.gameTimer) {
      clearInterval(room.gameTimer);
      room.gameTimer = null;
    }

    console.log(`${player.name} resigned in room ${room.code}`);
    endCompetitiveGame(room, player.name);
  });

  // ── Toggle mode ────────────────────────────────────────────────────────────
  socket.on("toggle_mode", (_, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return callback({ success: false });

    room.mode = room.mode === "collaborative" ? "competitive" : "collaborative";

    // Recalculate shared vs individual scores from foundWords
    room.scores = {};
    for (const entry of Object.values(room.foundWords)) {
      if (room.mode === "competitive") {
        room.scores[entry.playerName] =
          (room.scores[entry.playerName] || 0) + entry.score;
      } else {
        room.scores["shared"] = (room.scores["shared"] || 0) + entry.score;
      }
    }

    io.to(room.code).emit("mode_changed", {
      mode: room.mode,
      scores: room.scores,
    });

    callback({ success: true, mode: room.mode });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const player = room.players[socket.id];
    if (!player) return;

    console.log(`${player.name} disconnected from room ${room.code}`);

    // During the waiting room phase, allow silent reconnect — no pause, no timer
    if (!room.gameStarted) {
      return;
    }

    room.disconnectedPlayer = player.name;

    // Non-blocking: let the remaining player keep playing
    io.to(room.code).emit("opponent_disconnected", {
      playerName: player.name,
    });

    // End the session after 3 minutes if they don't rejoin
    // Competitive timer keeps running during disconnect (per spec)
    room.rejoinTimer = setTimeout(() => {
      console.log(`Room ${room.code} closed — ${player.name} did not rejoin`);
      if (room.gameTimer) {
        clearInterval(room.gameTimer);
        room.gameTimer = null;
      }
      io.to(room.code).emit("session_ended", {
        reason: `${player.name} did not reconnect in time.`,
      });
      delete rooms[room.code];
    }, 3 * 60 * 1000);
  });
});

// ── Static files & health check ───────────────────────────────────────────────

app.use(express.static(path.join(__dirname, "../client")));

app.get("/health", (req, res) => {
  res.json({ status: "ok", activeRooms: Object.keys(rooms).length });
});

app.get("/test-puzzle", async (req, res) => {
  try {
    const puzzle = await getPuzzle();
    res.json({ success: true, wordCount: puzzle.word_count, center: puzzle.center });
  } catch (err) {
    res.json({ success: false, error: err.message, stack: err.stack });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
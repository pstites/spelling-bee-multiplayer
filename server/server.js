// Copyright (c) 2026 Nathaniel Page Stites
// All rights reserved.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { execFile } = require("child_process");
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
  return new Date().toISOString().slice(0, 10);
}

function getPuzzle() {
  return new Promise((resolve, reject) => {
    const today = getTodayString();

    // Return cached puzzle if it's still today's
    if (puzzleCache.date === today && puzzleCache.puzzle) {
      console.log("Returning cached puzzle for", today);
      return resolve(puzzleCache.puzzle);
    }

    console.log("Generating new puzzle for", today);

    const generatorPath = path.join(
      __dirname,
      "../puzzle-generator/generator.py"
    );
    const pythonPath = process.env.PYTHON_PATH || "python3";

    execFile(pythonPath, [generatorPath, "--json"], (err, stdout, stderr) => {
      if (err) {
        console.error("Puzzle generation failed:", stderr);
        return reject(err);
      }
      try {
        const puzzle = JSON.parse(stdout.trim());
        puzzleCache = { date: today, puzzle };
        resolve(puzzle);
      } catch (e) {
        reject(new Error("Failed to parse puzzle JSON: " + stdout));
      }
    });
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

function createRoom(code, puzzle) {
  rooms[code] = {
    code,
    puzzle,
    mode: "collaborative",       // or "competitive"
    players: {},                 // socketId -> { name, color }
    foundWords: {},              // word -> { playerName, color, score }
    scores: {},                  // playerName -> score
    paused: false,
    pausedAt: null,
    rejoinTimer: null,
  };
  return rooms[code];
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
  socket.on("create_room", async ({ playerName, mode }, callback) => {
    try {
      const puzzle = await getPuzzle();
      const code = generateRoomCode();
      const room = createRoom(code, puzzle);

      room.mode = mode || "collaborative";
      room.players[socket.id] = { name: playerName, color: PLAYER_COLORS[0] };
      room.scores[playerName] = 0;

      socket.join(code);
      console.log(`Room ${code} created by ${playerName}`);

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

    // Check if name is already taken by a connected player
    const existingEntry = Object.values(room.players).find(
      (p) => p.name === playerName
    );

    // Only allow rejoin if the room is paused (i.e. that player disconnected)
   if (existingEntry && room.paused && room.disconnectedPlayer !== playerName) {
      return callback({ success: false, error: "That name is already taken in this room." });
    }

if (existingEntry && room.paused && room.disconnectedPlayer === playerName) {
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
  room.paused = false;
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
        foundWords: room.foundWords,
        scores: room.scores,
        opponent: opponent ? { name: opponent.name, color: opponent.color } : null,
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

    // Notify the first player that their opponent has joined
    socket.to(code).emit("opponent_joined", { playerName, color });

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
      foundWords: room.foundWords,
      scores: room.scores,
      opponent: opponent ? { name: opponent.name, color: opponent.color } : null,
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
    if (room.paused) return callback({ success: false, error: "Game is paused." });

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
    room.paused = true;
    room.pausedAt = Date.now();
    room.disconnectedPlayer = player.name;

    io.to(room.code).emit("game_paused", {
      playerName: player.name,
      reason: "disconnected",
    });

    // Give them 5 minutes to rejoin before closing the room
    room.rejoinTimer = setTimeout(() => {
      console.log(`Room ${room.code} closed — ${player.name} did not rejoin`);
      io.to(room.code).emit("session_ended", {
        reason: `${player.name} did not reconnect in time.`,
      });
      delete rooms[room.code];
    }, 5 * 60 * 1000);
  });
});

// ── Static files & health check ───────────────────────────────────────────────

app.use(express.static(path.join(__dirname, "../client")));

app.get("/health", (req, res) => {
    res.json({ status: "ok", activeRooms: Object.keys(rooms).length });
});

// ── Start server ──────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
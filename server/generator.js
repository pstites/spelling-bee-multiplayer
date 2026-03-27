// Copyright (c) 2026 Page Stites
// All rights reserved.

const fs = require("fs");
const path = require("path");

// ── Configuration ────────────────────────────────────────────────────────────

const WORDLIST_PATH = path.join(__dirname, "../puzzle-generator/enable1.txt");
const MIN_WORDS = 20;
const MAX_WORDS = 80;
const MIN_WORD_LENGTH = 4;

const PROFANITY_BLOCKLIST = new Set([
  "fuck", "shit", "cunt", "cock", "dick", "pussy", "ass", "bitch",
  "nigger", "nigga", "faggot", "fag", "slut", "whore", "bastard",
  "piss", "tits", "twat", "wank", "spic", "kike", "chink"
]);

// Common English words frequency approximation
// We'll use word length and pattern as a proxy since we don't have wordfreq in JS
// Words shorter than 4 letters are already filtered; we filter very rare long words
// by checking against a minimum character frequency pattern
function isCommonEnough(word) {
  // Filter out words with rare letter combinations that suggest obscurity
  // Words with Q not followed by U, words with 3+ consecutive consonants, etc.
  const consonants = "bcdfghjklmnpqrstvwxyz";
  let consecutiveConsonants = 0;
  let maxConsecutive = 0;
  for (const ch of word) {
    if (consonants.includes(ch)) {
      consecutiveConsonants++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveConsonants);
    } else {
      consecutiveConsonants = 0;
    }
  }
  if (maxConsecutive >= 4) return false;
  if (word.includes("q") && !word.includes("qu")) return false;
  if (word.length > 12) return false;
  return true;
}

// ── Load word list ────────────────────────────────────────────────────────────

let cachedWordlist = null;

function loadWordlist() {
  if (cachedWordlist) return cachedWordlist;
  const raw = fs.readFileSync(WORDLIST_PATH, "utf8");
  const words = raw.split("\n").map(w => w.trim().toLowerCase()).filter(w => w);
  cachedWordlist = words.filter(w =>
    w.length >= MIN_WORD_LENGTH &&
    !PROFANITY_BLOCKLIST.has(w) &&
    isCommonEnough(w) &&
    /^[a-z]+$/.test(w)
  );
  console.error(`Loaded ${cachedWordlist.length} words after filtering.`);
  return cachedWordlist;
}

// ── Puzzle logic ──────────────────────────────────────────────────────────────

function isValidWord(word, center, letterSet) {
  if (word.length < MIN_WORD_LENGTH) return false;
  if (!word.includes(center)) return false;
  for (const ch of word) {
    if (!letterSet.has(ch)) return false;
  }
  return true;
}

function isPangram(word, letters) {
  return letters.every(l => word.includes(l));
}

function scoreWord(word, letters) {
  let points = word.length === 4 ? 1 : word.length;
  if (isPangram(word, letters)) points += 7;
  return points;
}

function seededRandom(seed) {
  // Simple seeded PRNG (mulberry32)
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h |= 0; h = h + 0x6D2B79F5 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Main generator ────────────────────────────────────────────────────────────

function generatePuzzle(seed) {
  if (!seed) seed = new Date().toISOString().slice(0, 10);

  const wordlist = loadWordlist();

  // Find pangram candidates (words with exactly 7 unique letters)
  const candidates = wordlist.filter(w => new Set(w).size === 7);
  console.error(`Found ${candidates.length} pangram candidates.`);

  const rng = seededRandom(seed);
  const shuffled = shuffle(candidates, rng);

  for (const pangram of shuffled) {
    const letters = [...new Set(pangram)]; // exactly 7 unique letters

    // Find best center letter
    let bestCenter = null;
    let bestCount = 0;
    for (const candidate of letters) {
      const letterSet = new Set(letters);
      const count = wordlist.filter(w => isValidWord(w, candidate, letterSet)).length;
      if (count > bestCount) {
        bestCount = count;
        bestCenter = candidate;
      }
    }

    if (bestCount < MIN_WORDS) continue;

    const letterSet = new Set(letters);
    const validWords = wordlist
      .filter(w => isValidWord(w, bestCenter, letterSet))
      .sort();

    if (validWords.length > MAX_WORDS) continue;

    const pangrams = validWords.filter(w => isPangram(w, letters));
    const maxScore = validWords.reduce((sum, w) => sum + scoreWord(w, letters), 0);
    const otherLetters = letters.filter(l => l !== bestCenter).sort();

    return {
      seed,
      center: bestCenter,
      letters: [bestCenter, ...otherLetters],
      valid_words: validWords,
      pangrams,
      word_count: validWords.length,
      max_score: maxScore,
    };
  }

  return null;
}

module.exports = { generatePuzzle };
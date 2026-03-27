import random
import json
import sys
from wordfreq import word_frequency
from datetime import date

# ── Configuration ────────────────────────────────────────────────────────────

import os
WORDLIST_PATH = os.path.join(os.path.dirname(__file__), "enable1.txt")
MIN_WORDS = 20
MAX_WORDS = 80
MIN_WORD_LENGTH = 4
FREQUENCY_THRESHOLD = 3e-7  # words below this are considered too obscure

PROFANITY_BLOCKLIST = {
    "fuck", "shit", "cunt", "cock", "dick", "pussy", "ass", "bitch",
    "nigger", "nigga", "faggot", "fag", "slut", "whore", "bastard",
    "piss", "tits", "twat", "wank", "spic", "kike", "chink"
}

# ── Load word list ────────────────────────────────────────────────────────────

def load_wordlist(path):
    with open(path) as f:
        words = [w.strip().lower() for w in f if w.strip()]
    # Filter to words that are clean, common enough, and long enough
    return [
        w for w in words
        if len(w) >= MIN_WORD_LENGTH
        and w not in PROFANITY_BLOCKLIST
        and word_frequency(w, "en") >= FREQUENCY_THRESHOLD
    ]

# ── Puzzle validation ─────────────────────────────────────────────────────────

def is_valid_word(word, center, letters):
    """Check if a word qualifies for a given puzzle."""
    letter_set = set(letters)
    return (
        len(word) >= MIN_WORD_LENGTH
        and center in word
        and all(c in letter_set for c in word)
    )

def is_pangram(word, letters):
    """Check if a word uses all 7 puzzle letters at least once."""
    return set(letters).issubset(set(word))

def score_word(word, letters):
    """Calculate points for a word using NYT rules."""
    if len(word) == 4:
        points = 1
    else:
        points = len(word)
    if is_pangram(word, letters):
        points += 7
    return points

# ── Puzzle generation ─────────────────────────────────────────────────────────

def find_best_center(pangram_letters, wordlist):
    """
    Choose the center letter that produces the most valid words.
    """
    best_center = None
    best_count = 0
    for candidate in pangram_letters:
        count = sum(
            1 for w in wordlist
            if is_valid_word(w, candidate, pangram_letters)
        )
        if count > best_count:
            best_count = count
            best_center = candidate
    return best_center, best_count

def generate_puzzle(seed=None):
    """
    Generate a daily puzzle. Returns a dict with:
      - letters: list of 7 letters (center first)
      - center: the center letter
      - valid_words: sorted list of valid words
      - pangrams: list of pangrams in the valid word list
      - word_count: number of valid words
      - max_score: maximum possible score
    """
    if seed is None:
        seed = date.today().isoformat()

    print(f"Loading word list...", file=sys.stderr)
    wordlist = load_wordlist(WORDLIST_PATH)
    print(f"Loaded {len(wordlist)} usable words after filtering.", file=sys.stderr)

    # Find all pangram candidates (words with exactly 7 unique letters)
    pangram_candidates = [w for w in wordlist if len(set(w)) == 7]
    print(f"Found {len(pangram_candidates)} pangram candidates.", file=sys.stderr)

    rng = random.Random(seed)
    rng.shuffle(pangram_candidates)

    for pangram in pangram_candidates:
        letters = list(set(pangram))  # exactly 7 unique letters

        center, word_count = find_best_center(letters, wordlist)

        if word_count < MIN_WORDS:
            continue

        # Build the valid word list
        valid_words = sorted([
            w for w in wordlist
            if is_valid_word(w, center, letters)
        ])

        if word_count > MAX_WORDS:
            continue

        # Success — build the result
        pangrams_found = [w for w in valid_words if is_pangram(w, letters)]
        max_score = sum(score_word(w, letters) for w in valid_words)

        # Put center letter first in the letters list
        other_letters = [l for l in letters if l != center]
        return {
            "seed": seed,
            "center": center,
            "letters": [center] + sorted(other_letters),
            "valid_words": valid_words,
            "pangrams": pangrams_found,
            "word_count": word_count,
            "max_score": max_score,
        }

    return None  # Should rarely happen

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]
    json_mode = "--json" in args
    date_args = [a for a in args if a != "--json"]
    seed = date_args[0] if date_args else None

    puzzle = generate_puzzle(seed=seed)

    if puzzle is None:
        print(json.dumps({"error": "Failed to generate a valid puzzle"}))
        sys.exit(1)
    else:
        if json_mode:
            print(json.dumps(puzzle))
        else:
            print(f"\n{'='*50}")
            print(f"PUZZLE FOR {puzzle['seed']}")
            print(f"{'='*50}")
            print(f"Letters:   {' '.join(l.upper() for l in puzzle['letters'])}")
            print(f"Center:    {puzzle['center'].upper()}")
            print(f"Words:     {puzzle['word_count']}")
            print(f"Pangrams:  {', '.join(puzzle['pangrams'])}")
            print(f"Max score: {puzzle['max_score']}")
            print(f"\nValid words:")
            for i, word in enumerate(puzzle['valid_words'], 1):
                marker = " ★" if word in puzzle['pangrams'] else ""
                print(f"  {i:3}. {word}{marker}")
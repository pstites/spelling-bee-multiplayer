# Copyright (c) 2026 Nathaniel Page Stites
# All rights reserved.

from generator import generate_puzzle, load_wordlist
from datetime import date, timedelta

start = date(2026, 1, 1)
days = 365
failures = []
results = []

print("Testing 365 dates...\n")

for i in range(days):
    test_date = start + timedelta(days=i)
    seed = test_date.isoformat()
    puzzle = generate_puzzle(seed=seed)

    if puzzle is None:
        failures.append(seed)
        print(f"  FAIL: {seed}")
    else:
        results.append(puzzle['word_count'])
        if i % 30 == 0:
            print(f"  {seed}: {puzzle['word_count']} words, pangrams: {', '.join(puzzle['pangrams'])}")

print(f"\n{'='*50}")
print(f"Results across {days} days:")
print(f"  Failures:      {len(failures)}")
print(f"  Min words:     {min(results)}")
print(f"  Max words:     {max(results)}")
print(f"  Average words: {sum(results)/len(results):.1f}")
if failures:
    print(f"  Failed dates:  {', '.join(failures)}")
else:
    print(f"  All dates produced valid puzzles!")
# Pairing Logic — How It Works

A plain-English walkthrough of every decision the engine makes, with
examples drawn from the demo group:

```
Saquib (2)  Andrea (4)  Mark (3)  Christina (4)
Calvin (3)  Ava (5)     Jonathan (4)  Sheng (4)
```

Skill is a 1–5 number you assign at setup. All logic lives in `src/App.jsx`.

---

## 1. What the engine tracks per player

Every player object looks like this:

```js
{
  id: "abc123",
  name: "Saquib",
  skill: 2,
  status: "active",        // or "resting" (manually excluded by organiser)
  gamesPlayed: 0,
  sitOutCount: 0,
  consecutiveGames: 0,     // resets to 0 when player sits out
  wins: 0,
  losses: 0,
  pointsScored: 0,
  pointsConceded: 0,
  lastPlayedRound: null,
  lastSatOutRound: null,
}
```

After each submitted round, `gamesPlayed`, `consecutiveGames`, wins/losses,
and points are updated. If a player sits out, their `consecutiveGames` resets
to 0 and `lastSatOutRound` is recorded.

---

## 2. The Pair Matrix — remembering history

**Function: `buildMatrix(players, history)` — ~line 49**

Before scoring any round, the engine builds a lookup table for every possible
pair of players. With 8 players there are C(8,2) = 28 pairs.

```js
// Example entry for Saquib + Ava after they've played together once:
matrix["saquibId|avaId"] = {
  timesPartnered: 1,
  lastPartneredRound: 1,   // they played together in round 1
  timesOpposed: 0,
  lastOpposedRound: null,
}
```

This matrix is rebuilt from scratch before every round generation using the
full `matchHistory` array. It is NOT persisted — it's always derived fresh from
history so it can never go stale.

---

## 3. Candidate Generation — all possible courts

**Function: `buildCandidates(players, matrix)` — ~line 81**

For any group of 4 players there are exactly **3** ways to split them into 2
teams of 2:

```
Players: A  B  C  D

Arrangement 1: [A+B] vs [C+D]
Arrangement 2: [A+C] vs [B+D]
Arrangement 3: [A+D] vs [B+C]
```

The engine generates all possible groups of 4 from the active players
(C(n,4) combinations), then produces all 3 arrangements for each group.
With 8 players: C(8,4) × 3 = 70 × 3 = **210 one-court candidates**.

For a 2-court session, it then pairs up every valid combination of two
disjoint one-court candidates (courts can't share players):

```
8 players → 315 two-court round candidates total
```

Each candidate stores:
- `team1`, `team2` — the player IDs on each side
- `t1Sk`, `t2Sk` — combined skill of each team
- `skDiff` — absolute difference (Δ) between team skills
- `advStack` — count of teams where both players are skill ≥ 4 ("stacking")
- `lowStack` — count of teams where both players are skill ≤ 2

---

## 4. Scoring — picking the best round

**Function: `scoreRound(rc, players, matrix, rn)` — ~line 149**

Every round candidate gets a single numeric score. **Lower = better.**
The engine picks the lowest-scoring candidate as Option 1.

### The weights

```js
const W = {
  skillImbalance: 4,   // per Δ skill point per court
  partnerRepeat:  25,  // for each time this pair have been partners before
  recentPartner:  50,  // extra penalty if they were partners LAST round
  sittingUnfair:  8,   // per player sitting out who has played fewer games
  recentSitOut:   25,  // extra if this player also sat out last round
  fatigue:        12,  // per extra consecutive game beyond 3 in a row
  stacking:        6,  // per team where both are skill ≥ 4 or both ≤ 2
  opponentRepeat:  2,  // for each time this pair have faced each other before
};
```

### Worked example — Round 1, 8 demo players

**Candidate A: Saquib+Ava vs Mark+Andrea | Calvin+Jonathan vs Christina+Sheng**

```
Court 1: Saquib(2)+Ava(5) = 7  vs  Mark(3)+Andrea(4) = 7
  skDiff = 0  → 0 × 4 = 0
  no stacking (Saquib is 2, not ≥4)
  no partner history (round 1)

Court 2: Calvin(3)+Jonathan(4) = 7  vs  Christina(4)+Sheng(4) = 8
  skDiff = 1  → 1 × 4 = 4
  stacking: Christina+Sheng (both ≥4)  → 1 × 6 = 6

No sitting, no fatigue (round 1)

Random tiebreaker:  +0.43

Total score ≈ 10.43  ← lower is better
```

**Candidate B: Saquib+Mark vs Ava+Andrea | Calvin+Jonathan vs Christina+Sheng**

```
Court 1: Saquib(2)+Mark(3) = 5  vs  Ava(5)+Andrea(4) = 9
  skDiff = 4  → 4 × 4 = 16
  stacking: Ava+Andrea (both ≥4)  → 1 × 6 = 6

Court 2: same as above  → 4 + 6 = 10

Total score ≈ 32+  ← much worse
```

This shows why Saquib+Ava dominates Round 1: with 5 high-skill players in an
8-person group, pairing Saquib(2) with Ava(5) is the only way to avoid
stacking on court 1. The engine is correct — that IS the best first pairing.

### Key invariant: rotation over balance

A single `partnerRepeat` penalty (25) is larger than any realistic skill
imbalance (Δ5 × 4 = 20). So after Round 1, Saquib+Ava carry a 25-point
penalty. In Round 2 a Δ4 alternative (cost 16) beats them outright.

---

## 5. Diversity Reordering — what "Try another" shows

**Function: `diversifyRanked(sorted)` — ~line 248**

Without reordering, all 45 Saquib+Ava variants would appear as Options 1–45
before any other pairing surfaced (they all score ~10, non-Saquib+Ava score
~16+).

After sorting by score, `diversifyRanked` rebuilds the order using a greedy
rule:

> **Each next option is the best-scored remaining candidate that shares
> the fewest partner pairs with the PREVIOUS option.**

Result for the demo group:

```
Option 1: Saquib+Ava  (score ~10)   ← best overall
Option 2: Saquib+Mark (score ~16)   ← 0 partner pairs shared with option 1
Option 3: Saquib+Ava  (score ~10)   ← 0 pairs shared with option 2
Option 4: Saquib+Calvin (score ~16) ← 0 pairs shared with option 3
...
```

Every press of "Try another" shows a genuinely different set of partners.

---

## 6. Round Flow — end to end

```
Setup view
  → user adds players, sets courts/score target
  → dispatch START → view = "session"

Session view (each round)
  → user taps "Generate Round N"
      genRound():
        1. Filter to active players (status === "active")
        2. buildMatrix()  — build pair history lookup from matchHistory
        3. buildCandidates()  — enumerate all court arrangements
        4. For 2 courts: pair disjoint court candidates → 315 round candidates
        5. scoreRound() each candidate
        6. Sort by score
        7. diversifyRanked() — reorder for variety
        8. Return ranked list
      → dispatch SET_ROUND  → state.ranked = [...], state.currentRound = ranked[0]

  → user presses "Try another"
      → dispatch REGEN → regenIdx++ → currentRound = ranked[regenIdx]

  → user presses "Enter scores →"
      → view = "score"

Score view
  → user enters both teams' scores per court
  → dispatch SUBMIT:
      - appends each court to matchHistory
      - increments gamesPlayed, consecutiveGames for players who played
      - resets consecutiveGames to 0 for players who sat out
      - records lastSatOutRound
      - increments roundNumber
      - clears currentRound, ranked
      → view = "session"

Summary view
  → read-only stats, recent match log
  → "Reset session" clears everything including localStorage
```

---

## 7. Why 315 options every round — but they're never the same

The 315 candidates are **regenerated fresh each round** from the current
`matchHistory`. After Round 1 the matrix has updated `timesPartnered` counts.
The Round 1 winning option (say Saquib+Ava | Mark+Andrea | ...) would score:

```
Round 2 score for the exact same pairings:
  2 partner pairs used × partnerRepeat(25) = 50
  2 recent-partner hits × recentPartner(50) = 100
  + skill/stacking as before

Total ≈ 160+  vs. a fresh pairing ≈ 10–16
```

The previously used round effectively drops to the bottom of the 315. You
would have to press "Try another" ~310 times to see it again.

The 315 number is fixed by combinatorics (C(8,4)×3 pairs × 2-court disjoint
selection), but the scores and therefore the ORDER of those 315 change
completely every round.

---

## 8. Stacking — why it can't always be avoided

With 5 high-skill players (Andrea, Christina, Jonathan, Sheng, Ava) in an
8-person group, you need 4 teams of 2. By the **pigeonhole principle**, at
least one team will have 2 high-skill players (5 people, 4 teams → one team
gets 2 of the 5). This is mathematically unavoidable.

The engine minimises stacking rather than eliminating it. Pairing Saquib(2)
with Ava(5) "absorbs" the highest-skill player into a mixed pair, limiting the
forced stacking to one team on court 2 instead of two.

---

## Functions to read in `src/App.jsx` (in reading order)

| Function | Line | What it does |
|---|---|---|
| `W` (const) | 11 | All scoring weights — start here |
| `buildMatrix` | 49 | Builds partner/opponent history lookup |
| `buildCandidates` | 81 | Enumerates all possible court arrangements |
| `scoreRound` | 149 | Scores one round candidate (the core logic) |
| `mkExpl` | 222 | Generates the green/amber explanation chips |
| `diversifyRanked` | 271 | Reorders for "Try another" variety |
| `genRound` | 304 | Orchestrates the above into a ranked list |
| `mkPlayer` | 374 | Player data model |
| `INIT` | 390 | Initial app state |
| `reducer` | 403 | All state transitions (ADD_P, SUBMIT, RESET, etc.) |

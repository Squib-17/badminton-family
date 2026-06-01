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

**Function: `buildMatrix(players, history)` — ~line 51**

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

**Function: `buildCandidates(players, matrix, exclusions)` — ~line 83**

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

### Static rank boost for preferred pairs

Each candidate has a `staticRank` used to sort the pool before `findDisjointCombos`
traverses it. For one-court candidates where a preferred pair is on the same team,
`staticRank` is reduced by **3 per preferred pair**:

```
staticRank = skDiff + advStack + lowStack - (preferredPairsOnThisCandidate × 3)
```

This is critical for correctness at large group sizes. With 12 players there are
1,485 one-court candidates. `findDisjointCombos` caps results at 500 and traverses
the pool in order. Without sorting (or without the boost), preferred-pair candidates
can appear in the back half of the lexicographically-ordered array and be missed
entirely before the cap is hit. The boost pulls them to the front so they are
explored first.

The value of 3 is calibrated to overcome typical static rank differences: a preferred
pair with skDiff=2 gets staticRank=-1, beating a balanced non-preferred pair at 0.
A wildly imbalanced preferred pair (skDiff≥4) still scores above 0 — the boost does
not force the engine to create unbalanced courts.

### Exclusion filter

If any pair of players has been marked as "never partner", their pair key is
stored in an exclusion set. Any candidate where those two players appear on
the **same team** is dropped before scoring — they can still face each other
as opponents. If all candidates are filtered out, `genRound` returns an error.

---

## 4. Scoring — picking the best round

**Function: `scoreRound(rc, players, matrix, rn, preferred)` — ~line 153**

Every round candidate gets a single numeric score. **Lower = better.**
The engine picks the lowest-scoring candidate as Option 1.

### The weights

```js
const W = {
  skillImbalance:      4,   // per skill point of court imbalance
  partnerRepeat:      25,   // per previous occurrence of this partner pair
  recentPartner:      50,   // extra penalty if partnered in the immediately preceding round
  sittingUnfair:       8,   // per "unfair" sit (sitting player has played fewer games)
  recentSitOut:       25,   // extra if this player sat out last round too
  fatigue:            12,   // per extra consecutive game beyond 3 in a row
  stacking:            6,   // per team where both players are skill ≥ 4 or both ≤ 2
  opponentRepeat:      2,   // per previous occurrence of this opponent matchup (mild)
  preferredAlternate: -40,  // bonus for preferred pair in "every other game" mode
  preferredOccasional:-30,  // bonus for preferred pair in "occasionally" mode
};
```

### Key invariant: rotation over balance

A single `partnerRepeat` penalty (25) is larger than any realistic skill
imbalance (Δ5 × 4 = 20). So after Round 1, a repeated pairing carries a
25-point penalty. In Round 2 a Δ4 alternative (cost 16) beats them outright.

### Preferred pair scoring

When two players are configured as a "preferred pair", their shared team
receives a scoring bonus (negative weight = lower score = more likely chosen):

**Every other game mode (`preferredAlternate: -40`)**

The cumulative `timesPartnered × partnerRepeat` penalty is suppressed for
this pair — only the `recentPartner` block still applies (prevents
back-to-back rounds).

```
Non-recent round:  bonus −40 → always wins, pair appears every other game
After last round:  −40 + 50 (recentPartner) = +10 → blocked this round
Next round:        −40 again → appears again
```

This gives true every-other-game behaviour regardless of session length.

**Occasionally mode (`preferredOccasional: -30`)**

The full cumulative penalty is kept, so the preference fades naturally as
they play together more:

```
T=0 (fresh):   0 − 30 = −30  → preferred
T=1 (once):   25 − 30 = −5   → still slightly preferred
T=2 (twice):  50 − 30 = +20  → now penalised, natural rotation takes over
```

This produces roughly 2–3 pairings per session, then they rotate like
anyone else.

---

## 5. Diversity Reordering — what "Try another" shows

**Function: `diversifyRanked(sorted)` — ~line 277**

Without reordering, all variants featuring the same strong pairing would
dominate the first 40+ options. After sorting by score, `diversifyRanked`
rebuilds the order using a greedy rule:

> **Each next option is the best-scored remaining candidate that shares
> the fewest partner pairs with the previous option.**

Every press of "Try another" shows a genuinely different set of partners.

---

## 6. Round Flow — end to end

```
Setup view
  → user adds players, marks any as Resting, sets courts/score target
  → optionally configures Exclusions or Preferred pairs
  → dispatch START → view = "session"

Session view (each round)
  → user taps "Generate Round N"
      genRound():
        1. Filter to active players (status === "active")
        2. buildMatrix()  — build pair history lookup from matchHistory
        3. buildCandidates()  — enumerate all valid court arrangements
           (excluded pairs are filtered out at this stage)
        4. For 2 courts: pair disjoint court candidates → round candidates
        5. scoreRound() each candidate (preferred bonuses applied here)
        6. Sort by score
        7. diversifyRanked() — reorder for variety
        8. Return ranked list
      → dispatch SET_ROUND

  → user presses "Try another"
      → dispatch REGEN → regenIdx++ → currentRound = ranked[regenIdx]

  → user presses "Enter scores →"
      → view = "score"

Score view
  → user enters both teams' scores per court
  → dispatch SUBMIT:
      - appends each court to matchHistory
      - updates gamesPlayed, consecutiveGames, wins/losses, points
      - increments roundNumber
      - clears currentRound, ranked
      → view = "session"

Summary view
  → read-only stats, recent match log
  → "New session - keep players" resets scores/history, preserves player list,
    skill levels, exclusions, and preferred pairs
  → "Full reset" clears everything
```

---

## 7. Exclusions — hard partner constraints

Exclusions are stored as `state.exclusions: [{a: id, b: id}]`.

They are applied in `buildCandidates` as a pre-filter before any scoring:

```js
const exclSet = new Set(exclusions.map(({ a, b }) => pk(a, b)));
// candidate is dropped if exclSet has t1pk OR t2pk
```

This means excluded players can **never appear on the same team** but can
still face each other across the net. The constraint is absolute — it is not
a penalty that can be outweighed by other factors.

If exclusion rules leave zero valid candidates, `genRound` returns a user-
visible error: *"Exclusion rules leave no valid pairings — remove some."*

**"New session - keep players"** preserves all exclusions. **"Full reset"** clears them.

---

## 8. Preferred pairs — scoring bonuses

Preferred pairs are stored as `state.preferred: [{a: id, b: id, freq}]`
where `freq` is `'alternate'` or `'occasional'`.

The bonus is applied in `scoreRound` via a `prefMap` keyed on the pair's
canonical key `pk(a, b)`.

- `freq === 'occasional'` → weight `W.preferredOccasional` (−30), cumulative
  penalty kept — pair appears ~2-3 times then fades naturally.
- `freq !== 'occasional'` (i.e. `'alternate'`) → weight `W.preferredAlternate`
  (−40), cumulative penalty suppressed — pair appears every other round
  indefinitely.

The explanation chip "Preferred pair matched" appears in the session view
whenever a preferred pair is on one of the courts.

**Multiple preferred pairs** work independently — each pair gets its own bonus
applied to whichever court they appear on. When two preferred pairs can both fit
on separate courts simultaneously (e.g., Mark+Grace on court 1, Andrea+Ava on
court 2), the combined bonus is doubled (-80), so the engine strongly prefers
rounds where both are satisfied at once.

**One player in two preferred pairs** is valid — the engine picks whichever
pairing gives a lower score given the current history. With alternate mode, this
naturally alternates: when Grace is a recent partner for Mark, the engine turns
to Andrea (and vice versa), so Mark ends up with one of his preferred partners
almost every round.

---

## 9. Why 315 options every round — but they're never the same

The 315 candidates are **regenerated fresh each round** from the current
`matchHistory`. After Round 1 the matrix has updated `timesPartnered` counts.
The Round 1 winning option would score:

```
Round 2 score for the exact same pairings:
  2 partner pairs used × partnerRepeat(25) = 50
  2 recent-partner hits × recentPartner(50) = 100
  + skill/stacking as before

Total ≈ 160+  vs. a fresh pairing ≈ 10–16
```

The previously used round drops to the bottom of the list.

---

## 10. Stacking — why it can't always be avoided

With 5 high-skill players (Andrea, Christina, Jonathan, Sheng, Ava) in an
8-person group, you need 4 teams of 2. By the **pigeonhole principle**, at
least one team will have 2 high-skill players. The engine minimises stacking
rather than eliminating it.

---

## Functions to read in `src/App.jsx` (in reading order)

| Function | ~Line | What it does |
|---|---|---|
| `W` (const) | 11 | All scoring weights — start here |
| `buildMatrix` | 51 | Builds partner/opponent history lookup |
| `buildCandidates` | 83 | Enumerates valid court arrangements; applies exclusion filter |
| `scoreRound` | 153 | Scores one round candidate; applies preferred bonuses |
| `mkExpl` | 245 | Generates the green/amber explanation chips |
| `diversifyRanked` | 277 | Reorders for "Try another" variety |
| `genRound` | 310 | Orchestrates the above into a ranked list |
| `mkPlayer` | 426 | Player data model |
| `INIT` | 442 | Initial app state |
| `reducer` | 455 | All state transitions (ADD_P, SUBMIT, RESET, etc.) |

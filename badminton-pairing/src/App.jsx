import { useState, useReducer, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// SCORING WEIGHTS
// Lower total score = better round candidate.
// Weights are tuned so partner rotation clearly dominates minor skill gaps:
//   • Δ3 skill imbalance costs 12 — one partner repeat costs 25.
//   • Fresh Δ3 match beats any repeated pairing.
//   • In late sessions (all partners used), engine falls back to skill balance.
// ─────────────────────────────────────────────────────────────────────────────
const W = {
  skillImbalance: 4, // per skill point of court imbalance (no tolerance band — weights do the work)
  partnerRepeat: 25, // per previous occurrence of this partner pair
  recentPartner: 50, // extra penalty if partnered in the immediately preceding round
  sittingUnfair: 8, // per "unfair" sit (sitting player has played fewer games than a playing player)
  recentSitOut: 25, // extra penalty if this player sat out last round too
  fatigue: 12, // per extra consecutive game beyond 3
  stacking: 6, // per team where both players are skill ≥ 4 or both ≤ 2
  opponentRepeat: 2, // per previous occurrence of this opponent matchup (mild)
  preferredAlternate: -40, // bonus when preferred pair (every-other-game mode) are on the same team
  preferredOccasional: -30, // bonus when preferred pair (occasionally mode) — T=1 scores -5 (still preferred), T=2 scores +20 (natural fade)
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);

function C(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [...C(t, k - 1).map((c) => [h, ...c]), ...C(t, k)];
}

const pk = (a, b) => [a, b].sort().join('|');

// ─────────────────────────────────────────────────────────────────────────────
// PAIR CLASSIFICATION  (used for static pair quality label only)
// ─────────────────────────────────────────────────────────────────────────────
function classify(s1, s2) {
  if ((s1 >= 4 && s2 >= 4) || (s1 <= 2 && s2 <= 2)) return 'discouraged';
  const s = s1 + s2;
  return s >= 5 && s <= 7 ? 'preferred' : 'allowed';
}
const PEN = { preferred: 0, allowed: 1, discouraged: 3 };

// ─────────────────────────────────────────────────────────────────────────────
// PAIR MATRIX  — tracks how often each 2-player pair have been partners/opponents
// ─────────────────────────────────────────────────────────────────────────────
function buildMatrix(players, history) {
  const m = {};
  C(
    players.map((p) => p.id),
    2,
  ).forEach(([a, b]) => {
    const pa = players.find((p) => p.id === a),
      pb = players.find((p) => p.id === b);
    const q = classify(pa.skill, pb.skill);
    m[pk(a, b)] = {
      pairQuality: q,
      staticPenalty: PEN[q],
      timesPartnered: 0,
      lastPartneredRound: null,
      timesOpposed: 0,
      lastOpposedRound: null,
    };
  });
  history.forEach(({ team1, team2, roundNumber: rn }) => {
    const up = (key, f, rf) => m[key] && (m[key][f]++, (m[key][rf] = rn));
    up(pk(team1[0], team1[1]), 'timesPartnered', 'lastPartneredRound');
    up(pk(team2[0], team2[1]), 'timesPartnered', 'lastPartneredRound');
    team1.forEach((a) =>
      team2.forEach((b) => up(pk(a, b), 'timesOpposed', 'lastOpposedRound')),
    );
  });
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE BUILDER  — NC4 × 3 one-court candidates from active players
// ─────────────────────────────────────────────────────────────────────────────
function buildCandidates(players, matrix, exclusions = []) {
  const exclSet = new Set(exclusions.map(({ a, b }) => pk(a, b)));
  const res = [];
  C(
    players.map((p) => p.id),
    4,
  ).forEach(([a, b, c, d]) => {
    [
      [
        [a, b],
        [c, d],
      ],
      [
        [a, c],
        [b, d],
      ],
      [
        [a, d],
        [b, c],
      ],
    ].forEach(([t1, t2]) => {
      const g = (id) => players.find((p) => p.id === id);
      const [p1, p2, p3, p4] = [g(t1[0]), g(t1[1]), g(t2[0]), g(t2[1])];
      if (!p1 || !p2 || !p3 || !p4) return;
      const t1Sk = p1.skill + p2.skill,
        t2Sk = p3.skill + p4.skill;
      const skDiff = Math.abs(t1Sk - t2Sk);
      const t1pk = pk(t1[0], t1[1]),
        t2pk = pk(t2[0], t2[1]);
      const oppKeys = [
        pk(t1[0], t2[0]),
        pk(t1[0], t2[1]),
        pk(t1[1], t2[0]),
        pk(t1[1], t2[1]),
      ];
      const advStack =
        (p1.skill >= 4 && p2.skill >= 4 ? 1 : 0) +
        (p3.skill >= 4 && p4.skill >= 4 ? 1 : 0);
      const lowStack =
        (p1.skill <= 2 && p2.skill <= 2 ? 1 : 0) +
        (p3.skill <= 2 && p4.skill <= 2 ? 1 : 0);
      const pqScore =
        (matrix[t1pk]?.staticPenalty ?? 0) + (matrix[t2pk]?.staticPenalty ?? 0);
      if (exclSet.has(t1pk) || exclSet.has(t2pk)) return;
      res.push({
        cid: uid(),
        team1: t1,
        team2: t2,
        allIds: [...t1, ...t2],
        t1pk,
        t2pk,
        oppKeys,
        t1Sk,
        t2Sk,
        skDiff,
        advStack,
        lowStack,
        pqScore,
        staticRank: skDiff + advStack + lowStack,
      });
    });
  });
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE SCORING
// Single number — lower is better. Weights ensure partner rotation dominates
// small skill gaps. A fresh Δ3 pairing always beats any repeated pairing.
// ─────────────────────────────────────────────────────────────────────────────
function scoreRound(rc, players, matrix, rn, preferred = []) {
  const { courts, sittingIds } = rc;
  const playIds = courts.flatMap((c) => c.allIds);
  const gp = (id) => players.find((p) => p.id === id);
  // prefMap stores { weight, alternate } per pair key.
  // alternate=true pairs suppress the cumulative partnerRepeat penalty so timesPartnered
  // never accumulates against them — only the recentPartner block (last round) still applies.
  // This gives true every-other-game behaviour regardless of how many times they've played together.
  // occasional pairs keep the full cumulative penalty so their preference fades naturally after a few sessions.
  const prefMap = new Map(preferred.map(({ a, b, freq }) => [
    pk(a, b),
    { weight: freq === 'occasional' ? W.preferredOccasional : W.preferredAlternate, alternate: freq !== 'occasional' },
  ]));
  let s = 0;

  // Per-court penalties
  let maxDiff = 0,
    totalRepeats = 0,
    hasRecentRepeat = false,
    preferredHit = false;
  courts.forEach((c) => {
    // Skill balance
    s += c.skDiff * W.skillImbalance;
    maxDiff = Math.max(maxDiff, c.skDiff);

    // Preferred pair bonus (per-pair weight based on chosen frequency)
    const t1pref = prefMap.get(c.t1pk);
    const t2pref = prefMap.get(c.t2pk);
    if (t1pref !== undefined) { s += t1pref.weight; preferredHit = true; }
    if (t2pref !== undefined) { s += t2pref.weight; preferredHit = true; }

    // Partner history.
    // For alternate-mode preferred pairs, suppress the cumulative timesPartnered penalty
    // so the bonus stays effective every other round regardless of session length.
    // The recentPartner penalty is always applied to block back-to-back rounds.
    const t1p = matrix[c.t1pk],
      t2p = matrix[c.t2pk];
    if (t1p) {
      if (!t1pref?.alternate) s += t1p.timesPartnered * W.partnerRepeat;
      if (t1p.lastPartneredRound === rn - 1) {
        s += W.recentPartner;
        hasRecentRepeat = true;
      }
      totalRepeats += t1p.timesPartnered;
    }
    if (t2p) {
      if (!t2pref?.alternate) s += t2p.timesPartnered * W.partnerRepeat;
      if (t2p.lastPartneredRound === rn - 1) {
        s += W.recentPartner;
        hasRecentRepeat = true;
      }
      totalRepeats += t2p.timesPartnered;
    }

    // Stacking
    s += (c.advStack + c.lowStack) * W.stacking;

    // Opponent repeat
    c.oppKeys.forEach((ok) => {
      const op = matrix[ok];
      if (op) s += op.timesOpposed * W.opponentRepeat;
    });
  });

  // Sitting fairness
  sittingIds.forEach((sid) => {
    const sp = gp(sid);
    if (!sp) return;
    playIds.forEach((pid) => {
      const pp = gp(pid);
      if (pp && sp.gamesPlayed < pp.gamesPlayed) s += W.sittingUnfair;
    });
    if (sp.lastSatOutRound === rn - 1) s += W.recentSitOut;
  });

  // Fatigue
  playIds.forEach((id) => {
    const p = gp(id);
    if (p && p.consecutiveGames >= 3) s += (p.consecutiveGames - 2) * W.fatigue;
  });

  // Small random tiebreaker so equal-score options vary across sessions
  s += Math.random();

  // Store analysis for UI explanations
  rc.analysis = { maxDiff, totalRepeats, hasRecentRepeat, preferredHit };
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPLANATION CHIPS
// ─────────────────────────────────────────────────────────────────────────────
function mkExpl(rc) {
  const {
    maxDiff = 0,
    totalRepeats = 0,
    hasRecentRepeat = false,
    preferredHit = false,
  } = rc.analysis || {};
  const out = [];

  if (maxDiff === 0) out.push({ text: 'Perfectly balanced', ok: true });
  else if (maxDiff <= 1)
    out.push({ text: `Well balanced (Δ${maxDiff})`, ok: true });
  else if (maxDiff <= 3)
    out.push({ text: `Good balance (Δ${maxDiff})`, ok: true });
  else out.push({ text: `Skill gap: Δ${maxDiff}`, ok: false });

  if (totalRepeats === 0) out.push({ text: 'No partner repeats', ok: true });
  else if (hasRecentRepeat)
    out.push({ text: 'Repeated partner from last round', ok: false });
  else out.push({ text: `Partner overlap ×${totalRepeats}`, ok: false });

  if (rc.sittingIds.length === 0)
    out.push({ text: 'Everyone plays', ok: true });

  if (preferredHit) out.push({ text: 'Preferred pair matched', ok: true });

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIVERSITY REORDERING
//
// After scoring and sorting, consecutive "Try another" options can be dominated
// by structurally similar pairings (e.g. same player always partnered with the
// same person because they give the best skill balance). This reorders the
// ranked list so each option has the fewest partner pairs in common with the
// PREVIOUS option — guaranteeing genuine variety on every press.
//
// Algorithm: greedy, O(n²). For n=315 candidates that's ~400K pair-set lookups;
// well under 5ms in the browser.
// ─────────────────────────────────────────────────────────────────────────────
function rcPairSet(rc) {
  return new Set(
    rc.courts.flatMap((c) => [pk(c.team1[0], c.team1[1]), pk(c.team2[0], c.team2[1])]),
  );
}

function countSharedPairs(setA, rc) {
  let n = 0;
  for (const p of rcPairSet(rc)) if (setA.has(p)) n++;
  return n;
}

function diversifyRanked(sorted) {
  if (sorted.length <= 1) return sorted;
  const result = [sorted[0]];
  const remaining = [...sorted.slice(1)]; // already sorted by score — best first

  while (remaining.length > 0) {
    const curPairs = rcPairSet(result[result.length - 1]);
    let minShared = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      const s = countSharedPairs(curPairs, remaining[i]);
      if (s < minShared) {
        minShared = s;
        bestIdx = i;
        // remaining is score-sorted, so first hit at any shared-count level is
        // also the best-scored candidate at that level — safe to stop early.
        if (s === 0) break;
      }
    }
    result.push(remaining.splice(bestIdx, 1)[0]);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISJOINT COURT FINDER
// Finds all groups of `n` mutually disjoint one-court candidates from `pool`.
// Uses backtracking: add players to usedIds on recurse, remove on return.
// Starting index advances so each combo is counted exactly once (no duplicates).
// ─────────────────────────────────────────────────────────────────────────────
// maxResults caps how many disjoint combos we score — keeps things fast even
// for 3 courts / 12 players where valid combos can number in the thousands.
function findDisjointCombos(pool, n, maxResults = 500) {
  const results = [];
  const usedIds = new Set();
  function go(startIdx, chosen) {
    if (results.length >= maxResults) return;
    if (chosen.length === n) { results.push([...chosen]); return; }
    for (let i = startIdx; i < pool.length; i++) {
      if (results.length >= maxResults) return;
      const c = pool[i];
      if (c.allIds.some((id) => usedIds.has(id))) continue;
      c.allIds.forEach((id) => usedIds.add(id));
      chosen.push(c);
      go(i + 1, chosen);
      chosen.pop();
      c.allIds.forEach((id) => usedIds.delete(id));
    }
  }
  go(0, []);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUND GENERATOR
//
// Pool strategy: use full enumeration for all practical group sizes (N ≤ 12).
// Top-200 was the old limit but caused 0 results for 3 courts / 12 players
// because 200 out of 1485 candidates lacked enough player coverage to form
// any disjoint triple. Full enumeration + the maxResults cap in
// findDisjointCombos keeps runtime well under 100ms.
// ─────────────────────────────────────────────────────────────────────────────
function genRound(state) {
  const { players, settings, matchHistory, roundNumber, exclusions = [], preferred = [] } = state;
  const active = players.filter((p) => p.status === 'active');
  if (active.length < 4) return { error: 'Need at least 4 active players.' };

  const matrix = buildMatrix(active, matchHistory);
  const allCands = buildCandidates(active, matrix, exclusions);
  const maxCourts = Math.floor(active.length / 4);
  const courtsToGen = Math.min(settings.courts, maxCourts);
  const note =
    courtsToGen < settings.courts
      ? `Only ${courtsToGen} court${courtsToGen !== 1 ? 's' : ''} possible with ${active.length} players.`
      : null;

  const activeIds = active.map((p) => p.id);
  let rcs = [];

  if (allCands.length === 0) {
    return { error: 'Exclusion rules leave no valid pairings — remove some.' };
  }

  if (courtsToGen === 1) {
    allCands.forEach((c) => {
      const sittingIds = activeIds.filter((id) => !c.allIds.includes(id));
      const rc = { id: uid(), courts: [c], sittingIds };
      rc.score = scoreRound(rc, active, matrix, roundNumber, preferred);
      rc.explanations = mkExpl(rc);
      rcs.push(rc);
    });
  } else {
    // Sort by staticRank so the backtracker sees balanced courts first.
    // Cap at 300 only for very large groups (N > 15).
    const sorted = [...allCands].sort((a, b) => a.staticRank - b.staticRank);
    const pool = active.length <= 15 ? sorted : sorted.slice(0, 300);

    const pushRc = (courts) => {
      const playIds = courts.flatMap((c) => c.allIds);
      const sittingIds = activeIds.filter((id) => !playIds.includes(id));
      const rc = { id: uid(), courts, sittingIds };
      rc.score = scoreRound(rc, active, matrix, roundNumber, preferred);
      rc.explanations = mkExpl(rc);
      rcs.push(rc);
    };

    // Seeded pass: for each preferred pair, explicitly anchor their best one-court
    // candidates and find disjoint completions from the full pool.
    // This guarantees preferred-pair combos are scored at ANY group size,
    // without flooding the pool (which would prevent non-preferred alternatives
    // from appearing in rounds when the preferred pair is blocked by recentPartner).
    if (preferred.length > 0) {
      preferred.forEach(({ a: pa, b: pb }) => {
        const pairKey = pk(pa, pb);
        allCands
          .filter((c) => c.t1pk === pairKey || c.t2pk === pairKey)
          .sort((a, b) => a.staticRank - b.staticRank)
          .slice(0, 15)
          .forEach((pc) => {
            const restPool = pool.filter((c) => !c.allIds.some((id) => pc.allIds.includes(id)));
            findDisjointCombos(restPool, courtsToGen - 1, 10).forEach((restCourts) => {
              pushRc([pc, ...restCourts]);
            });
          });
      });
    }

    // Normal pass: full sorted pool for alternatives (including non-preferred rounds).
    findDisjointCombos(pool, courtsToGen).forEach((courts) => pushRc(courts));

    // Deduplicate by court composition (seeded + normal passes may overlap)
    const seen = new Set();
    rcs = rcs.filter((rc) => {
      const key = rc.courts.map((c) => [c.t1pk, c.t2pk].sort().join(':')).sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Fallback: if no multi-court combos found, drop to 1 court
    if (rcs.length === 0) {
      allCands.forEach((c) => {
        const sittingIds = activeIds.filter((id) => !c.allIds.includes(id));
        const rc = { id: uid(), courts: [c], sittingIds };
        rc.score = scoreRound(rc, active, matrix, roundNumber, preferred);
        rc.explanations = mkExpl(rc);
        rcs.push(rc);
      });
    }
  }

  rcs.sort((a, b) => a.score - b.score);
  rcs = diversifyRanked(rcs); // reorder so consecutive options have different partner pairs
  return { candidates: rcs, note };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const mkPlayer = (name, skill) => ({
  id: uid(),
  name,
  skill,
  status: 'active',
  gamesPlayed: 0,
  sitOutCount: 0,
  consecutiveGames: 0,
  wins: 0,
  losses: 0,
  pointsScored: 0,
  pointsConceded: 0,
  lastPlayedRound: null,
  lastSatOutRound: null,
});

const INIT = {
  view: 'setup',
  players: [],
  settings: { courts: 2, scoreTarget: 21 },
  exclusions: [],
  preferred: [],
  matchHistory: [],
  roundNumber: 1,
  ranked: [],
  regenIdx: 0,
  currentRound: null,
  pendingScores: [],
  note: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_P':
      return { ...state, players: [...state.players, action.p] };
    case 'DEL_P':
      return {
        ...state,
        players: state.players.filter((p) => p.id !== action.id),
      };
    case 'UPD_P': {
      const updPlayers = state.players.map((p) =>
        p.id === action.id ? { ...p, ...action.u } : p,
      );
      // Status change invalidates any already-displayed round — force regeneration
      if ('status' in action.u && state.currentRound) {
        return { ...state, players: updPlayers, currentRound: null, ranked: [], regenIdx: 0, note: null };
      }
      return { ...state, players: updPlayers };
    }
    case 'ADD_EXCL': {
      const key = pk(action.pair.a, action.pair.b);
      if (state.exclusions.some(({ a, b }) => pk(a, b) === key)) return state;
      return { ...state, exclusions: [...state.exclusions, action.pair] };
    }
    case 'DEL_EXCL':
      return { ...state, exclusions: state.exclusions.filter(({ a, b }) => pk(a, b) !== action.key) };
    case 'ADD_PREF': {
      const key = pk(action.pair.a, action.pair.b);
      if (state.preferred.some(({ a, b }) => pk(a, b) === key)) return state;
      return { ...state, preferred: [...state.preferred, action.pair] };
    }
    case 'DEL_PREF':
      return { ...state, preferred: state.preferred.filter(({ a, b }) => pk(a, b) !== action.key) };
    case 'UPD_PREF':
      return { ...state, preferred: state.preferred.map(p => pk(p.a, p.b) === action.key ? { ...p, freq: action.freq } : p) };
    case 'SET_S':
      return {
        ...state,
        settings: { ...state.settings, [action.k]: action.v },
      };
    case 'START':
      return { ...state, view: 'session' };
    case 'SET_ROUND':
      return {
        ...state,
        ranked: action.cs,
        regenIdx: 0,
        currentRound: action.cs[0] ?? null,
        note: action.note,
      };
    case 'REGEN': {
      const ni = (state.regenIdx + 1) % Math.max(1, state.ranked.length);
      return {
        ...state,
        regenIdx: ni,
        currentRound: state.ranked[ni] ?? state.currentRound,
      };
    }
    case 'SCORE_VIEW':
      return {
        ...state,
        view: 'score',
        pendingScores: (state.currentRound?.courts ?? []).map((_, i) => ({
          i,
          t1: '',
          t2: '',
        })),
      };
    case 'SET_SC':
      return {
        ...state,
        pendingScores: state.pendingScores.map((s, i) =>
          i === action.i ? { ...s, [action.k]: action.v } : s,
        ),
      };
    case 'SUBMIT': {
      const newHist = [...state.matchHistory];
      const updP = state.players.map((p) => ({ ...p }));
      state.currentRound.courts.forEach((court, i) => {
        const sc = state.pendingScores[i];
        const t1s = parseInt(sc?.t1) || 0,
          t2s = parseInt(sc?.t2) || 0;
        const w = t1s > t2s ? 'team1' : t1s < t2s ? 'team2' : null;
        newHist.push({
          matchId: uid(),
          roundNumber: state.roundNumber,
          courtNumber: i + 1,
          team1: court.team1,
          team2: court.team2,
          team1Score: t1s,
          team2Score: t2s,
          winner: w,
        });
        [...court.team1, ...court.team2].forEach((id) => {
          const p = updP.find((p) => p.id === id);
          if (!p) return;
          p.gamesPlayed++;
          p.consecutiveGames++;
          p.lastPlayedRound = state.roundNumber;
        });
        court.team1.forEach((id) => {
          const p = updP.find((p) => p.id === id);
          if (!p) return;
          p.pointsScored += t1s;
          p.pointsConceded += t2s;
          if (w === 'team1') p.wins++;
          else if (w === 'team2') p.losses++;
        });
        court.team2.forEach((id) => {
          const p = updP.find((p) => p.id === id);
          if (!p) return;
          p.pointsScored += t2s;
          p.pointsConceded += t1s;
          if (w === 'team2') p.wins++;
          else if (w === 'team1') p.losses++;
        });
      });
      state.currentRound.sittingIds.forEach((id) => {
        const p = updP.find((p) => p.id === id);
        if (!p) return;
        p.sitOutCount++;
        p.consecutiveGames = 0;
        p.lastSatOutRound = state.roundNumber;
      });
      return {
        ...state,
        view: 'session',
        matchHistory: newHist,
        players: updP,
        roundNumber: state.roundNumber + 1,
        currentRound: null,
        ranked: [],
        regenIdx: 0,
        pendingScores: [],
        note: null,
      };
    }
    case 'SUMMARY':
      return { ...state, view: 'summary' };
    case 'BACK':
      return { ...state, view: 'session' };
    case 'BACK_TO_SETUP':
      return { ...state, view: 'setup', currentRound: null, ranked: [], regenIdx: 0, note: null };
    case 'RESET_KEEP_PLAYERS': {
      localStorage.removeItem('bp-session');
      const freshPlayers = state.players.map((p) => ({ ...mkPlayer(p.name, p.skill), id: p.id }));
      return { ...INIT, players: freshPlayers, settings: { ...state.settings },
               exclusions: state.exclusions, preferred: state.preferred };
    }
    case 'RESET':
      localStorage.removeItem('bp-session');
      return { ...INIT };
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE VALIDATION  (soft warning only — never blocks submission)
// Rules: win at `target`, deuce if tied at target-1, cap at target+9 (21→30, 15→24).
// ─────────────────────────────────────────────────────────────────────────────
function getScoreWarning(t1Str, t2Str, target) {
  const a = parseInt(t1Str), b = parseInt(t2Str);
  if (isNaN(a) || isNaN(b)) return null;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  const cap = target === 21 ? 30 : target + 2; // 21→30, 15→17
  if (hi < target) return `Neither team has reached ${target} — game may not be finished`;
  if (hi === target && lo === target - 1) return `At ${lo}–${lo}, play continues until one team leads by 2`;
  if (hi > cap) return `Score exceeds the ${cap}-point maximum`;
  if (hi > target && hi < cap && hi - lo !== 2) return `Past ${target}: winner needs a 2-point lead`;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const AMB = '#F59E0B';
const GRN = '#059669';
const RED = '#DC2626';

const CSS_INJECT = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
  :root {
    --color-background-primary: #ffffff;
    --color-background-secondary: #f8fafc;
    --color-text-primary: #0f172a;
    --color-text-secondary: #64748b;
    --color-border-secondary: #e2e8f0;
    --color-border-tertiary: #f1f5f9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-background-primary: #0f172a;
      --color-background-secondary: #1e293b;
      --color-text-primary: #f8fafc;
      --color-text-secondary: #94a3b8;
      --color-border-secondary: #334155;
      --color-border-tertiary: #283245;
    }
  }
  * { box-sizing: border-box; }
  body { font-family: 'DM Sans', system-ui, sans-serif; background: var(--color-background-primary); color: var(--color-text-primary); margin: 0; }
  .bp-app { font-family: 'DM Sans', system-ui, sans-serif; min-height: 100vh; background: var(--color-background-primary); }
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
  .bp-btn { transition: opacity 0.12s, transform 0.08s; cursor: pointer; }
  .bp-btn:hover { opacity: 0.85; }
  .bp-btn:active { transform: scale(0.96); }
  input:focus { outline: 2px solid ${AMB} !important; outline-offset: 1px; }
`;

const CARD = {
  background: 'var(--color-background-primary)',
  border: '1px solid var(--color-border-tertiary)',
  borderRadius: 14,
  padding: 20,
  marginBottom: 14,
};
const LBL = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '1.2px',
  textTransform: 'uppercase',
  color: 'var(--color-text-secondary)',
  display: 'block',
  marginBottom: 10,
};
const INP = {
  background: 'var(--color-background-secondary)',
  border: '1px solid var(--color-border-secondary)',
  borderRadius: 9,
  padding: '10px 13px',
  color: 'var(--color-text-primary)',
  fontSize: 15,
  width: '100%',
  fontFamily: 'inherit',
};
const WRAP = { maxWidth: 500, margin: '0 auto', padding: '20px 16px 70px' };

const DEMO = [
  ['Saquib', 2],
  ['Andrea', 4],
  ['Mark', 3],
  ['Christina', 4],
  ['Calvin', 3],
  ['Ava', 5],
  ['Jonathan', 4],
  ['Sheng', 4],
];
const SKILL_LABELS = [
  '',
  'Beginner',
  'Beginner+',
  'Intermediate',
  'Advanced',
  'Expert',
];

// ─────────────────────────────────────────────────────────────────────────────
// UI COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function SkillPicker({ value, onChange }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className="bp-btn"
            onClick={() => onChange(n)}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background:
                n <= value ? AMB : 'var(--color-background-secondary)',
              color: n <= value ? '#000' : 'var(--color-text-secondary)',
              fontWeight: 600,
              fontSize: 14,
              boxShadow: n === value ? `0 0 0 2px ${AMB}` : 'none',
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div
        style={{
          fontSize: 12,
          color: AMB,
          fontWeight: 500,
          textAlign: 'center',
        }}
      >
        {SKILL_LABELS[value]}
      </div>
    </div>
  );
}

function SkillDots({ value, size = 12 }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          style={{
            display: 'inline-block',
            width: size,
            height: size,
            borderRadius: '50%',
            background: n <= value ? AMB : '#CBD5E1',
          }}
        />
      ))}
    </div>
  );
}

function ToggleBtn({ selected, onClick, children }) {
  return (
    <button
      className="bp-btn"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 0',
        borderRadius: 9,
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        border: 'none',
        background: selected ? AMB : 'var(--color-background-secondary)',
        color: selected ? '#000' : 'var(--color-text-secondary)',
        boxShadow: selected
          ? `0 0 0 2px ${AMB}`
          : '0 0 0 1px var(--color-border-tertiary)',
      }}
    >
      {children}
    </button>
  );
}

function Hdr({ sub, right }) {
  return (
    <div
      style={{
        background: 'var(--color-background-secondary)',
        borderBottom: '1px solid var(--color-border-secondary)',
        boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
        padding: '11px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1 }}>
        <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>🏸</span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Badminton Pairing
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sub}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'nowrap' }}>{right}</div>
    </div>
  );
}

function BtnPrimary({ onClick, children, style = {} }) {
  return (
    <button
      className="bp-btn"
      onClick={onClick}
      style={{
        background: AMB,
        color: '#000',
        padding: '13px 20px',
        borderRadius: 10,
        border: 'none',
        fontSize: 15,
        fontWeight: 600,
        width: '100%',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function BtnSec({ onClick, children, style = {} }) {
  return (
    <button
      className="bp-btn"
      onClick={onClick}
      style={{
        background: 'var(--color-background-secondary)',
        color: 'var(--color-text-primary)',
        padding: '7px 11px',
        borderRadius: 9,
        border: '1px solid var(--color-border-secondary)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function BtnDanger({ onClick, children, style = {} }) {
  return (
    <button
      className="bp-btn"
      onClick={onClick}
      style={{
        background: 'transparent',
        color: RED,
        padding: '7px 11px',
        borderRadius: 9,
        border: `1px solid ${RED}`,
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function CourtCard({ court, pName, idx }) {
  return (
    <div
      style={{
        background: 'rgba(5,150,105,0.07)',
        border: '1px solid rgba(5,150,105,0.3)',
        borderRadius: 14,
        padding: 18,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          color: GRN,
          marginBottom: 14,
        }}
      >
        Court {idx + 1}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              lineHeight: 1.3,
            }}
          >
            {court.team1.map(pName).join(' + ')}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              marginTop: 3,
            }}
          >
            Skill {court.t1Sk}
          </div>
        </div>
        <div
          style={{
            background: 'var(--color-background-secondary)',
            color: 'var(--color-text-secondary)',
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          vs
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              lineHeight: 1.3,
            }}
          >
            {court.team2.map(pName).join(' + ')}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              marginTop: 3,
            }}
          >
            Skill {court.t2Sk}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid rgba(5,150,105,0.2)',
          fontSize: 12,
          color: GRN,
          fontWeight: 500,
        }}
      >
        Balance: Δ{court.skDiff}
        {court.skDiff === 0
          ? ' — perfectly matched ✓'
          : court.skDiff <= 2
            ? ' — good'
            : ''}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'bp-session';

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Migrate state saved before exclusions/preferred were added
    return { exclusions: [], preferred: [], ...saved };
  } catch {
    return null;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadSavedState() ?? INIT);

  useEffect(() => {
    try {
      // ranked and currentRound are ephemeral — can be megabytes, never need to persist
      const { ranked: _r, currentRound: _c, ...toSave } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // QuotaExceededError — silently skip, session state is safe in memory
    }
  }, [state]);
  const [newName, setNewName] = useState('');
  const [newSkill, setNewSkill] = useState(3);
  const [genErr, setGenErr] = useState('');
  const [showResetMenu, setShowResetMenu] = useState(false);
  const [showAddExcl, setShowAddExcl] = useState(false);
  const [showAddPref, setShowAddPref] = useState(false);
  const [pairFormA, setPairFormA] = useState('');
  const [pairFormB, setPairFormB] = useState('');
  const [pairFormFreq, setPairFormFreq] = useState('alternate');

  const pName = (id) => state.players.find((p) => p.id === id)?.name ?? '?';

  const addPlayer = () => {
    const n = newName.trim();
    if (!n) return;
    dispatch({ type: 'ADD_P', p: mkPlayer(n, newSkill) });
    setNewName('');
    setNewSkill(3);
  };

  const loadDemo = () => {
    dispatch({ type: 'RESET' });
    setTimeout(
      () =>
        DEMO.forEach(([name, skill]) =>
          dispatch({ type: 'ADD_P', p: mkPlayer(name, skill) }),
        ),
      0,
    );
  };

  const handleGenerate = () => {
    const res = genRound(state);
    if (res.error || !res.candidates?.length) {
      setGenErr(res.error || 'No valid pairings found.');
      return;
    }
    setGenErr('');
    dispatch({ type: 'SET_ROUND', cs: res.candidates, note: res.note });
  };

  const resetBottomSheet = showResetMenu ? (
    <div
      onClick={() => setShowResetMenu(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-background-primary)', borderRadius: '20px 20px 0 0', padding: '24px 20px 40px', width: '100%', boxShadow: '0 -8px 32px rgba(0,0,0,0.2)' }}
      >
        <div style={{ width: 44, height: 5, borderRadius: 3, background: 'var(--color-border-secondary)', margin: '0 auto 24px' }} />
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>Reset session?</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
          {state.matchHistory.length > 0
            ? `${state.matchHistory.length} match${state.matchHistory.length !== 1 ? 'es' : ''} across ${state.roundNumber - 1} round${state.roundNumber !== 2 ? 's' : ''}`
            : 'No matches recorded yet'}
        </div>
        <button
          className="bp-btn"
          onClick={() => { dispatch({ type: 'RESET_KEEP_PLAYERS' }); setShowResetMenu(false); }}
          style={{ width: '100%', padding: '16px 20px', borderRadius: 14, border: 'none', background: AMB, color: '#000', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 10, textAlign: 'left' }}
        >
          <div>New session — keep players</div>
          <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.7, marginTop: 3 }}>Clears scores and match history, keeps names</div>
        </button>
        <button
          className="bp-btn"
          onClick={() => { dispatch({ type: 'RESET' }); setShowResetMenu(false); }}
          style={{ width: '100%', padding: '16px 20px', borderRadius: 14, border: `1.5px solid ${RED}`, background: 'rgba(220,38,38,0.06)', color: RED, fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 10, textAlign: 'left' }}
        >
          <div>Full reset — clear everything</div>
          <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.7, marginTop: 3 }}>Removes players, scores, and all history</div>
        </button>
        <button
          className="bp-btn"
          onClick={() => setShowResetMenu(false)}
          style={{ width: '100%', padding: '14px', borderRadius: 14, border: '1px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  ) : null;

  // ── SETUP ─────────────────────────────────────────────────────────────────
  if (state.view === 'setup') {
    const activeCt = state.players.filter(p => p.status === 'active').length;
    const restingCt = state.players.length - activeCt;
    return (
      <>
      <div className="bp-app">
        <style>{CSS_INJECT}</style>
        <Hdr
          sub="Session setup"
          right={
            <>
              <BtnDanger onClick={() => setShowResetMenu(true)}>Reset</BtnDanger>
              <BtnSec onClick={loadDemo}>Demo</BtnSec>
            </>
          }
        />
        <div style={WRAP}>
          <div style={CARD}>
            <span style={LBL}>Session settings</span>
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    marginBottom: 8,
                    fontWeight: 500,
                  }}
                >
                  Courts
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    className="bp-btn"
                    onClick={() => dispatch({ type: 'SET_S', k: 'courts', v: Math.max(1, state.settings.courts - 1) })}
                    style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', fontSize: 20, fontWeight: 600, cursor: 'pointer', lineHeight: 1 }}
                  >−</button>
                  <div style={{ textAlign: 'center', minWidth: 52 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: AMB, lineHeight: 1 }}>{state.settings.courts}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                      court{state.settings.courts !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button
                    className="bp-btn"
                    onClick={() => dispatch({ type: 'SET_S', k: 'courts', v: Math.min(3, state.settings.courts + 1) })}
                    style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', fontSize: 20, fontWeight: 600, cursor: 'pointer', lineHeight: 1 }}
                  >+</button>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    marginBottom: 8,
                    fontWeight: 500,
                  }}
                >
                  Score target
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <ToggleBtn
                    selected={state.settings.scoreTarget === 15}
                    onClick={() =>
                      dispatch({ type: 'SET_S', k: 'scoreTarget', v: 15 })
                    }
                  >
                    15 pts
                  </ToggleBtn>
                  <ToggleBtn
                    selected={state.settings.scoreTarget === 21}
                    onClick={() =>
                      dispatch({ type: 'SET_S', k: 'scoreTarget', v: 21 })
                    }
                  >
                    21 pts
                  </ToggleBtn>
                </div>
              </div>
            </div>
          </div>

          <div style={CARD}>
            <span style={LBL}>Add players</span>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                style={{ ...INP, flex: 1 }}
                placeholder="Player name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
              <button
                className="bp-btn"
                onClick={addPlayer}
                style={{
                  padding: '10px 20px',
                  borderRadius: 9,
                  border: 'none',
                  background: AMB,
                  color: '#000',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                Add
              </button>
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                marginBottom: 10,
                fontWeight: 500,
              }}
            >
              Skill level
            </div>
            <SkillPicker value={newSkill} onChange={setNewSkill} />
          </div>

          {state.players.length > 0 && (
            <div style={CARD}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 14,
                }}
              >
                <span style={{ ...LBL, marginBottom: 0 }}>
                  {state.players.length} player
                  {state.players.length !== 1 ? 's' : ''}
                  {restingCt > 0 && (
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11, color: AMB }}>
                      {' '}({restingCt} resting)
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: activeCt >= 4 ? GRN : AMB,
                  }}
                >
                  {activeCt >= 4
                    ? '✓ Ready'
                    : `${4 - activeCt} more needed`}
                </span>
              </div>
              {state.players.map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    padding: '11px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--color-border-tertiary)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        color: 'var(--color-text-primary)',
                        opacity: p.status === 'resting' ? 0.45 : 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginRight: 8,
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ display: 'flex', gap: 2 }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            className="bp-btn"
                            onClick={() => dispatch({ type: 'UPD_P', id: p.id, u: { skill: n } })}
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 6,
                              border: 'none',
                              cursor: 'pointer',
                              background: n <= p.skill ? AMB : 'var(--color-background-secondary)',
                              color: n <= p.skill ? '#000' : 'var(--color-text-secondary)',
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <button
                        className="bp-btn"
                        onClick={() => dispatch({ type: 'UPD_P', id: p.id, u: { status: p.status === 'resting' ? 'active' : 'resting' } })}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 7,
                          border: p.status === 'resting' ? `1.5px solid ${AMB}` : '1px solid var(--color-border-secondary)',
                          background: p.status === 'resting' ? `rgba(245,158,11,0.15)` : 'var(--color-background-secondary)',
                          color: p.status === 'resting' ? AMB : 'var(--color-text-secondary)',
                          fontWeight: 600,
                          fontSize: 11,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.status === 'resting' ? 'Resting' : 'Rest'}
                      </button>
                      <BtnDanger
                        onClick={() => dispatch({ type: 'DEL_P', id: p.id })}
                        style={{ padding: '5px 9px', fontSize: 12 }}
                      >
                        ✕
                      </BtnDanger>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <SkillDots value={p.skill} />
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {SKILL_LABELS[p.skill]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {state.players.length >= 2 && (() => {
            const resetPairForm = () => { setPairFormA(''); setPairFormB(''); setPairFormFreq('alternate'); };
            const addPair = (type) => {
              if (!pairFormA || !pairFormB || pairFormA === pairFormB) return;
              const pair = type === 'ADD_PREF'
                ? { a: pairFormA, b: pairFormB, freq: pairFormFreq }
                : { a: pairFormA, b: pairFormB };
              dispatch({ type, pair });
              resetPairForm();
              setShowAddExcl(false);
              setShowAddPref(false);
            };
            const selectStyle = { ...INP, flex: 1, minWidth: 100, padding: '8px 10px', fontSize: 13 };
            const PairForm = ({ onAdd, onCancel, showFreq }) => (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={pairFormA} onChange={e => { setPairFormA(e.target.value); setPairFormB(''); }} style={selectStyle}>
                    <option value="">Player A</option>
                    {state.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select value={pairFormB} onChange={e => setPairFormB(e.target.value)} style={selectStyle}>
                    <option value="">Player B</option>
                    {state.players.filter(p => p.id !== pairFormA).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {showFreq && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    {[['alternate', 'Every other game'], ['occasional', 'Occasionally']].map(([val, label]) => (
                      <button key={val} className="bp-btn" onClick={() => setPairFormFreq(val)}
                        style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          background: pairFormFreq === val ? GRN : 'var(--color-background-secondary)',
                          color: pairFormFreq === val ? '#fff' : 'var(--color-text-secondary)',
                          boxShadow: pairFormFreq === val ? `0 0 0 2px ${GRN}` : '0 0 0 1px var(--color-border-tertiary)' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <BtnPrimary onClick={onAdd} style={{ padding: '8px 16px', fontSize: 13 }}>Add</BtnPrimary>
                  <BtnSec onClick={onCancel}>Cancel</BtnSec>
                </div>
              </div>
            );
            return (
              <div style={CARD}>
                <span style={LBL}>Pairings (optional)</span>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                    Never partner
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {state.exclusions.map(({ a, b }) => (
                      <span key={pk(a, b)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(220,38,38,0.08)', border: `1px solid rgba(220,38,38,0.25)`, borderRadius: 20, padding: '5px 10px', fontSize: 12, color: RED }}>
                        {pName(a)} × {pName(b)}
                        <button onClick={() => dispatch({ type: 'DEL_EXCL', key: pk(a, b) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
                      </span>
                    ))}
                    {!showAddExcl && (
                      <button className="bp-btn" onClick={() => { setShowAddExcl(true); setShowAddPref(false); resetPairForm(); }}
                        style={{ padding: '5px 12px', borderRadius: 20, border: '1px dashed var(--color-border-secondary)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 12, cursor: 'pointer' }}>
                        + Add pair
                      </button>
                    )}
                  </div>
                  {showAddExcl && <PairForm showFreq={false} onAdd={() => addPair('ADD_EXCL')} onCancel={() => { setShowAddExcl(false); resetPairForm(); }} />}
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                    Try to pair together
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {state.preferred.map(({ a, b, freq = 'alternate' }) => {
                      const key = pk(a, b);
                      const isOcc = freq === 'occasional';
                      return (
                        <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(5,150,105,0.08)', border: `1px solid rgba(5,150,105,0.25)`, borderRadius: 20, padding: '5px 10px', fontSize: 12, color: GRN }}>
                          {pName(a)} + {pName(b)}
                          <button
                            onClick={() => dispatch({ type: 'UPD_PREF', key, freq: isOcc ? 'alternate' : 'occasional' })}
                            title={isOcc ? 'Occasionally — tap to switch to every other game' : 'Every other game — tap to switch to occasionally'}
                            style={{ background: 'rgba(5,150,105,0.15)', border: `1px solid rgba(5,150,105,0.3)`, borderRadius: 10, cursor: 'pointer', color: GRN, fontSize: 10, fontWeight: 700, padding: '1px 6px', lineHeight: '16px', whiteSpace: 'nowrap' }}>
                            {isOcc ? 'occ.' : '~50%'}
                          </button>
                          <button onClick={() => dispatch({ type: 'DEL_PREF', key })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: GRN, fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
                        </span>
                      );
                    })}
                    {!showAddPref && (
                      <button className="bp-btn" onClick={() => { setShowAddPref(true); setShowAddExcl(false); resetPairForm(); }}
                        style={{ padding: '5px 12px', borderRadius: 20, border: '1px dashed var(--color-border-secondary)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 12, cursor: 'pointer' }}>
                        + Add pair
                      </button>
                    )}
                  </div>
                  {showAddPref && <PairForm showFreq={true} onAdd={() => addPair('ADD_PREF')} onCancel={() => { setShowAddPref(false); resetPairForm(); }} />}
                </div>
              </div>
            );
          })()}

          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
            Auto-saved in this browser — data survives refreshes and new tabs.
            Only clears when you tap Reset Session or clear browser storage.
          </div>
          {activeCt >= 4 ? (
            <BtnPrimary onClick={() => dispatch({ type: 'START' })}>
              Start session →
            </BtnPrimary>
          ) : (
            <div
              style={{
                ...CARD,
                textAlign: 'center',
                color: 'var(--color-text-secondary)',
                fontSize: 14,
                padding: '22px 20px',
              }}
            >
              {state.players.length === 0
                ? 'Add at least 4 players to start'
                : activeCt === 0
                  ? 'All players are resting — un-rest at least 4 to start'
                  : `${4 - activeCt} more active player${4 - activeCt !== 1 ? 's' : ''} needed`}
            </div>
          )}
        </div>
      </div>
      {resetBottomSheet}
      </>
    );
  }

  // ── SESSION ───────────────────────────────────────────────────────────────
  if (state.view === 'session')
    return (
      <>
      <div className="bp-app">
        <style>{CSS_INJECT}</style>
        <Hdr
          sub={`Round ${state.roundNumber}`}
          right={
            <>
              <BtnSec onClick={() => dispatch({ type: 'BACK_TO_SETUP' })}>
                ← Players
              </BtnSec>
              <BtnSec onClick={() => dispatch({ type: 'SUMMARY' })}>
                Stats
              </BtnSec>
              <BtnDanger onClick={() => setShowResetMenu(true)}>
                Reset
              </BtnDanger>
            </>
          }
        />
        <div style={WRAP}>
          <div style={CARD}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <span style={{ ...LBL, marginBottom: 0 }}>Players</span>
              <span
                style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}
              >
                {state.currentRound ? 'Tap to rest — clears current pairing' : 'Tap to mark resting'}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {state.players.map((p) => {
                const isR = p.status === 'resting';
                return (
                  <button
                    key={p.id}
                    className="bp-btn"
                    onClick={() =>
                      dispatch({
                        type: 'UPD_P',
                        id: p.id,
                        u: { status: isR ? 'active' : 'resting' },
                      })
                    }
                    style={{
                      padding: '8px 14px',
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      border: 'none',
                      background: isR
                        ? 'rgba(245,158,11,0.15)'
                        : 'var(--color-background-secondary)',
                      color: isR ? AMB : 'var(--color-text-primary)',
                      boxShadow: isR
                        ? `0 0 0 1.5px ${AMB}`
                        : '0 0 0 1px var(--color-border-tertiary)',
                    }}
                  >
                    {isR ? '😴 ' : ''}
                    {p.name}
                    {p.gamesPlayed > 0 && (
                      <span
                        style={{ marginLeft: 5, fontSize: 11, opacity: 0.6 }}
                      >
                        ×{p.gamesPlayed}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {state.note && (
            <div
              style={{
                background: 'rgba(245,158,11,0.1)',
                color: '#92400E',
                borderRadius: 10,
                padding: '11px 16px',
                fontSize: 13,
                marginBottom: 14,
                border: '1px solid rgba(245,158,11,0.3)',
              }}
            >
              ⚠ {state.note}
            </div>
          )}
          {genErr && (
            <div
              style={{
                color: RED,
                fontSize: 13,
                marginBottom: 14,
                padding: '10px 14px',
                background: 'rgba(220,38,38,0.08)',
                borderRadius: 10,
                border: `1px solid rgba(220,38,38,0.2)`,
              }}
            >
              ⚠ {genErr}
            </div>
          )}

          {!state.currentRound ? (
            <BtnPrimary onClick={handleGenerate}>
              ⚡ Generate Round {state.roundNumber}
            </BtnPrimary>
          ) : (
            <>
              {state.currentRound.courts.map((court, ci) => (
                <CourtCard key={ci} court={court} pName={pName} idx={ci} />
              ))}

              {state.currentRound.sittingIds.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <span style={LBL}>Sitting this round</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {state.currentRound.sittingIds.map((id) => (
                      <span
                        key={id}
                        style={{
                          background: 'var(--color-background-secondary)',
                          border: '1px solid var(--color-border-tertiary)',
                          color: 'var(--color-text-secondary)',
                          padding: '6px 13px',
                          borderRadius: 20,
                          fontSize: 13,
                        }}
                      >
                        {pName(id)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div
                style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 12 }}
              >
                {state.currentRound.explanations.map((e, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'inline-block',
                      padding: '5px 11px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                      marginRight: 6,
                      marginBottom: 6,
                      background: e.ok
                        ? 'rgba(5,150,105,0.1)'
                        : 'rgba(245,158,11,0.1)',
                      color: e.ok ? GRN : '#92400E',
                      border: `1px solid ${e.ok ? 'rgba(5,150,105,0.3)' : 'rgba(245,158,11,0.3)'}`,
                    }}
                  >
                    {e.ok ? '✓' : '↻'} {e.text}
                  </span>
                ))}
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  textAlign: 'center',
                  marginBottom: 14,
                }}
              >
                Option {state.regenIdx + 1} of {state.ranked.length}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <BtnSec
                  onClick={() => dispatch({ type: 'REGEN' })}
                  style={{ flex: 1 }}
                >
                  ↻ Try another
                </BtnSec>
                <button
                  className="bp-btn"
                  onClick={() => dispatch({ type: 'SCORE_VIEW' })}
                  style={{
                    flex: 2,
                    background: AMB,
                    color: '#000',
                    padding: '12px 20px',
                    borderRadius: 10,
                    border: 'none',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Enter scores →
                </button>
              </div>
            </>
          )}
        </div>
      </div>  {/* end bp-app */}

      {resetBottomSheet}
      </>
    );

  // ── SCORE ENTRY ────────────────────────────────────────────────────────────
  if (state.view === 'score')
    return (
      <>
      <div className="bp-app">
        <style>{CSS_INJECT}</style>
        <Hdr
          sub={`Round ${state.roundNumber} — enter results`}
          right={
            <>
              <BtnSec onClick={() => dispatch({ type: 'BACK' })}>← Back</BtnSec>
              <BtnDanger onClick={() => setShowResetMenu(true)}>Reset</BtnDanger>
            </>
          }
        />
        <div style={WRAP}>
          {state.currentRound?.courts.map((court, i) => {
            const t1 = parseInt(state.pendingScores[i]?.t1) || 0;
            const t2 = parseInt(state.pendingScores[i]?.t2) || 0;
            const hasScores =
              state.pendingScores[i]?.t1 || state.pendingScores[i]?.t2;
            const leading =
              hasScores && t1 !== t2
                ? t1 > t2
                  ? court.team1.map(pName).join(' + ')
                  : court.team2.map(pName).join(' + ')
                : null;
            return (
              <div key={i} style={CARD}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    color: GRN,
                    marginBottom: 16,
                  }}
                >
                  Court {i + 1}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 10,
                      }}
                    >
                      {court.team1.map(pName).join(' + ')}
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      style={{
                        ...INP,
                        fontSize: 32,
                        fontWeight: 600,
                        textAlign: 'center',
                        padding: '12px 8px',
                      }}
                      value={state.pendingScores[i]?.t1 ?? ''}
                      onChange={(e) =>
                        dispatch({
                          type: 'SET_SC',
                          i,
                          k: 't1',
                          v: e.target.value,
                        })
                      }
                      placeholder="0"
                    />
                  </div>
                  <div
                    style={{
                      color: 'var(--color-text-secondary)',
                      fontWeight: 600,
                      fontSize: 18,
                      paddingTop: 28,
                    }}
                  >
                    vs
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 10,
                        textAlign: 'right',
                      }}
                    >
                      {court.team2.map(pName).join(' + ')}
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      style={{
                        ...INP,
                        fontSize: 32,
                        fontWeight: 600,
                        textAlign: 'center',
                        padding: '12px 8px',
                      }}
                      value={state.pendingScores[i]?.t2 ?? ''}
                      onChange={(e) =>
                        dispatch({
                          type: 'SET_SC',
                          i,
                          k: 't2',
                          v: e.target.value,
                        })
                      }
                      placeholder="0"
                    />
                  </div>
                </div>
                {leading && (
                  <div
                    style={{
                      textAlign: 'center',
                      marginTop: 12,
                      fontSize: 13,
                      fontWeight: 500,
                      color: GRN,
                    }}
                  >
                    ↑ {leading} leading
                  </div>
                )}
                {(() => {
                  const warn = getScoreWarning(
                    state.pendingScores[i]?.t1,
                    state.pendingScores[i]?.t2,
                    state.settings.scoreTarget,
                  );
                  return warn ? (
                    <div style={{
                      textAlign: 'center',
                      marginTop: 10,
                      fontSize: 12,
                      color: '#92400E',
                      background: 'rgba(245,158,11,0.1)',
                      border: '1px solid rgba(245,158,11,0.25)',
                      borderRadius: 8,
                      padding: '7px 12px',
                    }}>
                      {warn}
                    </div>
                  ) : null;
                })()}
              </div>
            );
          })}
          <BtnPrimary onClick={() => dispatch({ type: 'SUBMIT' })}>
            ✓ Submit & go to round {state.roundNumber + 1}
          </BtnPrimary>
        </div>
      </div>
      {resetBottomSheet}
      </>
    );

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  if (state.view === 'summary') {
    const sorted = [...state.players].sort((a, b) => {
      const aWinPct = a.gamesPlayed ? a.wins / a.gamesPlayed : 0;
      const bWinPct = b.gamesPlayed ? b.wins / b.gamesPlayed : 0;
      return bWinPct - aWinPct;
    });
    const totalRounds = state.roundNumber - 1;
    const byRound = state.matchHistory.reduce((acc, m) => {
      (acc[m.roundNumber] ??= []).push(m);
      return acc;
    }, {});
    const roundNums = Object.keys(byRound).map(Number).sort((a, b) => b - a);
    const TH = {
      padding: '0 6px 10px',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.8px',
      textTransform: 'uppercase',
      color: 'var(--color-text-secondary)',
      borderBottom: '2px solid var(--color-border-secondary)',
      whiteSpace: 'nowrap',
      textAlign: 'center',
    };
    const TD = {
      padding: '11px 6px',
      borderBottom: '1px solid var(--color-border-tertiary)',
      textAlign: 'center',
    };
    return (
      <>
      <div className="bp-app">
        <style>{CSS_INJECT}</style>
        <Hdr
          sub="Session summary"
          right={
            <>
              <BtnSec onClick={() => dispatch({ type: 'BACK' })}>← Back</BtnSec>
              <BtnDanger onClick={() => setShowResetMenu(true)}>Reset</BtnDanger>
            </>
          }
        />
        <div style={WRAP}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            {[
              ['Rounds', totalRounds],
              ['Matches', state.matchHistory.length],
              ['Players', state.players.length],
            ].map(([label, val]) => (
              <div
                key={label}
                style={{ flex: 1, background: 'var(--color-background-secondary)', borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}
              >
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-text-primary)' }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={CARD}>
            <span style={LBL}>Player standings</span>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...TH, textAlign: 'left', padding: '0 8px 10px 0' }}>Player</th>
                    <th style={TH}>W</th>
                    <th style={TH}>L</th>
                    <th style={TH}>Win%</th>
                    <th style={TH}>Pts</th>
                    <th style={{ ...TH, padding: '0 0 10px 6px' }}>Sit</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, idx) => (
                    <tr key={p.id}>
                      <td style={{ ...TD, textAlign: 'left', padding: '11px 8px 11px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: idx === 0 ? AMB : 'var(--color-text-secondary)', minWidth: 22 }}>#{idx + 1}</span>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.2, fontSize: 14 }}>{p.name}</div>
                            <SkillDots value={p.skill} size={7} />
                          </div>
                        </div>
                      </td>
                      <td style={{ ...TD, fontWeight: 700, color: GRN }}>{p.wins}</td>
                      <td style={{ ...TD, fontWeight: 700, color: p.losses > 0 ? RED : 'var(--color-text-secondary)' }}>{p.losses}</td>
                      <td style={TD}>{p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0}%</td>
                      <td style={{ ...TD, fontSize: 12, whiteSpace: 'nowrap' }}>
                        <span style={{ color: GRN, fontWeight: 500 }}>{p.pointsScored}</span>
                        <span style={{ opacity: 0.4, margin: '0 2px' }}>–</span>
                        <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{p.pointsConceded}</span>
                      </td>
                      <td style={{ ...TD, padding: '11px 0 11px 6px', color: 'var(--color-text-secondary)' }}>{p.sitOutCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {roundNums.length > 0 && (
            <div style={CARD}>
              <span style={LBL}>Match history</span>
              {roundNums.map((rn, ri) => (
                <div key={rn} style={{ marginBottom: ri < roundNums.length - 1 ? 20 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--color-text-secondary)', paddingBottom: 8, borderBottom: '1.5px solid var(--color-border-secondary)', marginBottom: 2 }}>
                    Round {rn}
                  </div>
                  {byRound[rn].map((m) => {
                    const t1won = m.winner === 'team1', t2won = m.winner === 'team2';
                    return (
                      <div key={m.matchId} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border-tertiary)' }}>
                        {byRound[rn].length > 1 && (
                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 5, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                            Court {m.courtNumber}
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: t1won ? 700 : 400, color: t1won ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.3 }}>
                              {m.team1.map(pName).join(' + ')}
                            </div>
                            {t1won && <div style={{ fontSize: 10, color: GRN, fontWeight: 600, marginTop: 2 }}>Winner</div>}
                          </div>
                          <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, color: AMB, minWidth: 48, padding: '0 4px' }}>
                            {m.team1Score}–{m.team2Score}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: t2won ? 700 : 400, color: t2won ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.3 }}>
                              {m.team2.map(pName).join(' + ')}
                            </div>
                            {t2won && <div style={{ fontSize: 10, color: GRN, fontWeight: 600, marginTop: 2, textAlign: 'right' }}>Winner</div>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {resetBottomSheet}
      </>
    );
  }

  return null;
}

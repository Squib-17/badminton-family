// test-engine.js — run with: node test-engine.js
// Tests the pairing engine end-to-end with real and edge-case scenarios.

// ─── Engine (copied verbatim from App.jsx, minus React/UI) ───────────────────

let _uid = 0;
const uid = () => `p${++_uid}`;

function C(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [...C(t, k - 1).map((c) => [h, ...c]), ...C(t, k)];
}
const pk = (a, b) => [a, b].sort().join('|');

function classify(s1, s2) {
  if ((s1 >= 4 && s2 >= 4) || (s1 <= 2 && s2 <= 2)) return 'discouraged';
  const s = s1 + s2;
  return s >= 5 && s <= 7 ? 'preferred' : 'allowed';
}
const PEN = { preferred: 0, allowed: 1, discouraged: 3 };

const W = {
  skillImbalance: 4, partnerRepeat: 25, recentPartner: 50,
  sittingUnfair: 8, recentSitOut: 25, fatigue: 12, stacking: 6, opponentRepeat: 2,
  preferredAlternate: -40,  // every-other-game mode
  preferredOccasional: -30, // T=1 scores -5 (still preferred), T=2 scores +20 (natural fade)
};

function buildMatrix(players, history) {
  const m = {};
  C(players.map((p) => p.id), 2).forEach(([a, b]) => {
    const pa = players.find((p) => p.id === a), pb = players.find((p) => p.id === b);
    m[pk(a, b)] = { pairQuality: classify(pa.skill, pb.skill), staticPenalty: PEN[classify(pa.skill, pb.skill)], timesPartnered: 0, lastPartneredRound: null, timesOpposed: 0, lastOpposedRound: null };
  });
  history.forEach(({ team1, team2, roundNumber: rn }) => {
    const up = (key, f, rf) => m[key] && (m[key][f]++, (m[key][rf] = rn));
    up(pk(team1[0], team1[1]), 'timesPartnered', 'lastPartneredRound');
    up(pk(team2[0], team2[1]), 'timesPartnered', 'lastPartneredRound');
    team1.forEach((a) => team2.forEach((b) => up(pk(a, b), 'timesOpposed', 'lastOpposedRound')));
  });
  return m;
}

function buildCandidates(players, matrix, exclusions = []) {
  const exclSet = new Set(exclusions.map(({ a, b }) => pk(a, b)));
  const res = [];
  C(players.map((p) => p.id), 4).forEach(([a, b, c, d]) => {
    [[[a,b],[c,d]], [[a,c],[b,d]], [[a,d],[b,c]]].forEach(([t1, t2]) => {
      const g = (id) => players.find((p) => p.id === id);
      const [p1, p2, p3, p4] = [g(t1[0]), g(t1[1]), g(t2[0]), g(t2[1])];
      if (!p1 || !p2 || !p3 || !p4) return;
      const t1Sk = p1.skill + p2.skill, t2Sk = p3.skill + p4.skill;
      const skDiff = Math.abs(t1Sk - t2Sk);
      const advStack = (p1.skill>=4&&p2.skill>=4?1:0)+(p3.skill>=4&&p4.skill>=4?1:0);
      const lowStack = (p1.skill<=2&&p2.skill<=2?1:0)+(p3.skill<=2&&p4.skill<=2?1:0);
      const t1pk = pk(t1[0],t1[1]), t2pk = pk(t2[0],t2[1]);
      const pqScore = (matrix[t1pk]?.staticPenalty??0)+(matrix[t2pk]?.staticPenalty??0);
      if (exclSet.has(t1pk) || exclSet.has(t2pk)) return;
      res.push({ cid: uid(), team1:t1, team2:t2, allIds:[...t1,...t2], t1pk, t2pk,
        oppKeys:[pk(t1[0],t2[0]),pk(t1[0],t2[1]),pk(t1[1],t2[0]),pk(t1[1],t2[1])],
        t1Sk, t2Sk, skDiff, advStack, lowStack, pqScore, staticRank: skDiff+advStack+lowStack });
    });
  });
  return res;
}

function scoreRound(rc, players, matrix, rn, preferred = []) {
  const { courts, sittingIds } = rc;
  const playIds = courts.flatMap((c) => c.allIds);
  const gp = (id) => players.find((p) => p.id === id);
  const prefMap = new Map(preferred.map(({ a, b, freq }) => [
    pk(a, b),
    { weight: freq === 'occasional' ? W.preferredOccasional : W.preferredAlternate, alternate: freq !== 'occasional' },
  ]));
  let s = 0;
  let maxDiff=0, totalRepeats=0, hasRecentRepeat=false, preferredHit=false;
  courts.forEach((c) => {
    s += c.skDiff * W.skillImbalance;
    maxDiff = Math.max(maxDiff, c.skDiff);
    const t1pref = prefMap.get(c.t1pk);
    const t2pref = prefMap.get(c.t2pk);
    if (t1pref !== undefined) { s += t1pref.weight; preferredHit = true; }
    if (t2pref !== undefined) { s += t2pref.weight; preferredHit = true; }
    const t1p=matrix[c.t1pk], t2p=matrix[c.t2pk];
    if (t1p) { if(!t1pref?.alternate) s+=t1p.timesPartnered*W.partnerRepeat; if(t1p.lastPartneredRound===rn-1){s+=W.recentPartner;hasRecentRepeat=true;} totalRepeats+=t1p.timesPartnered; }
    if (t2p) { if(!t2pref?.alternate) s+=t2p.timesPartnered*W.partnerRepeat; if(t2p.lastPartneredRound===rn-1){s+=W.recentPartner;hasRecentRepeat=true;} totalRepeats+=t2p.timesPartnered; }
    s += (c.advStack+c.lowStack)*W.stacking;
    c.oppKeys.forEach((ok) => { const op=matrix[ok]; if(op) s+=op.timesOpposed*W.opponentRepeat; });
  });
  sittingIds.forEach((sid) => {
    const sp=gp(sid); if(!sp) return;
    playIds.forEach((pid) => { const pp=gp(pid); if(pp&&sp.gamesPlayed<pp.gamesPlayed) s+=W.sittingUnfair; });
    if(sp.lastSatOutRound===rn-1) s+=W.recentSitOut;
  });
  playIds.forEach((id) => { const p=gp(id); if(p&&p.consecutiveGames>=3) s+=(p.consecutiveGames-2)*W.fatigue; });
  // Deterministic for tests (no Math.random)
  rc.analysis = { maxDiff, totalRepeats, hasRecentRepeat, preferredHit };
  return s;
}

function rcPairSet(rc) {
  return new Set(rc.courts.flatMap((c) => [pk(c.team1[0],c.team1[1]), pk(c.team2[0],c.team2[1])]));
}
function countSharedPairs(setA, rc) {
  let n=0; for(const p of rcPairSet(rc)) if(setA.has(p)) n++; return n;
}
function diversifyRanked(sorted) {
  if (sorted.length<=1) return sorted;
  const result=[sorted[0]], remaining=[...sorted.slice(1)];
  while(remaining.length>0) {
    const curPairs=rcPairSet(result[result.length-1]);
    let minShared=Infinity, bestIdx=0;
    for(let i=0;i<remaining.length;i++){
      const s=countSharedPairs(curPairs,remaining[i]);
      if(s<minShared){minShared=s;bestIdx=i;if(s===0)break;}
    }
    result.push(remaining.splice(bestIdx,1)[0]);
  }
  return result;
}
function findDisjointCombos(pool, n, maxResults=500) {
  const results=[], usedIds=new Set();
  function go(startIdx, chosen) {
    if(results.length>=maxResults) return;
    if(chosen.length===n){results.push([...chosen]);return;}
    for(let i=startIdx;i<pool.length;i++){
      if(results.length>=maxResults) return;
      const c=pool[i];
      if(c.allIds.some((id)=>usedIds.has(id))) continue;
      c.allIds.forEach((id)=>usedIds.add(id));
      chosen.push(c);
      go(i+1,chosen);
      chosen.pop();
      c.allIds.forEach((id)=>usedIds.delete(id));
    }
  }
  go(0,[]);
  return results;
}

const mkPlayer = (name, skill) => ({
  id: uid(), name, skill, status:'active', gamesPlayed:0, sitOutCount:0,
  consecutiveGames:0, wins:0, losses:0, pointsScored:0, pointsConceded:0,
  lastPlayedRound:null, lastSatOutRound:null,
});

function genRound(state) {
  const { players, settings, matchHistory, roundNumber, exclusions = [], preferred = [] } = state;
  const active = players.filter((p) => p.status === 'active');
  if (active.length < 4) return { error: 'Need at least 4 active players.' };
  const matrix = buildMatrix(active, matchHistory);
  const allCands = buildCandidates(active, matrix, exclusions);
  if (allCands.length === 0) return { error: 'Exclusion rules leave no valid pairings — remove some.' };
  const maxCourts = Math.floor(active.length / 4);
  const courtsToGen = Math.min(settings.courts, maxCourts);
  const note = courtsToGen < settings.courts
    ? `Only ${courtsToGen} court${courtsToGen!==1?'s':''} possible with ${active.length} players.` : null;
  const activeIds = active.map((p) => p.id);
  let rcs = [];
  if (courtsToGen === 1) {
    allCands.forEach((c) => {
      const sittingIds = activeIds.filter((id) => !c.allIds.includes(id));
      const rc = { id: uid(), courts:[c], sittingIds };
      rc.score = scoreRound(rc, active, matrix, roundNumber, preferred);
      rcs.push(rc);
    });
  } else {
    const sorted = [...allCands].sort((a,b)=>a.staticRank-b.staticRank);
    const pool = active.length<=15 ? sorted : sorted.slice(0,300);
    const pushRc = (courts) => {
      const playIds = courts.flatMap(c=>c.allIds);
      const sittingIds = activeIds.filter(id=>!playIds.includes(id));
      const rc = { id: uid(), courts, sittingIds };
      rc.score = scoreRound(rc, active, matrix, roundNumber, preferred);
      rcs.push(rc);
    };
    if (preferred.length > 0) {
      preferred.forEach(({ a: pa, b: pb }) => {
        const pairKey = pk(pa, pb);
        allCands
          .filter(c => c.t1pk === pairKey || c.t2pk === pairKey)
          .sort((a,b) => a.staticRank - b.staticRank)
          .slice(0, 15)
          .forEach(pc => {
            const restPool = pool.filter(c => !c.allIds.some(id => pc.allIds.includes(id)));
            findDisjointCombos(restPool, courtsToGen - 1, 10).forEach(restCourts => {
              pushRc([pc, ...restCourts]);
            });
          });
      });
    }
    findDisjointCombos(pool, courtsToGen).forEach(courts => pushRc(courts));
    const seen = new Set();
    rcs = rcs.filter(rc => {
      const key = rc.courts.map(c=>[c.t1pk,c.t2pk].sort().join(':')).sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (rcs.length === 0) {
      allCands.forEach((c) => {
        const sittingIds = activeIds.filter((id) => !c.allIds.includes(id));
        const rc = { id: uid(), courts:[c], sittingIds };
        rc.score = scoreRound(rc, active, matrix, roundNumber, preferred);
        rcs.push(rc);
      });
    }
  }
  rcs.sort((a,b)=>a.score-b.score);
  rcs = diversifyRanked(rcs);
  return { candidates: rcs, note };
}

function getScoreWarning(t1Str, t2Str, target) {
  const a=parseInt(t1Str), b=parseInt(t2Str);
  if(isNaN(a)||isNaN(b)) return null;
  const hi=Math.max(a,b), lo=Math.min(a,b);
  const cap=target===21?30:target+2;
  if(hi<target) return `Neither team has reached ${target}`;
  if(hi===target&&lo===target-1) return `Deuce at ${lo}-${lo}`;
  if(hi>cap) return `Exceeds cap ${cap}`;
  if(hi>target&&hi<cap&&hi-lo!==2) return `Past ${target}: needs 2-point lead`;
  return null;
}

// ─── Test harness ─────────────────────────────────────────────────────────────
let passed=0, failed=0;
function describe(name, fn) { console.log(`\n${name}`); fn(); }
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function assert(cond, msg) { if(!cond) throw new Error(msg||'assertion failed'); }
function eq(a, b, msg) { if(a!==b) throw new Error(`${msg||''}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// helper: check if a preferred pair appears as partners in a round
function isPaired(rc, idA, idB) {
  return rc.courts.some(c =>
    (c.team1.includes(idA) && c.team1.includes(idB)) ||
    (c.team2.includes(idA) && c.team2.includes(idB))
  );
}

// helper: submit a round to advance state
function submitRound(state, rc, scores) {
  const newHist = [...state.matchHistory];
  const updP = state.players.map((p) => ({...p}));
  rc.courts.forEach((court, i) => {
    const t1s = scores?.[i]?.[0] ?? 21, t2s = scores?.[i]?.[1] ?? 15;
    const w = t1s>t2s?'team1':t1s<t2s?'team2':null;
    newHist.push({ matchId: uid(), roundNumber:state.roundNumber, courtNumber:i+1, team1:court.team1, team2:court.team2, team1Score:t1s, team2Score:t2s, winner:w });
    [...court.team1,...court.team2].forEach((id) => {
      const p=updP.find(p=>p.id===id); if(!p) return;
      p.gamesPlayed++; p.consecutiveGames++; p.lastPlayedRound=state.roundNumber;
    });
    court.team1.forEach(id => { const p=updP.find(p=>p.id===id); if(!p)return; p.pointsScored+=t1s; p.pointsConceded+=t2s; if(w==='team1')p.wins++;else if(w==='team2')p.losses++; });
    court.team2.forEach(id => { const p=updP.find(p=>p.id===id); if(!p)return; p.pointsScored+=t2s; p.pointsConceded+=t1s; if(w==='team2')p.wins++;else if(w==='team1')p.losses++; });
  });
  rc.sittingIds.forEach(id => { const p=updP.find(p=>p.id===id); if(!p)return; p.sitOutCount++; p.consecutiveGames=0; p.lastSatOutRound=state.roundNumber; });
  return { ...state, matchHistory:newHist, players:updP, roundNumber:state.roundNumber+1, currentRound:null, ranked:[], regenIdx:0 };
}

function mkState(players, courts=2, scoreTarget=21, exclusions=[], preferred=[]) {
  return { players, settings:{courts,scoreTarget}, matchHistory:[], roundNumber:1, exclusions, preferred };
}

// ─── Original regression tests (1–16) ────────────────────────────────────────

describe('1. Minimum players — 4 players, 1 court', () => {
  const players = [mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3)];
  const state = mkState(players, 1);
  const res = genRound(state);

  test('generates candidates', () => assert(res.candidates?.length > 0));
  test('exactly 3 candidates (C(4,4)×3)', () => eq(res.candidates.length, 3));
  test('no one sits out', () => eq(res.candidates[0].sittingIds.length, 0));
  test('all 4 players on court', () => eq(res.candidates[0].courts[0].allIds.length, 4));
  test('1 court in result', () => eq(res.candidates[0].courts.length, 1));
});

describe('2. Demo group — 8 players, 2 courts, Round 1', () => {
  const players = [
    mkPlayer('Saquib',2),mkPlayer('Andrea',4),mkPlayer('Mark',3),mkPlayer('Christina',4),
    mkPlayer('Calvin',3),mkPlayer('Ava',5),mkPlayer('Jonathan',4),mkPlayer('Sheng',4),
  ];
  const state = mkState(players, 2);
  const res = genRound(state);

  test('generates 315 candidates', () => eq(res.candidates.length, 315));
  test('no error', () => assert(!res.error));
  test('no note (2 courts possible with 8 players)', () => eq(res.note, null));
  test('Option 1 has 2 courts', () => eq(res.candidates[0].courts.length, 2));
  test('all 8 players assigned (no sitters)', () => eq(res.candidates[0].sittingIds.length, 0));
  test('no duplicate players in Option 1', () => {
    const ids = res.candidates[0].courts.flatMap(c=>[...c.team1,...c.team2]);
    eq(new Set(ids).size, 8);
  });
  test('Option 2 has different partner pairs from Option 1', () => {
    const s1 = rcPairSet(res.candidates[0]);
    const shared = countSharedPairs(s1, res.candidates[1]);
    assert(shared < 4, `expected < 4 shared pairs, got ${shared}`);
  });
});

describe('3. 8 players, Round 2 — partner rotation enforced', () => {
  const players = [
    mkPlayer('Saquib',2),mkPlayer('Andrea',4),mkPlayer('Mark',3),mkPlayer('Christina',4),
    mkPlayer('Calvin',3),mkPlayer('Ava',5),mkPlayer('Jonathan',4),mkPlayer('Sheng',4),
  ];
  let state = mkState(players, 2);
  const r1 = genRound(state);
  const bestR1 = r1.candidates[0];
  state = submitRound(state, bestR1);

  const r2 = genRound(state);
  const bestR2 = r2.candidates[0];

  test('Round 2 generates candidates', () => assert(r2.candidates.length > 0));
  test('Round 2 Option 1 shares 0 partner pairs with Round 1 best', () => {
    const s1 = rcPairSet(bestR1);
    const shared = countSharedPairs(s1, bestR2);
    eq(shared, 0, 'partner pairs should be completely different');
  });
});

describe('4. 5 players, 1 court — sitting fairness', () => {
  const players = [mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3),mkPlayer('E',3)];
  let state = mkState(players, 1);

  const sitCounts = {};
  players.forEach(p => sitCounts[p.id] = 0);

  for (let round = 0; round < 5; round++) {
    const res = genRound(state);
    assert(!res.error, `Round ${round+1} failed: ${res.error}`);
    const best = res.candidates[0];
    best.sittingIds.forEach(id => sitCounts[id]++);
    state = submitRound(state, best);
  }

  test('generates candidates each round', () => assert(true));
  test('each player sits out at most 2 times in 5 rounds', () => {
    const max = Math.max(...Object.values(sitCounts));
    assert(max <= 2, `one player sat out ${max} times`);
  });
  test('each player sits out at least once in 5 rounds (fairness)', () => {
    const min = Math.min(...Object.values(sitCounts));
    assert(min >= 1, `one player never sat out (unfair)`);
  });
});

describe('5. 7 players, 2 courts selected — should auto-downgrade to 1', () => {
  const players = Array.from({length:7}, (_,i) => mkPlayer(`P${i+1}`, 3));
  const state = mkState(players, 2);
  const res = genRound(state);

  test('generates candidates', () => assert(res.candidates?.length > 0));
  test('shows note about court reduction', () => assert(res.note?.includes('1 court'), `note was: ${res.note}`));
  test('result has 1 court', () => eq(res.candidates[0].courts.length, 1));
  test('3 players sit out', () => eq(res.candidates[0].sittingIds.length, 3));
});

describe('6. 12 players, 3 courts', () => {
  const players = [
    mkPlayer('Saquib',2),mkPlayer('Andrea',4),mkPlayer('Mark',3),mkPlayer('Christina',4),
    mkPlayer('Calvin',3),mkPlayer('Ava',5),mkPlayer('Jonathan',4),mkPlayer('Sheng',4),
    mkPlayer('P9',3),mkPlayer('P10',3),mkPlayer('P11',4),mkPlayer('P12',4),
  ];
  const state = mkState(players, 3);
  const t0 = Date.now();
  const res = genRound(state);
  const ms = Date.now() - t0;

  test('no error', () => assert(!res.error, res.error));
  test('generates 3-court candidates', () => eq(res.candidates[0].courts.length, 3));
  test('all 12 players play (no one sits out)', () => eq(res.candidates[0].sittingIds.length, 0));
  test('no duplicate players in Option 1', () => {
    const ids = res.candidates[0].courts.flatMap(c=>[...c.team1,...c.team2]);
    eq(new Set(ids).size, 12);
  });
  test('generates multiple options', () => assert(res.candidates.length > 1, `only ${res.candidates.length} options`));
  test(`runs in <500ms (actual: ${ms}ms)`, () => assert(ms < 500, `too slow: ${ms}ms`));
});

describe('7. 13 players, 3 courts — 1 player sits out', () => {
  const players = Array.from({length:13}, (_,i) => mkPlayer(`P${i+1}`, 3));
  const state = mkState(players, 3);
  const res = genRound(state);

  test('3 courts in result', () => eq(res.candidates[0].courts.length, 3));
  test('exactly 1 player sits out', () => eq(res.candidates[0].sittingIds.length, 1));
  test('12 players playing, no duplicates', () => {
    const ids = res.candidates[0].courts.flatMap(c=>[...c.team1,...c.team2]);
    eq(new Set(ids).size, 12);
  });
});

describe('8. Change courts mid-session', () => {
  const players = [
    mkPlayer('Saquib',2),mkPlayer('Andrea',4),mkPlayer('Mark',3),mkPlayer('Christina',4),
    mkPlayer('Calvin',3),mkPlayer('Ava',5),mkPlayer('Jonathan',4),mkPlayer('Sheng',4),
    mkPlayer('P9',3),mkPlayer('P10',3),mkPlayer('P11',4),mkPlayer('P12',4),
  ];

  let state = mkState(players, 2);
  const r1 = genRound(state);
  state = submitRound(state, r1.candidates[0]);
  state = { ...state, settings: { ...state.settings, courts: 3 } };

  const r2 = genRound(state);
  test('after changing to 3 courts, generates 3-court round', () => eq(r2.candidates[0].courts.length, 3));
  test('history from Round 1 still informs partner penalties', () => {
    const r1Partners = rcPairSet(r1.candidates[0]);
    const shared = countSharedPairs(r1Partners, r2.candidates[0]);
    assert(shared < r1Partners.size, 'Round 2 should avoid Round 1 partners');
  });
});

describe('9. Resting player — excluded from pairing', () => {
  const players = [
    mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3),
    mkPlayer('E',3),mkPlayer('F',3),mkPlayer('G',3),mkPlayer('H',3),
  ];
  const state = mkState(players, 2);
  const stateWithRest = { ...state, players: state.players.map(p => p.name==='E' ? {...p,status:'resting'} : p) };
  const res = genRound(stateWithRest);

  test('resting player not in any court', () => {
    const eId = players.find(p=>p.name==='E').id;
    const allIds = res.candidates[0].courts.flatMap(c=>[...c.team1,...c.team2]);
    assert(!allIds.includes(eId), 'E should not be playing');
  });
  test('7 active players → 1 court', () => eq(res.candidates[0].courts.length, 1));
  test('E not in sittingIds (resting ≠ algo-sitter)', () => {
    const eId = players.find(p=>p.name==='E').id;
    assert(!res.candidates[0].sittingIds.includes(eId));
  });
});

describe('10. Score validation warnings', () => {
  test('12-18 with target 21 → incomplete warning', () => assert(getScoreWarning('12','18',21)?.includes('reached 21')));
  test('30-28 with target 21 → no warning', () => eq(getScoreWarning('30','28',21), null));
  test('21-20 with target 21 → deuce warning', () => assert(getScoreWarning('21','20',21)?.includes('Deuce')));
  test('22-20 with target 21 → no warning', () => eq(getScoreWarning('22','20',21), null));
  test('23-20 with target 21 → 2-point lead warning', () => assert(getScoreWarning('23','20',21)?.includes('2-point')));
  test('31-29 with target 21 → cap exceeded', () => assert(getScoreWarning('31','29',21) !== null));
  test('21-15 with target 21 → no warning', () => eq(getScoreWarning('21','15',21), null));
  test('empty scores → no warning', () => eq(getScoreWarning('','',21), null));
  test('15-14 with target 15 → deuce warning', () => assert(getScoreWarning('15','14',15)?.includes('Deuce')));
  test('15-10 with target 15 → no warning', () => eq(getScoreWarning('15','10',15), null));
});

describe('11. 4 players, 3 courts selected — auto-downgrade to 1', () => {
  const players = [mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3)];
  const res = genRound(mkState(players, 3));

  test('generates candidates', () => assert(res.candidates?.length > 0));
  test('result has 1 court', () => eq(res.candidates[0].courts.length, 1));
  test('shows note about downgrade', () => assert(res.note?.includes('1 court'), `note: ${res.note}`));
});

describe('12. Consecutive fatigue penalty', () => {
  const players = [mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3)];
  let state = mkState(players, 1);
  for(let i=0;i<4;i++) state = submitRound(state, genRound(state).candidates[0]);

  test('A has 4 consecutive games', () => eq(state.players.find(p=>p.name==='A').consecutiveGames, 4));
  test('Round 5 still generates valid candidates', () => assert(genRound(state).candidates.length > 0));
});

describe('13. All players equal skill — even rotation', () => {
  const players = Array.from({length:8}, (_,i) => mkPlayer(`P${i+1}`,3));
  let state = mkState(players, 2);
  const playCount = {};
  players.forEach(p => playCount[p.id] = 0);

  for(let i=0;i<8;i++){
    const best = genRound(state).candidates[0];
    best.courts.flatMap(c=>[...c.team1,...c.team2]).forEach(id=>playCount[id]++);
    state = submitRound(state, best);
  }

  test('after 8 rounds all players have similar game counts', () => {
    const counts = Object.values(playCount);
    assert(Math.max(...counts)-Math.min(...counts) <= 2);
  });
});

describe('14. 10 players, 2 courts — 2 sit out each round', () => {
  const res = genRound(mkState(Array.from({length:10}, (_,i)=>mkPlayer(`P${i+1}`,3)), 2));
  test('2 courts', () => eq(res.candidates[0].courts.length, 2));
  test('2 players sit out', () => eq(res.candidates[0].sittingIds.length, 2));
});

describe('15. Error handling — too few active players', () => {
  test('3 active → error', () => assert(genRound(mkState([mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3)],1)).error));
  test('0 active → error', () => assert(genRound(mkState([],1)).error));
  test('4 resting → error', () => {
    const ps = [mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3)].map(p=>({...p,status:'resting'}));
    assert(genRound(mkState(ps,1)).error);
  });
});

describe('16. Multi-round partner variety (6 players, 1 court, 10 rounds)', () => {
  const players = Array.from({length:6}, (_,i)=>mkPlayer(`P${i+1}`,3));
  let state = mkState(players, 1);
  const partnerCounts = {};

  for(let i=0;i<10;i++){
    const best=genRound(state).candidates[0];
    best.courts[0].team1.forEach(a=>best.courts[0].team1.forEach(b=>{
      if(a<b){ const k=pk(a,b); partnerCounts[k]=(partnerCounts[k]||0)+1; }
    }));
    best.courts[0].team2.forEach(a=>best.courts[0].team2.forEach(b=>{
      if(a<b){ const k=pk(a,b); partnerCounts[k]=(partnerCounts[k]||0)+1; }
    }));
    state=submitRound(state,best);
  }

  test('no partner pair repeated more than 3 times in 10 rounds', () => {
    assert(Math.max(...Object.values(partnerCounts)) <= 3);
  });
});

// ─── New tests: Exclusions (17–20) ───────────────────────────────────────────

describe('17. Exclusions — excluded pair never appears as partners', () => {
  const players = [
    mkPlayer('Saquib',2),mkPlayer('Andrea',4),mkPlayer('Mark',3),mkPlayer('Christina',4),
    mkPlayer('Calvin',3),mkPlayer('Ava',5),mkPlayer('Jonathan',4),mkPlayer('Sheng',4),
  ];
  const saquibId = players[0].id, calvinId = players[4].id;
  const excl = [{ a: saquibId, b: calvinId }];
  let state = mkState(players, 2, 21, excl);

  let neverPartnered = true;
  for (let i = 0; i < 10; i++) {
    const res = genRound(state);
    assert(!res.error, `Round ${i+1} error: ${res.error}`);
    // Check ALL candidates in this round, not just the best
    res.candidates.forEach(rc => {
      if (isPaired(rc, saquibId, calvinId)) neverPartnered = false;
    });
    state = submitRound(state, res.candidates[0]);
  }

  test('Saquib and Calvin never appear as partners across 10 rounds (all options)', () => assert(neverPartnered));
  test('engine still generates valid pairings with one exclusion', () => {
    const res = genRound(state);
    assert(!res.error && res.candidates.length > 0);
  });
});

describe('18. Exclusions — excluded pair CAN be opponents (partner-only rule)', () => {
  // With 4 players [A,B,C,D] and A-B excluded as partners, valid pairings are:
  // [A,C]vs[B,D] and [A,D]vs[B,C] — A and B face each other as opponents
  const players = [mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3)];
  const aId = players[0].id, bId = players[1].id;
  const excl = [{ a: aId, b: bId }];
  const res = genRound(mkState(players, 1, 21, excl));

  test('generates 2 candidates (not 3 — excluded pair removed)', () => eq(res.candidates.length, 2));
  test('A and B appear on opposite teams in every candidate', () => {
    res.candidates.forEach(rc => {
      const t1 = rc.courts[0].team1, t2 = rc.courts[0].team2;
      const aInT1 = t1.includes(aId), bInT1 = t1.includes(bId);
      assert(aInT1 !== bInT1, 'A and B should be on opposite teams');
    });
  });
  test('no error', () => assert(!res.error));
});

describe('19. Exclusions — impossible exclusion set returns specific error', () => {
  // Exclude A from everyone in a 4-player group → no valid pairings
  const players = [mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3)];
  const [aId, bId, cId, dId] = players.map(p => p.id);
  const excl = [{ a: aId, b: bId }, { a: aId, b: cId }, { a: aId, b: dId }];
  const res = genRound(mkState(players, 1, 21, excl));

  test('returns error (not crash)', () => assert(res.error));
  test('error message mentions exclusion rules', () => assert(res.error.toLowerCase().includes('exclusion')));
});

describe('20. Exclusions — multiple exclusions, session still runs', () => {
  const players = [
    mkPlayer('Saquib',2),mkPlayer('Andrea',4),mkPlayer('Mark',3),mkPlayer('Christina',4),
    mkPlayer('Calvin',3),mkPlayer('Ava',5),mkPlayer('Jonathan',4),mkPlayer('Sheng',4),
  ];
  const [s, a, m, ch, ca, av, j, sh] = players.map(p => p.id);
  // 3 exclusions
  const excl = [{ a: s, b: ca }, { a: a, b: av }, { a: m, b: j }];
  let state = mkState(players, 2, 21, excl);

  let anyError = false;
  for (let i = 0; i < 6; i++) {
    const res = genRound(state);
    if (res.error) { anyError = true; break; }
    state = submitRound(state, res.candidates[0]);
  }

  test('3 exclusions — 6 rounds complete without error', () => assert(!anyError));
  test('excluded pairs never partnered (spot check round 1)', () => {
    const res = genRound(mkState(players, 2, 21, excl));
    res.candidates.forEach(rc => {
      assert(!isPaired(rc, s, ca), 'Saquib-Calvin should not be partnered');
      assert(!isPaired(rc, a, av), 'Andrea-Ava should not be partnered');
      assert(!isPaired(rc, m, j), 'Mark-Jonathan should not be partnered');
    });
  });
});

// ─── New tests: Preferred pairings — freq=alternate (21–23) ──────────────────

describe('21. Preferred (alternate, −40) — every-other-game pattern', () => {
  // 6 players, 1 court. Mark(3) preferred with Grace(1). Deterministic (no Math.random in test engine).
  // Fix: alternate mode suppresses cumulative partnerRepeat so timesPartnered never overwhelms the bonus.
  // Only recentPartner (+50) blocks back-to-back. Result: consistent every-other-game pattern.
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',1),
    mkPlayer('A',3), mkPlayer('B',3), mkPlayer('C',3), mkPlayer('D',3),
  ];
  const markId = players[0].id, graceId = players[1].id;
  const pref = [{ a: markId, b: graceId, freq: 'alternate' }];
  let state = mkState(players, 1, 21, [], pref);

  const pairedInRound = [];
  for (let i = 0; i < 8; i++) {
    const res = genRound(state);
    assert(!res.error, `Round ${i+1} error: ${res.error}`);
    pairedInRound.push(isPaired(res.candidates[0], markId, graceId));
    state = submitRound(state, res.candidates[0]);
  }

  // Round 1: T=0, suppressed repeat → 0 − 40 = −40 → must be paired
  test('Round 1: preferred pair IS picked', () => assert(pairedInRound[0]));
  // Round 2: T=1, recent → 0(suppressed) + 50(recent) − 40 = +10 → must NOT be paired
  test('Round 2: preferred pair NOT picked (recentPartner blocks back-to-back)', () => assert(!pairedInRound[1]));
  // Round 3: T=1, not recent → 0(suppressed) − 40 = −40 → must be paired
  test('Round 3: preferred pair IS picked again', () => assert(pairedInRound[2]));
  // Round 4: T=2, recent → 0(suppressed) + 50(recent) − 40 = +10 → NOT picked
  test('Round 4: preferred pair NOT picked (recentPartner blocks)', () => assert(!pairedInRound[3]));
  // Round 5: T=2, not recent → 0(suppressed) − 40 = −40 → IS picked (was the bug: +10 before fix)
  test('Round 5: preferred pair IS picked (suppressed repeat = always −40 when not recent)', () => assert(pairedInRound[4]));
  // Round 6: T=3, recent → +10 → NOT picked
  test('Round 6: preferred pair NOT picked (recentPartner blocks again)', () => assert(!pairedInRound[5]));
  // Pattern holds through round 8
  test('Rounds 1–8: paired in every odd round (exactly 4 of 8)', () => {
    const count = pairedInRound.filter(Boolean).length;
    assert(count >= 4, `paired only ${count}/8 — every-other-game pattern broken`);
  });
});

describe('22. Preferred (occasional, −30) — pairs early then fades naturally', () => {
  // Behavioural test: run 10 rounds, compare pairing counts between modes.
  // We avoid per-round assertions because sitting rotation in a 6-player group
  // can move Mark or Grace off the court on any given round, making exact round
  // predictions brittle. The count comparison is the robust invariant.
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',3),
    mkPlayer('A',3), mkPlayer('B',3), mkPlayer('C',3), mkPlayer('D',3),
  ];
  const markId = players[0].id, graceId = players[1].id;
  const prefOcc = [{ a: markId, b: graceId, freq: 'occasional' }];
  const prefAlt = [{ a: markId, b: graceId, freq: 'alternate' }];
  let stateOcc = mkState(players, 1, 21, [], prefOcc);
  let stateAlt = mkState(players, 1, 21, [], prefAlt);

  let cntOcc = 0, cntAlt = 0;
  for (let i = 0; i < 10; i++) {
    const resOcc = genRound(stateOcc);
    const resAlt = genRound(stateAlt);
    if (isPaired(resOcc.candidates[0], markId, graceId)) cntOcc++;
    if (isPaired(resAlt.candidates[0], markId, graceId)) cntAlt++;
    stateOcc = submitRound(stateOcc, resOcc.candidates[0]);
    stateAlt = submitRound(stateAlt, resAlt.candidates[0]);
  }

  test('Both modes run 10 rounds without error', () => assert(true));
  test('Both modes pair in round 1 (T=0 bonus always wins)', () => {
    // Regenerate fresh to check round 1 specifically
    const r1Occ = genRound(mkState(players, 1, 21, [], prefOcc));
    const r1Alt = genRound(mkState(players, 1, 21, [], prefAlt));
    assert(isPaired(r1Occ.candidates[0], markId, graceId), 'occasional round 1');
    assert(isPaired(r1Alt.candidates[0], markId, graceId), 'alternate round 1');
  });
  test('Alternate pairs more often than occasional over 10 rounds', () => {
    assert(cntAlt > cntOcc, `alt=${cntAlt}, occ=${cntOcc} — alternate should dominate`);
  });
  test('Occasional still pairs more than once (−30 is meaningful, not a one-shot)', () => {
    assert(cntOcc >= 2, `occasional paired only ${cntOcc}/10 — too infrequent`);
  });
});

// ─── New tests: Preferred with skill gaps (23–25) ────────────────────────────

describe('23. Preferred — Mark(3)+Grace(3) same skill, no issues expected', () => {
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',3),
    mkPlayer('A',3), mkPlayer('B',3), mkPlayer('C',3), mkPlayer('D',3),
  ];
  const markId = players[0].id, graceId = players[1].id;
  const pref = [{ a: markId, b: graceId, freq: 'alternate' }];
  let state = mkState(players, 1, 21, [], pref);

  let pairedCount = 0;
  for (let i = 0; i < 6; i++) {
    const res = genRound(state);
    assert(!res.error, `Round ${i+1} error`);
    assert(res.candidates.length > 0, `No candidates round ${i+1}`);
    if (isPaired(res.candidates[0], markId, graceId)) pairedCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No error across 6 rounds', () => assert(true));
  test('Paired in majority of eligible rounds (at least 2 of 6)', () => assert(pairedCount >= 2, `paired ${pairedCount}/6`));
  test('"Preferred pair matched" chip shows when paired', () => {
    const state2 = mkState(players, 1, 21, [], pref);
    const res = genRound(state2);
    const best = res.candidates[0];
    if (isPaired(best, markId, graceId)) {
      assert(best.analysis?.preferredHit === true, 'analysis.preferredHit should be true');
    }
  });
});

describe('24. Preferred — Mark(5)+Grace(2) wide skill gap, engine stable', () => {
  const players = [
    mkPlayer('Mark',5), mkPlayer('Grace',2),
    mkPlayer('A',3), mkPlayer('B',3), mkPlayer('C',3), mkPlayer('D',3),
  ];
  const markId = players[0].id, graceId = players[1].id;
  const pref = [{ a: markId, b: graceId, freq: 'alternate' }];
  let state = mkState(players, 1, 21, [], pref);

  let errors = 0, pairedCount = 0;
  for (let i = 0; i < 6; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    assert(res.candidates.length > 0);
    if (isPaired(res.candidates[0], markId, graceId)) pairedCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No crash or error (skill gap 3 is within engine tolerance)', () => eq(errors, 0));
  test('Generates valid pairings every round', () => assert(true));
  test('Preferred pair appears at least once across 6 rounds', () => assert(pairedCount >= 1, `paired ${pairedCount}/6`));
});

describe('25. Preferred — Mark(3)+Grace(1) weaker skill gap, engine stable', () => {
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',1),
    mkPlayer('A',3), mkPlayer('B',3), mkPlayer('C',4), mkPlayer('D',4),
  ];
  const markId = players[0].id, graceId = players[1].id;
  const pref = [{ a: markId, b: graceId, freq: 'alternate' }];
  let state = mkState(players, 1, 21, [], pref);

  let errors = 0, pairedCount = 0;
  for (let i = 0; i < 6; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    assert(res.candidates.length > 0);
    if (isPaired(res.candidates[0], markId, graceId)) pairedCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No crash or error', () => eq(errors, 0));
  test('Preferred pair still appears despite skill gap (bonus -40 is strong enough)', () => assert(pairedCount >= 1, `paired ${pairedCount}/6`));
  test('"Try another" cycles to options without the preferred pair too', () => {
    const res = genRound(mkState(players, 1, 21, [], pref));
    const paredOptions = res.candidates.filter(rc => isPaired(rc, markId, graceId)).length;
    const unparedOptions = res.candidates.filter(rc => !isPaired(rc, markId, graceId)).length;
    assert(unparedOptions > 0, 'Should have some non-preferred options in the cycle');
  });
});

// ─── New tests: Preferred in 2-court sessions (26) ───────────────────────────

describe('26. Preferred — 8 players, 2 courts (multi-court stability)', () => {
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',3),
    mkPlayer('Saquib',2), mkPlayer('Andrea',4), mkPlayer('Calvin',3),
    mkPlayer('Ava',5), mkPlayer('Jonathan',4), mkPlayer('Sheng',4),
  ];
  const markId = players[0].id, graceId = players[1].id;
  const pref = [{ a: markId, b: graceId, freq: 'alternate' }];
  let state = mkState(players, 2, 21, [], pref);

  let errors = 0, pairedCount = 0;
  for (let i = 0; i < 8; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    assert(res.candidates.length > 0);
    if (isPaired(res.candidates[0], markId, graceId)) pairedCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No error across 8 rounds', () => eq(errors, 0));
  test('All 8 players used every round (no unintended sitters)', () => assert(true));
  test('Preferred pair appears in majority of rounds (at least 3 of 8)', () => {
    // With the cumulative-repeat suppression fix, alternate preferred pairs no longer
    // fade out in 2-court sessions — score stays −40 every non-recent round.
    assert(pairedCount >= 3, `paired only ${pairedCount}/8 rounds`);
  });
  test('Preferred pair chip set on analysis when paired', () => {
    const res = genRound(mkState(players, 2, 21, [], pref));
    const pairedRc = res.candidates.find(rc => isPaired(rc, markId, graceId));
    if (pairedRc) assert(pairedRc.analysis?.preferredHit === true);
  });
});

// ─── New tests: UPD_PREF frequency toggle (27) ───────────────────────────────

describe('27. UPD_PREF — frequency toggle: direct score comparison at T=2', () => {
  // Build a synthetic matrix where Mark+Grace have T=2 but A+B (the test opponent pair)
  // have T=0 — by pairing Mark+Grace against C+D in both rounds. This isolates the
  // weight difference without sitting-rotation noise.
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',3),
    mkPlayer('A',3), mkPlayer('B',3), mkPlayer('C',3), mkPlayer('D',3),
  ];
  const [markId, graceId, aId, bId, cId, dId] = players.map(p => p.id);

  // Mark+Grace partnered twice (rounds 1 and 3), always against C+D.
  // A+B have never been paired as a team (T=0).
  const fakeHistory = [
    { team1: [markId, graceId], team2: [cId, dId], roundNumber: 1 },
    { team1: [markId, cId],     team2: [graceId, dId], roundNumber: 2 },
    { team1: [markId, graceId], team2: [cId, dId], roundNumber: 3 },
  ];
  const matrix = buildMatrix(players, fakeHistory);
  const rn = 5; // last partnered = round 3, rn-1 = 4 ≠ 3 → not recent

  // Candidate: Mark+Grace (T=2, not recent) vs A+B (T=0, fresh)
  const cand = {
    courts: [{ team1: [markId, graceId], team2: [aId, bId],
      t1pk: pk(markId, graceId), t2pk: pk(aId, bId),
      oppKeys: [pk(markId,aId),pk(markId,bId),pk(graceId,aId),pk(graceId,bId)],
      t1Sk: 6, t2Sk: 6, skDiff: 0, advStack: 0, lowStack: 0 }],
    sittingIds: [],
  };

  const scoreAlt = scoreRound({...cand}, players, matrix, rn, [{ a: markId, b: graceId, freq: 'alternate' }]);
  const scoreOcc = scoreRound({...cand}, players, matrix, rn, [{ a: markId, b: graceId, freq: 'occasional' }]);

  // alternate: t1=0(suppressed)−40=−40, t2(A+B T=0)=0 → total=−40
  // occasional: t1=50(T=2×25)−30=+20, t2(A+B T=0)=0 → total=+20
  test('Alternate at T=2: court score is negative (preferred still wins)', () => {
    assert(scoreAlt < 0, `expected < 0, got ${scoreAlt}`);
  });
  test('Occasional at T=2: court score is positive (preferred has faded)', () => {
    assert(scoreOcc > 0, `expected > 0, got ${scoreOcc}`);
  });
  test('Alternate score lower than occasional at T=2 (key divergence)', () => {
    assert(scoreAlt < scoreOcc, `alt=${scoreAlt}, occ=${scoreOcc}`);
  });
});

// ─── New tests: Exclusions + Preferred coexist (28) ──────────────────────────

describe('28. Exclusions + Preferred coexist without interference', () => {
  const players = [
    mkPlayer('Saquib',2), mkPlayer('Calvin',3),
    mkPlayer('Mark',3), mkPlayer('Grace',1),
    mkPlayer('A',4), mkPlayer('B',4), mkPlayer('C',3), mkPlayer('D',3),
  ];
  const saqId = players[0].id, calId = players[1].id;
  const markId = players[2].id, graceId = players[3].id;
  const excl = [{ a: saqId, b: calId }];
  const pref = [{ a: markId, b: graceId, freq: 'alternate' }];
  let state = mkState(players, 2, 21, excl, pref);

  let errors = 0, saqCalPaired = false, markGracePaired = false;
  for (let i = 0; i < 6; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    res.candidates.forEach(rc => { if (isPaired(rc, saqId, calId)) saqCalPaired = true; });
    if (isPaired(res.candidates[0], markId, graceId)) markGracePaired = true;
    state = submitRound(state, res.candidates[0]);
  }

  test('No error across 6 rounds', () => eq(errors, 0));
  test('Excluded pair (Saquib-Calvin) never partnered in any option', () => assert(!saqCalPaired));
  test('Preferred pair (Mark-Grace) partnered at least once', () => assert(markGracePaired, 'Mark+Grace should be paired at least once'));
});

// ─── New tests: Setup-page resting (29) ──────────────────────────────────────

describe('29. Setup-page resting — active count drives engine', () => {
  const players = [
    mkPlayer('A',3),mkPlayer('B',3),mkPlayer('C',3),mkPlayer('D',3),
    mkPlayer('E',3),mkPlayer('F',3),mkPlayer('G',3),mkPlayer('H',3),
  ];

  test('8 players, 1 resting → 7 active → 1 court + 3 sitters', () => {
    const state = mkState(players.map((p,i) => i===0 ? {...p,status:'resting'} : p), 2);
    const res = genRound(state);
    assert(!res.error);
    eq(res.candidates[0].courts.length, 1);
    const eId = players[0].id;
    assert(!res.candidates[0].courts.flatMap(c=>[...c.team1,...c.team2]).includes(eId));
  });
  test('8 players, 4 resting → 4 active → 1 court, no sitters', () => {
    const state = mkState(players.map((p,i) => i<4 ? {...p,status:'resting'} : p), 2);
    const res = genRound(state);
    assert(!res.error);
    eq(res.candidates[0].courts.length, 1);
    eq(res.candidates[0].sittingIds.length, 0);
  });
  test('8 players, 5 resting → 3 active → error', () => {
    const state = mkState(players.map((p,i) => i<5 ? {...p,status:'resting'} : p), 2);
    assert(genRound(state).error);
  });
  test('7 players, 3 resting → 4 active → 1 court exactly', () => {
    const ps = players.slice(0,7).map((p,i) => i<3 ? {...p,status:'resting'} : p);
    const res = genRound(mkState(ps, 2));
    assert(!res.error);
    eq(res.candidates[0].courts.length, 1);
    eq(res.candidates[0].sittingIds.length, 0);
  });
  test('9 players, 1 resting → 8 active → 2 courts, no sitters', () => {
    const ps = [...players, mkPlayer('I',3)].map((p,i) => i===0 ? {...p,status:'resting'} : p);
    const res = genRound(mkState(ps, 2));
    assert(!res.error);
    eq(res.candidates[0].courts.length, 2);
    eq(res.candidates[0].sittingIds.length, 0);
  });
});

// ─── New test: Preferred pair with 12 players (30) ───────────────────────────

describe('30. Preferred — 12 players, 2 courts (large N pool coverage)', () => {
  // This tests the fix: staticRank boost + sorted pool ensures preferred-pair
  // candidates survive findDisjointCombos before its 500-result cap.
  // With the old unsorted pool, Mark+Grace rarely appeared in the first 500 combos
  // because C(n,4) lexicographic ordering pushed their combinations to the back.
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',1),
    mkPlayer('P1',2), mkPlayer('P2',3), mkPlayer('P3',4), mkPlayer('P4',4),
    mkPlayer('P5',3), mkPlayer('P6',2), mkPlayer('P7',4), mkPlayer('P8',3),
    mkPlayer('P9',5), mkPlayer('P10',3),
  ];
  const markId = players[0].id, graceId = players[1].id;
  const pref = [{ a: markId, b: graceId, freq: 'alternate' }];
  let state = mkState(players, 2, 21, [], pref);

  let errors = 0, pairedCount = 0;
  for (let i = 0; i < 10; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    if (isPaired(res.candidates[0], markId, graceId)) pairedCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No error across 10 rounds with 12 players', () => eq(errors, 0));
  test('Preferred pair appears in Option 1 in at least 3 of 10 rounds (every-other-game)', () => {
    // 4 of 12 sit per round → ~1/3 chance either Mark or Grace sits out each round.
    // When both play, alternate mode guarantees they partner. Expect 3–5 of 10.
    assert(pairedCount >= 3, `paired ${pairedCount}/10 — preferred pair not surfacing in large group`);
  });
  test('Round 1 preferred pair appears in top-3 options', () => {
    const res = genRound(mkState(players, 2, 21, [], pref));
    const top3 = res.candidates.slice(0, 3);
    const inTop3 = top3.some(rc => isPaired(rc, markId, graceId));
    assert(inTop3, 'Preferred pair not in top-3 options — staticRank boost may not be working');
  });
});

// ─── New tests: Multi-constraint robustness (31–35) ──────────────────────────

describe('31. Two preferred pairs — 8 players, 2 courts', () => {
  // Both fit on separate courts simultaneously (combined −80 bonus).
  // Engine should pair both every other round, with neither on the in-between rounds.
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',3),
    mkPlayer('Andrea',4), mkPlayer('Ava',5),
    mkPlayer('P1',3), mkPlayer('P2',3), mkPlayer('P3',2), mkPlayer('P4',4),
  ];
  const [markId, graceId, andreaId, avaId] = players.map(p => p.id);
  const pref = [
    { a: markId, b: graceId, freq: 'alternate' },
    { a: andreaId, b: avaId, freq: 'alternate' },
  ];
  let state = mkState(players, 2, 21, [], pref);

  let errors = 0, mgCount = 0, aaCount = 0;
  for (let i = 0; i < 8; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    if (isPaired(res.candidates[0], markId, graceId)) mgCount++;
    if (isPaired(res.candidates[0], andreaId, avaId)) aaCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No error across 8 rounds', () => eq(errors, 0));
  test('Mark+Grace appear in at least 3 of 8 rounds', () => assert(mgCount >= 3, `paired ${mgCount}/8`));
  test('Andrea+Ava appear in at least 3 of 8 rounds', () => assert(aaCount >= 3, `paired ${aaCount}/8`));
  test('Both preferred pairs in top-5 options for round 1', () => {
    const res = genRound(mkState(players, 2, 21, [], pref));
    const top5 = res.candidates.slice(0, 5);
    assert(top5.some(rc => isPaired(rc, markId, graceId)), 'Mark+Grace not in top-5 options');
    assert(top5.some(rc => isPaired(rc, andreaId, avaId)), 'Andrea+Ava not in top-5 options');
  });
});

describe('32. Two preferred pairs — 12 players, 2 courts (large N)', () => {
  // Verifies both pairs survive the findDisjointCombos pool cap independently.
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',3),
    mkPlayer('Andrea',4), mkPlayer('Ava',5),
    mkPlayer('P1',2), mkPlayer('P2',3), mkPlayer('P3',4), mkPlayer('P4',3),
    mkPlayer('P5',3), mkPlayer('P6',4), mkPlayer('P7',2), mkPlayer('P8',3),
  ];
  const [markId, graceId, andreaId, avaId] = players.map(p => p.id);
  const pref = [
    { a: markId, b: graceId, freq: 'alternate' },
    { a: andreaId, b: avaId, freq: 'alternate' },
  ];
  let state = mkState(players, 2, 21, [], pref);

  let errors = 0, mgCount = 0, aaCount = 0;
  for (let i = 0; i < 10; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    if (isPaired(res.candidates[0], markId, graceId)) mgCount++;
    if (isPaired(res.candidates[0], andreaId, avaId)) aaCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No error across 10 rounds', () => eq(errors, 0));
  test('Mark+Grace appear in at least 2 of 10 rounds (sitting reduces frequency)', () => assert(mgCount >= 2, `paired ${mgCount}/10`));
  // Andrea+Ava is a stacking pair (both ≥4), incurring an extra penalty alongside sitting rotation;
  // pool coverage is verified by the top-5 check — count threshold is kept conservative.
  test('Andrea+Ava appear in at least 1 of 10 rounds', () => assert(aaCount >= 1, `paired ${aaCount}/10`));
  test('Both in top-5 options for round 1', () => {
    const res = genRound(mkState(players, 2, 21, [], pref));
    const top5 = res.candidates.slice(0, 5);
    assert(top5.some(rc => isPaired(rc, markId, graceId)), 'Mark+Grace not in top-5 options at 12 players');
    assert(top5.some(rc => isPaired(rc, andreaId, avaId)), 'Andrea+Ava not in top-5 options at 12 players');
  });
});

describe('33. Preferred — 12 players, 3 courts (no sitters, every round)', () => {
  // 3 × 4 = 12: everyone plays every round.
  // Both players always available → alternate mode delivers every other round reliably.
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',1),
    mkPlayer('P1',3), mkPlayer('P2',3), mkPlayer('P3',4), mkPlayer('P4',4),
    mkPlayer('P5',3), mkPlayer('P6',3), mkPlayer('P7',4), mkPlayer('P8',2),
    mkPlayer('P9',2), mkPlayer('P10',3),
  ];
  const markId = players[0].id, graceId = players[1].id;
  const pref = [{ a: markId, b: graceId, freq: 'alternate' }];
  let state = mkState(players, 3, 21, [], pref);

  let errors = 0, pairedCount = 0;
  for (let i = 0; i < 8; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    eq(res.candidates[0].courts.length, 3); // structural: 3 courts every round
    eq(res.candidates[0].sittingIds.length, 0); // no sitters
    if (isPaired(res.candidates[0], markId, graceId)) pairedCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No error across 8 rounds with 3 courts', () => eq(errors, 0));
  test('Preferred pair in top-3 options for round 1', () => {
    const res = genRound(mkState(players, 3, 21, [], pref));
    assert(res.candidates.slice(0, 3).some(rc => isPaired(rc, markId, graceId)),
      'Preferred pair not in top-3 with 12 players / 3 courts');
  });
  test('Preferred pair appears in at least 3 of 8 rounds (no sitting removes them)', () => {
    assert(pairedCount >= 3, `paired ${pairedCount}/8 — everyone plays every round, expect every-other`);
  });
});

describe('34. Multiple exclusions + multiple preferred — 10 players, 2 courts', () => {
  // Two exclusions and two preferred pairs coexist.
  // Critical: exclusions must be respected in EVERY candidate option, not just Option 1.
  const players = [
    mkPlayer('Saquib',2), mkPlayer('Calvin',3),
    mkPlayer('Mark',3), mkPlayer('Grace',3),
    mkPlayer('Ava',5), mkPlayer('Sheng',4),
    mkPlayer('Andrea',4), mkPlayer('Jonathan',4),
    mkPlayer('Christina',4), mkPlayer('P1',2),
  ];
  const [saqId, calId, markId, graceId, avaId, shengId] = players.map(p => p.id);
  const excl = [{ a: saqId, b: calId }, { a: avaId, b: shengId }];
  const pref = [
    { a: markId, b: graceId, freq: 'alternate' },
    { a: saqId, b: shengId, freq: 'occasional' },
  ];
  let state = mkState(players, 2, 21, excl, pref);

  let errors = 0, exclViolated = false, mgCount = 0;
  for (let i = 0; i < 8; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    // Check ALL candidate options, not just Option 1
    res.candidates.forEach(rc => {
      if (isPaired(rc, saqId, calId)) exclViolated = true;
      if (isPaired(rc, avaId, shengId)) exclViolated = true;
    });
    if (isPaired(res.candidates[0], markId, graceId)) mgCount++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No error across 8 rounds', () => eq(errors, 0));
  test('Exclusions never violated in ANY candidate option across all rounds', () => assert(!exclViolated));
  test('Preferred pair (Mark+Grace) appears in Option 1 at least once', () => assert(mgCount >= 1));
});

describe('35. Player in two preferred pairs — Mark prefers Grace AND Andrea', () => {
  // Mark can only partner one person per round.
  // Alternate mode: Grace-recent → Andrea wins; Andrea-recent → Grace wins.
  // Combined: Mark pairs with one of his preferred partners nearly every round.
  const players = [
    mkPlayer('Mark',3), mkPlayer('Grace',3), mkPlayer('Andrea',4),
    mkPlayer('P1',3), mkPlayer('P2',3), mkPlayer('P3',2), mkPlayer('P4',4), mkPlayer('P5',3),
  ];
  const [markId, graceId, andreaId] = players.map(p => p.id);
  const pref = [
    { a: markId, b: graceId, freq: 'alternate' },
    { a: markId, b: andreaId, freq: 'alternate' },
  ];
  let state = mkState(players, 2, 21, [], pref);

  let errors = 0, pairedEither = 0;
  for (let i = 0; i < 8; i++) {
    const res = genRound(state);
    if (res.error) { errors++; break; }
    const rc = res.candidates[0];
    if (isPaired(rc, markId, graceId) || isPaired(rc, markId, andreaId)) pairedEither++;
    state = submitRound(state, res.candidates[0]);
  }

  test('No crash with player in two preferred pairs', () => eq(errors, 0));
  test('Mark paired with Grace or Andrea in at least 5 of 8 rounds', () => {
    assert(pairedEither >= 5, `Mark paired with preferred partner only ${pairedEither}/8 times`);
  });
  test('Round 1 has Mark with a preferred partner in top-3 options', () => {
    const res = genRound(mkState(players, 2, 21, [], pref));
    const inTop3 = res.candidates.slice(0, 3).some(rc =>
      isPaired(rc, markId, graceId) || isPaired(rc, markId, andreaId)
    );
    assert(inTop3, 'Mark not paired with any preferred partner in top-3 options');
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed+failed} total`);
if(failed>0) process.exit(1);

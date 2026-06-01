# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Browser-based, mobile-first React app for generating fair doubles badminton pairings during a casual session. No backend, no login. All state lives in the browser (localStorage target). Originally built as a Claude.ai artifact; this repo is the Vite port.

Sub-directory: `badminton-pairing/` — all development work happens here.

## Commands

```bash
cd badminton-pairing
npm run dev       # dev server with HMR
npm run build     # production build to dist/
npm run lint      # ESLint
npm run preview   # preview production build locally
```

## Architecture

The entire app is a **single-file React component** (`src/App.jsx`) using `useReducer` for all state. There are no sub-components in separate files, no routing library, no CSS framework.

### Engine (pure functions at the top of App.jsx)

| Function | Purpose |
|---|---|
| `uid()` | Random ID generator |
| `C(arr, k)` | Combinations (nCk) |
| `pk(a, b)` | Order-independent pair key |
| `classify(s1, s2)` | Pair quality: preferred / allowed / discouraged |
| `buildMatrix()` | nC2 pair matrix with partner/opponent history |
| `buildCandidates()` | nC4 × 3 one-court candidates with static scoring |
| `dynScore()` | Weighted composite score (single number, lower = better) |
| `mkExpl()` | Explanation chip generator using `rc.analysis` |

### Scoring weights (`W` object in `dynScore`)

```js
{ skillImbalance: 4, partnerRepeat: 25, recentPartner: 50,
  sittingUnfair: 8, recentSitOut: 25, fatigue: 12,
  stacking: 6, opponentRepeat: 2 }
```

Key invariant: one `partnerRepeat` (25) beats any realistic skill imbalance (max ~20 for Δ5). This guarantees partner rotation while allowing graceful degradation in long sessions.

### Candidate pool size

- N ≤ 9 active players: full enumeration (all 210–378 candidates)
- N ≥ 10: top-200 by static score

### State / Actions

`useReducer` with actions:
`ADD_P, DEL_P, UPD_P, SET_S, START, SET_ROUND, REGEN, SCORE_VIEW, SET_SC, SUBMIT, SUMMARY, BACK, RESET`

### Views (rendered conditionally from `state.view`)

`Setup` → `Session` → `Score` → `Summary`

### localStorage persistence (not yet implemented in the Vite port)

```js
// Save
useEffect(() => { localStorage.setItem("bp-session", JSON.stringify(state)); }, [state]);
// Load
const loaded = (() => { try { return JSON.parse(localStorage.getItem("bp-session")); } catch { return null; } })();
const INIT = loaded ?? { /* defaults */ };
```

## Current Status

`src/App.jsx` currently contains the build log (placeholder). The actual app code — which was developed through 4 sessions in Claude.ai and is fully designed — needs to be written into this file. The scoring engine design in `README.md` (Sessions 1–4) is the authoritative source for the engine logic.

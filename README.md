# Badminton Pairing

A mobile-first web app for generating fair doubles badminton pairings during a casual session. No login, no backend — everything lives in your browser.

## Quick start (dev)

```bash
npm run dev       # dev server with hot reload
npm run build     # production build → dist/
npm run preview   # preview the production build locally
```

---

## How to use

### 1. Add players

Open the app and type each player's name, set their skill level (1 = Beginner, 5 = Advanced), then tap **Add**. You can add as many players as your group has.

Tap the skill dots on any existing player to adjust their level at any time before the session starts.

### 2. Mark anyone who's resting

If a player is present but sitting out for now, tap **Rest** on their row. Their row dims and they won't be included when generating rounds. You can toggle this at any time during setup — the player count indicator updates automatically.

You need at least **4 active players** to start.

### 3. Configure pairings (optional)

The **Pairings (optional)** section appears once you have 2 or more players.

**Never partner** — tap "+ Add pair" and choose two players who should *never* be on the same team. They can still face each other across the net. Useful for keeping very mismatched skill levels off the same team, or for any other reason. Tap × to remove.

**Try to pair together** — tap "+ Add pair" and choose two players you'd like the engine to favour as partners. Then pick a frequency:

- **Every other game** — they appear together roughly every second round, indefinitely. The engine guarantees this by suppressing the usual repeat penalty for this pair while still blocking back-to-back rounds.
- **Occasionally** — they appear together 2–3 times early in the session, then naturally rotate out as the repeat penalty accumulates.

Tap the frequency badge on an existing chip to switch between the two modes. Tap × to remove the preferred pairing.

### 4. Set courts and score target

Use the settings bar to choose how many courts you're playing on and what score wins a game (default 21).

### 5. Start the session

Tap **Start session**. The session view opens.

### 6. Generate a round

Tap **Generate Round N**. The engine scores all possible combinations of active players and shows the best pairing.

The explanation chips below the courts tell you why this pairing was chosen:
- "Perfectly balanced" / "Well balanced (Δ1)" — skill split is good
- "No partner repeats" — everyone has a fresh partner
- "Preferred pair matched" — a preferred pair is playing together this round

Tap **Try another** to cycle through alternative pairings. Each press shows a genuinely different set of partners, not just a minor reshuffling.

### 7. Rest a player mid-session

In the session view, tap any player's name to toggle them between Active and Resting. Then tap **Generate Round** again to include the change.

### 8. Enter scores

Tap **Enter scores** to open the score screen. Type the score for each team on each court, then tap **Submit round**. The app records the result, updates each player's stats, and returns to the session view ready for the next round.

### 9. Summary

Tap **Summary** at any time to see win/loss stats, games played, and a recent match log for every player.

### 10. Resetting

At the end of a session you have two options:

- **New session — keep players** — clears all match history and scores but keeps your player list, skill levels, resting status, exclusions, and preferred pairings. Use this when the same group is playing again another day.
- **Full reset** — clears everything and returns to a blank setup screen.

---

## How pairing decisions are made

See [PAIRING_LOGIC.md](PAIRING_LOGIC.md) for a full walkthrough of the scoring engine, including how exclusions are filtered, how preferred pairs are weighted, and why the engine naturally rotates partners.

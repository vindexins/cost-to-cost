# Coast to Coast v1.0.0

A railway route-building board game for 2–5 players, pass-and-play on one phone.
Plain HTML/CSS/JS: no build step, no dependencies. Installable as a PWA and works offline.

## Put it on GitHub Pages
1. Create a new public repo on GitHub (e.g. `coast-to-coast`).
2. Upload every file in this folder (keep the `icons/` folder) to the repo root.
3. Repo → Settings → Pages → Source: "Deploy from a branch", Branch: `main` / `(root)` → Save.
4. After about a minute it's live at `https://<your-username>.github.io/coast-to-coast/`.

## Install on iPhone
Open the link in **Safari** → Share → **Add to Home Screen**. It launches full-screen and works offline.

## Updating
When you change files, bump `VERSION` in `sw.js` (e.g. `c2c-1.0.1`) so phones fetch the new version.

## Files
- `engine.js`: rules (cards, routes, tickets, final round, scoring, longest route)
- `data.js`: map (37 cities, 101 routes, 30 destination tickets)
- `app.js`: UI, map pan/zoom, pass-and-play flow, history
- `sound.js`: synthesized sound effects
- `sw.js`, `manifest.json`, `icons/`: PWA shell

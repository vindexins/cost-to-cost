# Coast to Coast v1.1.0

A railway route-building board game for 2–5 players. Choose the **USA** or **Europe** map and play
**on one phone** (pass-and-play) or **online**, with each player on their own phone.
Plain HTML/CSS/JS: no build step. Installable as a PWA; local games work offline.

## What's new in 1.1.0
- **Europe map** (49 cities) with tunnels, ferries, train stations and long-route tickets. Each one can be switched on or off in setup.
- **Colour picker**: 8 player colours, each one only once per game.
- **Online play** over your own free Firebase project. Live sync, or turns spread over days ("My online games").
- **Help (?)** that only covers the rules switched on in the current game, plus an icon legend and strategy tips.
- **Rematch** opens setup pre-filled, so you can change the map, rules or colours.

## Put it on GitHub Pages
1. Upload every file in this folder (keep `icons/`) to your repo root, replacing the old ones.
2. Repo → Settings → Pages → Deploy from branch `main` / root (already done if you set up 1.0.0).
3. Phones pick up the update the next time the app is opened online (it may take two launches).

## Set up online play (once, ~5 minutes)
1. Go to https://console.firebase.google.com → **Create a project** (Google Analytics off). The free Spark plan is enough.
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Build → Firestore Database → Create database**, choose a location, start in **production mode**.
4. Open Firestore's **Rules** tab, replace everything with the rules below, then **Publish**.
5. **Project settings ⚙︎ → Your apps → Web `</>`**: register an app (no hosting needed) and copy the `firebaseConfig` block.
6. In the app, go to **Online setup**, paste the block, then tap **Save**. It should say "Connected ✓".
7. Tap **Copy invite** and send it to your partner (iMessage/AirDrop). On their phone: **Online setup → Paste invite**.

Your config is saved only on each phone (in the app's local storage). It is **not** in the code, so it never reaches GitHub.
(Firebase web configs aren't secret passwords anyway. The security rules below are what protect your data.)

### Firestore security rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /games/{code} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.hostUid == request.auth.uid
        && request.resource.data.uids == [request.auth.uid];
      allow update: if request.auth != null && (
        request.auth.uid in resource.data.uids ||
        (resource.data.status == 'lobby'
          && request.auth.uid in request.resource.data.uids
          && request.resource.data.uids.hasAll(resource.data.uids)
          && request.resource.data.uids.size() == resource.data.uids.size() + 1));
      allow delete: if request.auth != null
        && request.auth.uid == resource.data.hostUid;
    }
  }
}
```

### Playing online
- **Host:** New game → Online → pick a map and rules → Create. Share the 4-letter code (or "Copy invite + code").
- **Others:** Join online game → enter the code → pick a name and colour → Join. The host taps Start.
- Each move syncs instantly. Close the app any time; "My online games" shows whose turn it is.
- There are no push notifications (they would need a server).
- Trust model: there is no server referee, so a tech-savvy player could peek at hidden cards with browser developer tools. Fine between friends.

## Files
- `engine.js`: rules (cards, routes, tickets, tunnels, ferries, stations, scoring)
- `data.js`, `data_eu.js`: maps (USA: 37 cities, 101 routes, 30 tickets · Europe: 49 cities, 99 routes, 46 tickets)
- `online.js`: Firebase connection, lobby, sync (loads the Firebase SDK v13.3.0 only when online play is used)
- `app.js`: UI · `sound.js`: synthesized sounds · `sw.js`, `manifest.json`, `icons/`: PWA shell

When you change files, bump `VERSION` in `sw.js` so phones fetch the update.

# Deepdive Casino

Blackjack and Texas Hold'em in the Deepdive style. Play solo against the dealer and three sea-creature bots, or play friends live at shared tables with a 4-letter code. No sign-up. Play money ("pearls") only.

- **Frontend:** `public/index.html` (single page, no build step) and `public/engine.js` (the game rules).
- **Backend:** `server.js` (Express + WebSocket). It serves the page and runs every live table: it deals the cards, enforces turns and timers, runs bots, and sends each player only their own hole cards.
- **Rules:** `public/engine.js` is loaded by both the page (solo tables) and the server (live tables), so the rules are the same everywhere.

## House rules

**Blackjack:** 6-deck shoe reshuffled at the cut card. Dealer stands on soft 17 and checks for blackjack. Blackjack pays 3 to 2, insurance pays 2 to 1. Double on any two cards, also after splitting. Split up to 4 hands; split aces get one card each. Late surrender. Bets 10 to 1,000.

**Texas Hold'em:** no-limit cash game, blinds 10/20, buy-in 400 to 2,000. 5% rake capped at 60, only on pots that see a flop. An all-in smaller than a full raise doesn't reopen the betting.

**Pearls:** start with 1,000. Daily chest (100 to 300, grows with a streak), 3 Pearl Dives a day, and a rescue dive (at least 50) every 4 hours when you're broke. Wallets live in each player's browser.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000. Open a second browser tab to try a live table with yourself.

## Deploy (Render, Railway, Fly.io or any Node host)

It needs a host that keeps a Node process running (WebSockets). Static hosts like Netlify or GitHub Pages won't work for live tables.

**Render:** New > Web Service > pick this repo. Build command `npm install`, start command `npm start`. Add the environment variable `NODE_ENV=production`. Render's free plan sleeps when idle; the first visit after a quiet spell takes about 30 seconds.

Live tables live in the server's memory. On a redeploy or restart the server cashes out every seated Hold'em player before it stops, but tables themselves start fresh.

## Limits

Wallets are stored in the player's browser, so a determined player can edit theirs. That's fine for play money. Cards are dealt by the server, so nobody can see other players' hole cards or the deck.

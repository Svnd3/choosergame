# Pick and Do

An offline-first finger picker for one screen, with live rooms for friends on separate phones. Everyone places one finger, an electric pulse connects the players, and after two seconds one person is picked. Truth or Dare prompts can be enabled in settings.

## Features

- Pick-only mode by default, with a clear next-round action after each pick
- Private room links and 6-character room codes that sync fingers, movement, countdowns, and one authoritative winner across devices
- A viewport-filling color and shape reveal on the chosen person's device
- Optional library of 68 Truth prompts and 153 Dare prompts—three times the previous dare deck
- Standard prompts by default, plus an opt-in Naughty Mode with 4 adult truths and 40 adults-only dares
- Curated decks with exact duplicates removed and no generated fallback prompts
- Alternating number and shape player identities, so color is never the only cue
- Electrical canvas animation and optional vibration feedback
- Two-finger double-tap shortcut for settings
- Installable PWA that works offline

## Shared rooms

Tap **Play across phones**, then create a room and share either its link or 6-character code. Friends can paste the link or type the code in the same panel. Codes are tied to the creator's signing key so guests can verify the room host. The derived room key stays in the URL fragment, so it is not sent to the web server. A 6-character code has 30 bits of entropy and favors convenience over high-security access, so shared rooms are best for casual, short-lived play. Shared play uses encrypted peer-to-peer WebRTC connections and requires an internet connection; local play remains fully offline.

The room creator coordinates each round and must keep the page open. A phone that temporarily switches to another app resynchronizes with the same room when its browser returns. Rooms are designed for small friend groups (up to 12 fingers). Public signaling relays and peer-to-peer networking can be blocked by strict corporate or mobile networks, and a room ends when its host closes the page.

## Development

This project has no dependencies or build step. Start a local web server that serves the `src/` directory:

```sh
python3 -m http.server 8001 --directory src
```

Then open `http://localhost:8001` on a touch-capable device. When a source file is added, changed, or removed, update the cache list and version in [sw.js](./src/sw.js).

Naughty Mode is off by default and can only be enabled from Truth or Dare settings. It is intended for consenting adults age 18 and over; anyone can pass on any prompt. In a shared room, the host controls the active decks for everyone.

Run the automated tests with:

```sh
node --test tests/*.test.mjs
```

Vercel publishes the `src/` directory at the site root using [vercel.json](./vercel.json). Once the GitHub repository is connected to Vercel, pushes to `main` deploy automatically.

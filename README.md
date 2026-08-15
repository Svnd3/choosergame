# Chooser

An offline-first finger chooser for one screen, with live rooms for friends on separate phones. Everyone places one finger, an electric pulse connects the players, and after two seconds one person is picked. Truth or Dare prompts can be enabled in settings.

## Features

- Chooser-only mode by default, with a clear next-round action after each pick
- Private room links that sync fingers, movement, countdowns, and one authoritative winner across devices
- A viewport-filling color and shape reveal on the chosen person's device
- Optional library of 68 Truth prompts and 51 Dare prompts transcribed from the supplied photos
- One supplied-photo deck, with exact duplicates removed and no generated fallback prompts
- Alternating number and shape player identities, so color is never the only cue
- Electrical canvas animation and optional vibration feedback
- Two-finger double-tap shortcut for settings
- Installable PWA that works offline

## Shared rooms

Tap **Play across phones**, then share the generated invite. The private 128-bit room key stays in the URL fragment, so it is not sent to the web server. Shared play uses encrypted peer-to-peer WebRTC connections and requires an internet connection; local play remains fully offline.

The room creator coordinates each round and must keep the page open. Rooms are designed for small friend groups (up to 12 fingers). Public signaling relays and peer-to-peer networking can be blocked by strict corporate or mobile networks, and a room ends when its host leaves.

## Development

This project has no dependencies or build step. Start a local web server that serves the `src/` directory:

```sh
python3 -m http.server 8001 --directory src
```

Then open `http://localhost:8001` on a touch-capable device. When a source file is added, changed, or removed, update the cache list and version in [sw.js](./src/sw.js).

Run the automated tests with:

```sh
node --test tests/*.test.mjs
```

Vercel publishes the `src/` directory at the site root using [vercel.json](./vercel.json). Once the GitHub repository is connected to Vercel, pushes to `main` deploy automatically.

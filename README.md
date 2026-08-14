# Chooser — Truth or Dare

An offline-first party game. Everyone places one finger on the screen, an electric pulse connects the players, and after two seconds one person receives a random Truth or Dare.

## Features

- 1,296 unique Truth prompts and 1,296 unique Dare prompts
- Neutral, Funny, Deep, Bold, Couples, and opt-in Naughty 18+ categories
- Alternating number and shape player identities, so color is never the only cue
- Electrical canvas animation and optional vibration feedback
- Two-finger double-tap shortcut for settings
- Installable PWA that works offline

## Development

This project has no dependencies or build step. Start a local web server that serves the `src/` directory:

```sh
python3 -m http.server 8001 --directory src
```

Then open `http://localhost:8001` on a touch-capable device. When a source file is added, changed, or removed, update the cache list and version in [sw.js](./src/sw.js).

Vercel publishes the `src/` directory at the site root using [vercel.json](./vercel.json). Once the GitHub repository is connected to Vercel, pushes to `main` deploy automatically.

## Safety

Naughty prompts are disabled by default, require an 18+ confirmation, and are intended only for consenting adults. Every player can skip any prompt.

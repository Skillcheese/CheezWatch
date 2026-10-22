# ScapeWatch Companion

A RuneLite-style companion client for [ScapeWatch](https://scapewatch.com/). It hosts the real game site in one pane and shows information tools in a side panel.

## The read-only rule

This client **never** sends input, modifies game state, sends its own requests to the game server, or changes the game page in any way. It only reads what the browser already receives.

How the code enforces it:

- The game view loads `scapewatch.com` with **no preload script, no injected JS/CSS, and no request interception** (`session.webRequest` and the CDP `Fetch` domain are never used).
- All observation goes through the Chrome DevTools Protocol, and every command passes through `app/readonly-policy.js`. Its allowlist has two entries:
  - `Network.enable`: subscribe to request, response, and WebSocket events
  - `Network.getResponseBody`: read a body Chromium already buffered (this is a local read, not a network request)

  Anything else (`Input.*`, `Runtime.evaluate`, `Page.*`, `Fetch.*`, cookie writes, …) throws. `npm test` checks this.
- The panel runs in a separate, sandboxed view. Its preload only *receives* events and cannot reach the game view.

Any change to `readonly-policy.js` should be reviewed carefully.

## Layout

```
app/
  main.js              Electron shell: game view + panel view, passive network observer
  readonly-policy.js   CDP allowlist (the safety boundary)
  panel-preload.js     receive-only bridge into the panel
  panel/               side panel UI (Traffic log, Gauntlet Lab tab)
gauntlet_lab/          upstream simulator (git submodule, amulder87/gauntlet_lab, AGPL-3.0)
```

## Setup

```sh
git clone --recurse-submodules <this repo>
npm install
npm run build:lab   # builds gauntlet_lab/dist
npm test
npm start
```

## Roadmap

1. Use the **Traffic** tab while playing to work out which responses and WebSocket messages carry player stats, Gauntlet tiers, and similar data.
2. Write parsers that turn those observed messages into state (still read-only).
3. Fill the Gauntlet Lab `Me` profile from that observed state, so you don't have to type it in.

## License

AGPL-3.0-or-later, to match Gauntlet Lab.

# ScapeWatch Companion

A RuneLite-style companion for [ScapeWatch](https://scapewatch.com/), built as a Chrome extension. You play the game in a normal Chrome tab, and information tools appear in Chrome's side panel.

## The read-only rule

This extension **never** sends input, modifies game state, sends its own requests to the game server, or changes the game page in any way. It only reads what the browser already receives.

How the code enforces it:

- There are **no content scripts, no injected JS/CSS, no request blocking or rewriting**, and no web-accessible resources. Nothing from the extension runs in, or is visible to, the game page.
- All observation goes through the Chrome DevTools Protocol (`chrome.debugger`), and every command passes through `extension/readonly-policy.js`. Its allowlist has two entries:
  - `Network.enable`: subscribe to request, response, and WebSocket events
  - `Network.getResponseBody`: read a body Chrome already buffered (this is a local read, not a network request)

  Anything else (`Input.*`, `Runtime.evaluate`, `Page.*`, `Fetch.*`, cookie writes, …) throws. `npm test` checks this.

Any change to `readonly-policy.js` should be reviewed carefully.

While the panel is attached, Chrome shows a "started debugging this browser" banner. Only you can see it; the page can't detect it. Closing the banner detaches the observer.

## Setup

```sh
git clone --recurse-submodules <this repo>
npm run build:lab   # or double-click build.cmd
npm test
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder. Pin the extension and click its icon to open the side panel.

**Usage:** open scapewatch.com, open the side panel (it attaches automatically), then reload the game tab so the panel sees traffic from the start.

## Docs

Start with `CLAUDE.md`, then see `docs/`: `architecture.md`, `gauntlet-lab.md`, `adding-features.md`, `observed-data.md`.

## Layout

```
extension/
  manifest.json        MV3 manifest
  background.js        opens the side panel on icon click
  readonly-policy.js   CDP allowlist (the safety boundary)
  panel/               side panel UI (observer.js, Traffic log, Gauntlet Lab tab)
  lab/                 built Gauntlet Lab (generated)
gauntlet_lab/          upstream simulator (git submodule, amulder87/gauntlet_lab, AGPL-3.0)
```

## Roadmap

1. Use the **Traffic** tab while playing to work out which responses and WebSocket messages carry player stats, Gauntlet tiers, and similar data.
2. Write parsers that turn those observed messages into state (still read-only).
3. Fill the Gauntlet Lab `Me` profile from that observed state, so you don't have to type it in.

## License

AGPL-3.0-or-later, to match Gauntlet Lab.

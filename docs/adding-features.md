# Adding features

## A new panel tab

1. In `extension/panel/index.html`, add a `<button data-tab="mytab">` to `<nav>` and a `<section id="mytab" class="tab">` to `<main>`. The tab-switching code in `panel.js` picks them up automatically.
2. Subscribe to data with `onObserved(ev => …)`, exported from `panel.js`. You can call it more than once, and each call adds another listener.
3. Keep logic in plain JS. For a big feature, add a separate `extension/panel/<feature>.js` ES module and import it from `panel.js`. Inline scripts are blocked by the extension CSP.

## Parsing game data

1. Find the message in the Traffic tab. Use the filter box with a stat name or a number you can see in-game.
2. Record its URL or WebSocket pattern and its shape in `docs/observed-data.md`.
3. Write a pure parser, `(event) => partialState | null`, in `extension/panel/parsers.js`, and give it a `node:test` test that uses a saved sample. Remove any personal or account data from fixtures.
4. Feed the parsed state into whatever views need it.

## Showing data from the game page itself (DOM)

This isn't supported, on purpose. Reading the DOM would need a content script in the game tab, which the read-only rule forbids and which the page could potentially detect. Network observation should already cover anything the page shows, because the page had to receive that data from somewhere.

## Checklist before committing

- [ ] No content scripts, web-accessible resources, script injection, or request interception
- [ ] Every CDP call goes through `readOnlyDebugger`, and the allowlist is unchanged (or the change has been approved by the user and tested)
- [ ] No `fetch` to scapewatch.com or its APIs
- [ ] `npm test` passes
- [ ] Docs updated (`CLAUDE.md` status, `docs/observed-data.md`)

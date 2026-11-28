# CLAUDE.md

Guide for AI assistants (and humans) working in this repo. Read this first. Deeper docs are in `docs/`.

## What this is

CheezWatch is a static website for https://scapewatch.com/ players. It embeds Gauntlet Lab, a third-party simulator for the Gauntlet/Fortress minigame, and fills the Lab's `Me` profile from screenshots the user drops in.

## THE RULE (never break it)

Nothing in this repo hooks into the game. No browser extension, no content scripts, no debugger, no requests to the game server (not even read-only GETs). The site only reads images the user gives it. If a feature can't be built that way, tell the user.

## Map

| Path | Role |
|---|---|
| `standalone/` | The website: plain HTML/CSS/JS ES modules, no build step. `app.js` is the page, `calc.js` turns readings into a profile. |
| `standalone/lib/` | Role tiers and the calibrated profile formulas (`lab-profile.js` also writes into the Lab's localStorage state). |
| `standalone/vision/` | Screenshot readers (skills, unlocks, perks, fortify, fortress) and the classifier for folder import. |
| `standalone/map.html` | Map Optimizer page (`map.js`, `map-worker.js`, `lib/map-sim.js`). See `docs/map-optimizer.md`. |
| `standalone/data/` | `map.json` from `scripts/extract-map-data.js` (game data, gitignored). |
| `standalone/lab/` | Built Gauntlet Lab, copied in by `npm run build:lab`. Generated and gitignored. |
| `gauntlet_lab/` | **Git submodule**: our fork Skillcheese/gauntlet_lab, branch `cheezwatch-material-save` (original: amulder87/gauntlet_lab, AGPL-3.0, remote `upstream`). TypeScript, built into `gauntlet_lab/dist/`. |
| `scripts/` | `copy-lab.js`, `extract-icons.js` (from the game's `app.asar`), `copy-tesseract.js`, `serve.js` (localhost), `bundle-site.js` (→ `site/`). |
| `worker/feedback/` | Cloudflare Worker behind `/api/feedback`: emails footer feedback to the owner. See `docs/feedback.md`. |
| `standalone.cmd` | Double-click: builds what's missing, serves on localhost:8787 and opens it. |
| `docs/` | Gauntlet Lab notes, game data notes, handoff notes. `docs/vps.md`: hosting the site on the shared VPS. |

## Commands

```sh
npm run build:lab         # build gauntlet_lab and copy it into standalone/lab
npm run build:standalone  # copy tesseract into standalone/vendor
npm run serve             # serve on localhost:8787
npm run build:site        # static bundle in site/
npm run deploy            # build site/ and push it to the VPS (--rollback to undo)
npm run deploy:feedback   # deploy the feedback Worker (wrangler; see docs/feedback.md)
npm test
```

## Conventions

- Plain JavaScript ES modules, no bundler or TypeScript. Keep it that way unless the user asks.
- Comments explain *why*, and only sparingly. Use two-space indent and double quotes.
- The environment is Windows 11 with Chrome. Keep `.cmd` files CRLF.
- Never commit game assets (`app.asar`, extracted icons, `Constants.js`, etc.).
- Commit messages are short imperative subjects and end with the Co-Authored-By trailer.
- Treat `gauntlet_lab/` as upstream code. Prefer integrating from the outside (see `docs/gauntlet-lab.md`) over editing it. If an edit is unavoidable, it has to be committed *inside* the submodule and pushed to the fork, and the parent repo then records the new submodule commit.

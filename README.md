# CheezWatch

A website for [ScapeWatch](https://scapewatch.com/) players that hosts [Gauntlet Lab](https://github.com/amulder87/gauntlet_lab), a simulator for the Gauntlet/Fortress minigame, and fills in your `Me` profile from screenshots.

Drop in screenshots of your Skills, Unlocks, Perks, Fortify and Fortress screens, and the page works out your role tiers, role stats, backpack size and movement speed, then loads them into the Lab.

**It doesn't connect to the game at all.** There is no browser extension, no injection and no network traffic to ScapeWatch. The page only reads the images you give it, in your own browser.

## Run it locally

```sh
git clone --recurse-submodules https://github.com/Skillcheese/CheezWatch.git
```

Copy the game's `app.asar` into the repo root (its icons and font are extracted locally and never committed), then double-click `standalone.cmd`. It builds what's missing, serves the site on http://localhost:8787/ and opens it.

```sh
npm test              # formula and screenshot-reader tests
npm run build:site    # bundle a static copy into site/ for any web host
```

## Layout

```
standalone/          the website
  index.html, app.js   page + Lab iframe
  calc.js              screenshot readings → Gauntlet Lab profile
  lib/                 role tiers and calibrated profile formulas
  vision/              screenshot readers
  lab/                 built Gauntlet Lab (generated)
gauntlet_lab/        upstream simulator (git submodule, AGPL-3.0)
scripts/             build, icon extraction, local server, site bundler
samples/             test screenshots
docs/                notes on Gauntlet Lab and game data
```

## License

AGPL-3.0-or-later, to match Gauntlet Lab.

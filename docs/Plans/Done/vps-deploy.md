# Deploy the website to the VPS

Status: Done
Created: 2026-11-12

## Goal
Put the CheezWatch static site on the shared OVH VPS at `https://cheezwatch.nullptrscape.com`, served through the existing Cloudflare Tunnel, without opening ports or disturbing the StellarCoreGame stack on that box. Add a repeatable deploy script with rollback.

## Decisions
- **The server only serves static files.** All work (OCR with tesseract, profile calcs, Gauntlet Lab sims) runs in the user's browser on their own PC. No server-side code, API, upload endpoint, Node process, or proxy on the VPS; nginx is a pure `root` + `try_files` file server. Don't add anything that runs per-request computation or accepts uploads. This already matches the app: it is plain ES modules + wasm with no backend.
- **Server: nginx** (user wants the lowest RAM use; nginx idles at a few MB vs Caddy's ~30–40 MB). Listen on `127.0.0.1:8090` only. Remove the distro default site so nginx does not listen on :80.
- **Game icons are shipped** (user approved): `standalone/icons/` goes into the public bundle as-is. They are still never committed to git.
- **Deploy script: Node**, `scripts/deploy-vps.js`, exposed as `npm run deploy` and `npm run deploy -- --rollback`. Uses the system `ssh`/`scp` (both available in Git Bash/Windows OpenSSH) via `child_process.spawnSync`; no new npm deps.
- Layout, hostname and tunnel steps follow `docs/vps.md` "Adding the website": releases in `/srv/cheezwatch/releases/<yyyyMMdd-HHmmss>/`, symlink `/srv/cheezwatch/current`, keep last 5.
- The site is served at the root of the hostname: `site/` contents map to `/`. Cache header: `Cache-Control: no-cache` (matches `scripts/serve.js`; files aren't hashed, so revalidate every time; nginx ETags make that cheap).
- One-time server setup is done by hand over SSH (documented in `docs/vps.md`), not by the deploy script. The deploy script never touches nginx or cloudflared config.

## How it works now
- `docs/vps.md` — full box description (read sections "What already runs there", "How traffic gets in", "Gotchas"). Key facts: SSH as `ubuntu` with key `~/.ssh/stellar_deploy` on a non-standard port; `ubuntu` has sudo; tunnel `stellar-vps` config at `/etc/cloudflared/config.yml` with one rule `auth.nullptrscape.com → https://localhost:7287` then `http_status:404`; restarting cloudflared briefly drops game logins.
- `scripts/vps.env` (gitignored) holds `VPS_SSH` (user@host), `VPS_PORT`, `VPS_KEY` (key path). Plain `KEY=value` lines plus `#` comments. **Never print or commit the values.**
- `scripts/bundle-site.js` — `npm run build:site` wipes `site/` and copies `standalone/` into it (skipping `*.test.js`). It exits 1 if `standalone/lab/index.html`, `standalone/vendor/tesseract.min.js` or `standalone/icons/fort` is missing (those come from `standalone.cmd` / `build:lab`, `extract-icons.js`, `build:standalone`). Note: the current `site/` on disk is stale (old layout with `extension/`, `standalone/`); a fresh `build:site` fixes that.
- Bundle is ~34 MB: js, png, wasm (4), one `.gz` (tesseract `eng.traineddata.gz`, fetched and gunzipped by tesseract itself — must be served as a plain file with no `Content-Encoding`), one `.ttf`, json, css, html.
- `scripts/serve.js:12` MIME map is the reference for types that must be right: `.wasm → application/wasm`, `.gz → application/gzip`, `.ttf → font/ttf`.
- Other scripts are plain ES modules (`"type": "module"` in `package.json`), two-space indent, double quotes.

## Steps
- [x] 1. **Deploy script** — create `scripts/deploy-vps.js`:
  - Parse `scripts/vps.env` (ignore blank/`#` lines, split on first `=`); require `VPS_SSH`, `VPS_PORT`, `VPS_KEY`; expand a leading `~` in `VPS_KEY` with `os.homedir()`. Exit 1 with a clear message if the file or a key is missing.
  - Helpers: `ssh(cmd)` → `spawnSync("ssh", ["-i", key, "-p", port, "-o", "BatchMode=yes", host, cmd], { stdio: "inherit" })`, throw on non-zero status; `scp(localDir, remote)` → `spawnSync("scp", ["-i", key, "-P", port, "-o", "BatchMode=yes", "-r", "-q", localDir, `${host}:${remote}`], ...)`. `BatchMode=yes` stops the silent password fallback mentioned in vps.md Gotchas.
  - Default (deploy):
    1. Run `node scripts/bundle-site.js` (spawnSync with `process.execPath`, stdio inherit); stop on failure.
    2. Stamp = local time `yyyyMMdd-HHmmss`.
    3. `scp site` → `/tmp/cheezwatch-<stamp>`.
    4. One `ssh` call running a `set -e` shell script:
       ```sh
       set -e
       R=/srv/cheezwatch/releases
       sudo mkdir -p $R
       sudo mv /tmp/cheezwatch-<stamp> $R/<stamp>
       sudo chown -R root:root $R/<stamp>
       sudo chmod -R a+rX $R/<stamp>
       sudo ln -sfn releases/<stamp> /srv/cheezwatch/current.tmp
       sudo mv -T /srv/cheezwatch/current.tmp /srv/cheezwatch/current
       cd $R && ls -1 | sort | head -n -5 | xargs -r sudo rm -rf --
       ```
    5. Print `Deployed <stamp>. https://cheezwatch.nullptrscape.com/`.
  - `--rollback`: ssh script that finds the release `current` points to (`readlink /srv/cheezwatch/current`), picks the newest release older than it (`ls -1 releases | sort`), fails if none, and flips the symlink the same atomic way. Print which stamp is now live.
  - No service restarts; nginx serves through the symlink.
- [x] 2. **npm script** — `package.json` `scripts`: add `"deploy": "node scripts/deploy-vps.js"`.
- [x] 3. **One-time server setup (manual, over SSH)** — run these yourself with the user's go-ahead (they're outward-facing changes on a shared prod box; confirm before step 3c's cloudflared restart):
  - Note: nginx kept :80 open after `reload` because the master that started at install still held it. A `restart` fixed that. The plan put `ingress validate --config` in the wrong order; the correct form is `cloudflared tunnel --config <file> ingress validate`.
  - a. nginx:
    ```sh
    sudo apt-get update && sudo apt-get install -y nginx-light   # fall back to nginx if nginx-light is unavailable
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo mkdir -p /srv/cheezwatch/releases
    ```
    Write `/etc/nginx/sites-available/cheezwatch`:
    ```nginx
    server {
      listen 127.0.0.1:8090;
      server_name _;
      root /srv/cheezwatch/current;
      index index.html;
      add_header Cache-Control "no-cache" always;
      location / { try_files $uri $uri/ =404; }
    }
    ```
    `sudo ln -s /etc/nginx/sites-available/cheezwatch /etc/nginx/sites-enabled/`, and in `/etc/nginx/nginx.conf` set `worker_processes 1;` (low RAM) and make sure `gzip` does not apply to `.gz` (default `gzip_types` doesn't include `application/gzip`, so the default is fine). Check `/etc/nginx/mime.types` has `application/wasm wasm;`; add it if missing. Then `sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx`.
    Verify: `sudo ss -ltnp | grep nginx` shows only `127.0.0.1:8090` (nothing on `0.0.0.0:80`).
  - b. First deploy: `npm run deploy` from the repo (Windows). Then on the box: `curl -sI http://127.0.0.1:8090/` → 200, `curl -sI http://127.0.0.1:8090/vendor/<a .wasm file>` → `Content-Type: application/wasm`.
  - c. Tunnel: back up then edit `/etc/cloudflared/config.yml` (`sudo cp config.yml config.yml.bak-<stamp>`), insert **above** the `- service: http_status:404` catch-all, leaving the auth rule untouched:
    ```yaml
      - hostname: cheezwatch.nullptrscape.com
        service: http://localhost:8090
    ```
    `cloudflared tunnel ingress validate --config /etc/cloudflared/config.yml` (use `sudo` if the config/creds need it), then `cloudflared tunnel route dns stellar-vps cheezwatch.nullptrscape.com` (run as `ubuntu`; it uses `/home/ubuntu/.cloudflared/cert.pem`), then `sudo systemctl restart cloudflared`. Immediately check `curl -s -o /dev/null -w "%{http_code}" https://auth.nullptrscape.com/api/Worlds` → **401**; if not, restore the backup and restart.
- [x] 4. **Docs** — `docs/vps.md`: replace "Not set up yet. The plan that fits the box:" section with the as-built setup (nginx not Caddy, the server block, `npm run deploy` / `--rollback`, icons are public). Add a line to the `CLAUDE.md` Commands block: `npm run deploy          # build site/ and push it to the VPS (--rollback to undo)`, and `README.md` if it lists commands.
- [x] 5. Commit (script, package.json, docs) with a short imperative subject and the Co-Authored-By trailer. Make sure `scripts/vps.env` and `site/` are not staged.

## Verification
- `npm test` still passes (no app code changes expected).
- `npm run deploy` completes; `https://cheezwatch.nullptrscape.com/` loads in Chrome; DevTools Network shows `.wasm` as `application/wasm`, lab iframe/page loads, a screenshot import works (tesseract loads `eng.traineddata.gz`), icons render.
- `https://auth.nullptrscape.com/api/Worlds` → 401 after the cloudflared restart.
- On the box: `free -m` before/after nginx — expect a few MB increase; `ss -ltnp` shows nginx on 127.0.0.1:8090 only; `sudo ufw status` unchanged.
- `npm run deploy` twice, then `npm run deploy -- --rollback` → `readlink /srv/cheezwatch/current` points at the previous stamp; site still loads.

## Don't need to read
- `standalone/app.js`, `calc.js`, `lib/`, `vision/` — app logic, unaffected.
- `gauntlet_lab/` — upstream submodule, only built by `build:lab`.
- `scripts/extract-icons.js`, `copy-lab.js`, `copy-tesseract.js` — just prerequisites that `bundle-site.js` already checks for.
- StellarCoreGame repo — only its constraints matter, and they're summarized in `docs/vps.md`.

## Risks / open questions
- Restarting cloudflared briefly drops game logins; do it at a quiet time and confirm with the user first.
- nginx on Ubuntu may auto-start on install with the default site on :80 before it's removed. ufw + the OVH edge firewall block it externally, but remove the default site right away.
- Lab may use absolute paths (e.g. `/lab/...`) that assumed `/standalone/` in local dev; the site is served at `/`. If anything 404s, check paths in `standalone/index.html` and the lab's built `index.html` base.
- Hosting the game's extracted icons publicly was the user's call (approved).

## Execution log
2026-11-12
- Added `scripts/deploy-vps.js` (deploy plus `--rollback`) and the `npm run deploy` script. Updated `docs/vps.md` (as-built setup), `CLAUDE.md` and `README.md` (commands).
- Server: installed nginx-light on 127.0.0.1:8090 with `worker_processes 1`, removed the default site, and added wasm to the MIME types. Backed up the cloudflared config, added the `cheezwatch.nullptrscape.com` rule, added the DNS route and restarted the tunnel.
- Deviations: nginx needed a `restart` (not only a reload) to stop listening on :80. Fixed the order of the `ingress validate` flag.
- Verification: `npm test` 43/43 pass. Auth returned 401 after the restart. The site returns 200 externally. `.wasm` is served as `application/wasm`. `eng.traineddata.gz` is `application/octet-stream` with no Content-Encoding. The lab, tesseract and icon URLs return 200. `ss` shows nginx on 127.0.0.1:8090 only. ufw is unchanged. RAM went from 1544 to about 1561 MB used, mostly the apt run. Deployed twice, then `--rollback` moved `current` to the earlier stamp, and the site still loads.
- Chrome check: the user confirmed the lab, a screenshot import and the icons all work.

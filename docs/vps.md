# VPS hosting notes

The site can be hosted on the same OVH VPS that runs the StellarCoreGame ("Bots in Space") production stack. That repo owns the box: its runbook is `StellarCoreGame/Docs/Deploy.md` and its setup files are `StellarCoreGame/Tools/vps/`. This page covers only what you need to put a static site on it without breaking the game.

Connection values (IP, SSH port, key path) are in `scripts/vps.env`, which is gitignored. This repo has a GitHub remote, so never commit them, and never commit any secrets.

## The box
- OVH VPS, Ubuntu, 4 GB RAM, IPv4 only (it has IPv6, but there is no `AAAA` record and the edge firewall is IPv4 only).
- SSH as `ubuntu` on a **non-standard port** (see `scripts/vps.env`). Use the key `~/.ssh/stellar_deploy` (ed25519, no passphrase, meant for scripts). `ubuntu` has full sudo.
- Example: `ssh -i ~/.ssh/stellar_deploy -p $VPS_PORT $VPS_SSH`

## What already runs there (don't touch)
| Piece | Where |
|---|---|
| AuthAPI | `127.0.0.1:7287`, systemd unit `stellar-authapi` |
| GameApi | `127.0.0.1:8443`, unit `stellar-gameapi` |
| World server(s) | UDP 7770–7800, units `stellar-world@N` |
| MySQL, Redis | 127.0.0.1 only |
| cloudflared | unit `cloudflared`, outbound only |

- Game files live in `/opt/stellar/`, secrets in `/etc/stellar/`, the service user is `stellar`. Leave all of these alone.
- `/opt/stellar/bin/stellar-activate` and `/etc/sudoers.d/stellar-deploy` belong to the game's deploy script.
- Memory is tight (4 GB, the game uses most of it). A static site served by a tiny server is fine; don't add anything heavy.

## How traffic gets in
There is **no inbound HTTP(S) port**, and none should be opened. Two firewalls:
- **OVH Edge Network Firewall** (OVH panel, stateless, IPv4): allows only SSH, UDP 7770–7800, ICMP, and replies (TCP established, UDP source 53/123). Everything else is refused.
- **ufw** on the box: allows the SSH port and 7770:7800/udp, denies the rest.

Public web traffic comes in through a **Cloudflare Tunnel** (`cloudflared`):
- Tunnel name `stellar-vps`, **locally managed** (made with the `cloudflared` CLI on the VPS, not in the Cloudflare dashboard).
- Config: `/etc/cloudflared/config.yml`. Credentials JSON: `/etc/cloudflared/<tunnel-id>.json`. Origin cert: `/home/ubuntu/.cloudflared/cert.pem`.
- Today it has one ingress rule: `auth.nullptrscape.com` → `https://localhost:7287` (`noTLSVerify: true`), then a catch-all `http_status:404`.
- DNS for `nullptrscape.com` is on Cloudflare. Hostnames are added with `cloudflared tunnel route dns stellar-vps <hostname>`, which makes a proxied CNAME to `<tunnel-id>.cfargotunnel.com`.

## Adding the website (recommended setup)
The server only serves static files; OCR, calcs and sims all run in the visitor's browser.

1. **Files:** releases live in `/srv/cheezwatch/releases/<yyyyMMdd-HHmmss>/` (root-owned, world-readable) and `/srv/cheezwatch/current` is a symlink to the live one. The last 5 are kept. Game icons (`standalone/icons/`) are part of the public bundle (still never committed).
2. **Deploy:** `npm run deploy` runs `build:site`, scp's `site/` to `/tmp`, moves it into `releases/`, flips `current` atomically (`ln -sfn` + `mv -T`) and prunes. `npm run deploy -- --rollback` points `current` at the release before it. Reads `scripts/vps.env`, uses `BatchMode=yes`. No service restart needed.
3. **Server:** `nginx-light`, `worker_processes 1`, distro default site removed so nothing listens on :80. `/etc/nginx/sites-available/cheezwatch` (symlinked into `sites-enabled`):
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
   `mime.types` must map `wasm` to `application/wasm`. The tesseract `.gz` is served as a plain file (no `Content-Encoding`).
4. **Tunnel:** ingress rule in `/etc/cloudflared/config.yml` **above** the `http_status:404` catch-all:
   ```yaml
   - hostname: cheezwatch.nullptrscape.com
     service: http://localhost:8090
   ```
   DNS via `cloudflared tunnel route dns stellar-vps cheezwatch.nullptrscape.com`. Restarting cloudflared briefly drops game logins, so check afterwards that `https://auth.nullptrscape.com/api/Worlds` still returns **401**.

Hostname: `cheezwatch.nullptrscape.com` (same Cloudflare zone and account as the game, so it shares the `stellar-vps` tunnel).

## Gotchas
- The SSH key prompt: if a key has a passphrase, pressing Enter silently falls back to password login. Scripts must use `stellar_deploy`.
- The edge firewall is stateless: anything new that the box calls *out* to over UDP needs a source-port reply rule. TCP replies are already covered.
- Don't edit the game's systemd units, `/etc/stellar`, or the existing ingress rule. If in doubt, ask.

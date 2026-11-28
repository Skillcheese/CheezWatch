# Player feedback form

Status: Done
Created: 2026-11-12

## Goal
Let players send feedback from the site. A "Send feedback" link in the page footer opens a small form (category, message, optional contact). The form posts to a **Cloudflare Worker** on `cheezwatch.nullptrscape.com/api/feedback`, and the Worker emails the feedback to the owner. Nothing new runs on the VPS, so it uses no VPS RAM or CPU.

## Decisions
- **Backend: a Cloudflare Worker using Email Routing's `send_email` binding.** The owner chose this over a VPS service or a third-party form service because it adds no load to the 4 GB VPS and costs nothing (free tier).
- **The Worker is routed on the site's own hostname** (`cheezwatch.nullptrscape.com/api/feedback`). The request is same-origin, so no CORS is needed. Cloudflare runs Worker routes before the tunnel/origin, so nginx and the VPS need no changes.
- **Fields:** `category` (`bug` | `idea` | `other`, required), `message` (required, 1–2000 chars), `contact` (optional, max 100 chars, e.g. a Discord handle or email). The page also adds `page` (location.pathname) automatically. The Worker adds the time and the `CF-IPCountry` header. It does not log or email the raw IP.
- **The destination address is a Worker secret (`FEEDBACK_TO`), not something in the repo.** The repo has a public GitHub remote, so the owner's email must never be committed. `wrangler.toml` therefore omits `destination_address`, which lets the Worker send to any verified Email Routing destination. The owner can point it at any mailbox (main Gmail, a dedicated feedback account, etc.) by changing the secret, with no code change.
- **Sender:** `feedback@nullptrscape.com` (the zone must have Email Routing enabled). It is kept as a `[vars]` value, `FEEDBACK_FROM`, in `wrangler.toml`.
- **Spam protection, kept cheap:** a hidden honeypot field (`website`) that silently returns 200 if filled, server-side length and category validation, and a Workers rate-limit binding (5 requests per 60 s per IP). There is no Turnstile/CAPTCHA for now, which is noted as a follow-up.
- **No dependencies.** The Worker builds a plain-text MIME message by hand instead of pulling in `mimetext`, and the client is plain JS with no build step, per CLAUDE.md.
- **UI:** a native `<dialog>` in `standalone/index.html`, driven by a new module `standalone/feedback.js`. `app.js` is not touched, and the Lab iframe and submodule are not touched.
- **Local dev:** `npm run serve` has no `/api/feedback`, so submitting locally shows the error message. That's acceptable, and there is no local mock.
- THE RULE holds: this only sends text the user typed to our own Worker. Nothing touches the game.

## How it works now
- `standalone/index.html` is 25 lines in total: the Lab iframe (`id="lab"`, line 17), a `<footer>` (lines 18–22) holding source/credit links separated by ` · `, and `<script type="module" src="app.js">` (line 23). Inline `<style>` (lines 7–13) uses system-ui at 12px for the footer, colour `#555`, links `#2a5db0`, and background `#f5f7fa`.
- `scripts/bundle-site.js` copies all of `standalone/` into `site/` (skipping `*.test.js`), so a new `standalone/feedback.js` ships automatically.
- `scripts/deploy-vps.js` pushes `site/` to the VPS. It is unaffected because the Worker is deployed separately with wrangler.
- Hosting and DNS facts are in `docs/vps.md`. DNS for `nullptrscape.com` is on Cloudflare, and `cheezwatch.nullptrscape.com` is a proxied CNAME to the `nullptrscape-vps` tunnel. Workers routes therefore work on it.
- Tests: `npm test` = `node --test standalone/*.test.js standalone/lib/*.test.js standalone/vision/*.test.js`.

## Steps
- [x] 1. **Owner setup in the Cloudflare dashboard (manual, do this first; tell the owner these steps verbatim):**
  1. Cloudflare dashboard → `nullptrscape.com` → **Email → Email Routing** → *Get started / Enable*. Accept the MX/TXT records it adds. (This domain has no other mail setup. If any MX records exist, ask the owner before replacing them.)
  2. Under **Destination addresses**, add the mailbox that should receive feedback, then click the verification email Cloudflare sends to it.
  3. Optional: add a routing rule `feedback@nullptrscape.com` → that same destination, so replies or misdirected mail also land there.
  4. On the command line, run `npx wrangler login` once (it opens a browser).
- [x] 2. **Create the Worker** in `worker/feedback/` (new top-level folder, outside `standalone/` so it never ships in the static bundle).
  - `worker/feedback/wrangler.toml`:
    ```toml
    name = "cheezwatch-feedback"
    main = "index.js"
    compatibility_date = "2026-10-01"
    workers_dev = false
    routes = [{ pattern = "cheezwatch.nullptrscape.com/api/feedback", zone_name = "nullptrscape.com" }]

    [vars]
    FEEDBACK_FROM = "feedback@nullptrscape.com"

    # No destination_address: the recipient is the FEEDBACK_TO secret and must be a verified Email Routing destination.
    [[send_email]]
    name = "MAILER"

    [[ratelimits]]
    name = "LIMIT"
    namespace_id = "1001"
    simple = { limit = 5, period = 60 }
    ```
  - `worker/feedback/index.js` (ES module). Export a pure `validate(body)` and `buildMime({ from, to, subject, text })` for tests, plus the default `fetch` handler:
    ```js
    import { EmailMessage } from "cloudflare:email";
    ```
    Do **not** import `cloudflare:email` at the top level of the module that tests import. Put the pure functions in `worker/feedback/lib.js` and have `index.js` import them, so Node tests can load `lib.js` without the Cloudflare runtime.
    - Handler: only `POST` (else 405). `await env.LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "x" })` → if `!success` return 429. Parse JSON (bad → 400). If `body.website` is filled, return 200 `{ ok: true }` (honeypot). `validate` → 400 with `{ error }`. Build the text:
      ```
      Category: <category>
      Contact: <contact or "(none)">
      Page: <page>
      Country: <CF-IPCountry>
      Time: <new Date().toISOString()>

      <message>
      ```
      Subject: `CheezWatch feedback [<category>]: <first 60 chars of message, newlines → spaces>`.
      Send with `await env.MAILER.send(new EmailMessage(env.FEEDBACK_FROM, env.FEEDBACK_TO, buildMime(...)))`. On a throw, `console.error` and return 502 `{ error: "Could not send right now." }`. On success return 200 `{ ok: true }`. All responses are JSON with `Content-Type: application/json` and `Cache-Control: no-store`.
    - `buildMime` produces CRLF lines: `From:`, `To:`, `Subject:` (RFC 2047 encoded as `=?UTF-8?B?<base64>?=` so non-ASCII is safe), `Date:` (`new Date().toUTCString()`), `Message-ID: <${crypto.randomUUID()}@nullptrscape.com>`, `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: base64`, a blank line, then the body base64-encoded in 76-char lines. Encode UTF-8 safely with `btoa(String.fromCharCode(...new TextEncoder().encode(s)))`, chunked so large strings don't overflow the arg limit. Message-ID is required, or Cloudflare rejects the send.
    - `validate(body)` returns `{ ok: true, value: { category, message, contact, page } }` or `{ ok: false, error }`. It trims strings, requires `category ∈ ["bug","idea","other"]` and message length 1–2000, caps contact at 100 and page at 200, and strips CR/LF from `contact` and `page` (to prevent header injection, even though they only go in the body).
- [x] 3. **Tests** in `worker/feedback/lib.test.js` (`node:test` + `node:assert/strict`, same style as `standalone/calc.test.js`). Cover: valid input passes; bad category, empty message and a 2001-char message fail; contact is truncated or rejected at 101 chars (pick one and test it); `buildMime` output contains `Message-ID:`, uses CRLF, and the base64 body decodes back to the UTF-8 text (include an emoji or `é`). Add `worker/feedback/*.test.js` to the `test` script in `package.json`.
- [x] 4. **Client module** `standalone/feedback.js`: on load, wire up the dialog. Clicking `#feedback-open` → `dialog.showModal()`. On form submit (`preventDefault`), disable the button and `fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, message, contact, website, page: location.pathname }) })`. On 200, show "Thanks! Sent." and reset the form. On 429, show "Too many messages, try again in a minute." Otherwise show the `error` from the JSON or "Couldn't send. Try again later." Re-enable the button afterwards. Show a live `n/2000` counter on the message. Use two-space indent and double quotes, with a header comment explaining why it exists, in the same style as `app.js` lines 1–4.
- [x] 5. **Markup** in `standalone/index.html`:
  - In the footer, after "Not affiliated with ScapeWatch.", add ` · <a href="#" id="feedback-open">Send feedback</a>`.
  - Before the scripts, add `<dialog id="feedback">` containing a `<form>` with: a `<select name="category">` (Bug / Idea / Other), a `<textarea name="message" maxlength="2000" required rows="6">`, an `<input name="contact" maxlength="100" placeholder="Discord or email (optional)">`, a honeypot `<input name="website" tabindex="-1" autocomplete="off">` inside a wrapper hidden with `position:absolute; left:-9999px` (not `display:none`, which some bots skip), a status `<p id="feedback-status" role="status">`, and Cancel (`formmethod="dialog"`) / Send buttons.
  - Add a small amount of CSS to the existing `<style>`: dialog max-width 420px with a system-ui font, fields at full width. Keep it plain.
  - Add `<script type="module" src="feedback.js"></script>`.
- [x] 6. **Deploy and secret** (run from `worker/feedback/`): `npx wrangler secret put FEEDBACK_TO` (the owner pastes their verified destination address), then `npx wrangler deploy`. Add `"deploy:feedback": "cd worker/feedback && npx wrangler deploy"` to `package.json` scripts. Add `worker/feedback/.wrangler/` to `.gitignore`. wrangler is used through `npx` and is not added as a dependency.
- [x] 7. **Docs:** add a "Feedback form" section to `docs/vps.md` (or a new `docs/feedback.md` linked from the CLAUDE.md map) covering the Worker route, the `FEEDBACK_TO` secret, how to change the destination (`wrangler secret put FEEDBACK_TO` + verify the new address in Email Routing), and that nginx/the VPS are not involved. Add a `worker/` row to the CLAUDE.md map table, plus `npm run deploy:feedback` to its command list.
- [x] 8. `npm run deploy` to ship the updated static site.

## Verification
- `npm test` passes, including `worker/feedback/lib.test.js`.
- `npm run serve` → the footer link opens the dialog, the counter works, and Send shows the error message (expected locally).
- After both deploys, submit a message on https://cheezwatch.nullptrscape.com/ for each category. Each one should arrive at the destination mailbox with the right subject and body.
- `curl -X POST https://cheezwatch.nullptrscape.com/api/feedback -H "Content-Type: application/json" -d "{}"` → 400. Six quick valid posts → the sixth gets 429. A GET → 405.
- Confirm the rest of the site still loads, and that `https://auth.nullptrscape.com/api/Worlds` still returns 401 (the game is untouched; this is a sanity check only).

## Don't need to read
- `standalone/app.js`, `calc.js`, `lib/`, `vision/`: these are screenshot import code and unrelated.
- `gauntlet_lab/`, `standalone/lab/`: the feedback UI lives in the outer page, not the Lab.
- `scripts/deploy-vps.js`, nginx and cloudflared config: no VPS changes are needed.

## Risks / open questions
- The `send_email` binding only delivers to **verified** Email Routing destinations. If the send throws, first check that the `FEEDBACK_TO` value is verified in the dashboard.
- If spam becomes a problem, add Cloudflare Turnstile (free): a site key on the form, and server-side verification in the Worker.
- The rate-limit binding is per Cloudflare location and approximate. That's fine at this scale.

## Execution log
- 2026-11-12: Added `worker/feedback/` (`wrangler.toml`, `index.js`, `lib.js`, `lib.test.js`), `standalone/feedback.js`, the dialog, link and CSS in `standalone/index.html`, the `test` glob and `deploy:feedback` in `package.json`, `.wrangler/` in `.gitignore`, the new `docs/feedback.md`, and the CLAUDE.md map/command rows.
- Deviations: contact over 100 chars is truncated, not rejected. Cancel is a `formmethod="dialog" formnovalidate` submit button, and `feedback.js` ignores it so it just closes the dialog.
- Verification: `npm test` passed (47/47, including 4 new worker tests). Not yet run: the local `npm run serve` check, both deploys, the live email/curl/429/405 checks, and the auth sanity check.
- Left for the owner: Step 1 (Cloudflare Email Routing setup + `npx wrangler login`), Step 6 (`wrangler secret put FEEDBACK_TO`, `npm run deploy:feedback`), Step 8 (`npm run deploy`), then the remaining Verification items.
- Later the same day: at the owner's request, the entry point moved from the footer link to a "Feedback" button that `feedback.js` injects into the Lab's menu bar.
- Owner did Step 1, then `wrangler secret put FEEDBACK_TO` and `npm run deploy:feedback` (Step 6), and `npm run deploy` (Step 8). Live checks: GET returns 405, `{}` returns 400, the secret is listed, `feedback.js` serves 200, auth `/api/Worlds` still returns 401, and the owner sent feedback from the live site and it arrived. Not run: the 429 rate-limit burst and one email per category (skipped to avoid spamming the inbox; the rate limit shows as bound in the wrangler deploy output).

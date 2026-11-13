# Feedback form

A "Feedback" button that `feedback.js` adds to the Lab's menu bar (next to File and Help) opens a `<dialog>` (`standalone/index.html`, driven by `standalone/feedback.js`) that POSTs JSON to `/api/feedback`.

## Backend

- A Cloudflare Worker, `worker/feedback/` (`cheezwatch-feedback`), is routed on `cheezwatch.nullptrscape.com/api/feedback`. Worker routes run before the tunnel, so **nginx and the VPS are not involved**.
- It validates the input (`lib.js`), drops honeypot hits (`website` field), rate-limits to 5 requests per 60 s per IP, and emails a plain-text message through Email Routing's `send_email` binding, from `feedback@nullptrscape.com`.
- The recipient is the Worker secret `FEEDBACK_TO`. It is never in the repo, because the repo is public.
- Locally (`npm run serve`) there is no `/api/feedback`, so Send shows an error. That is expected.

## Deploy / change the destination

```sh
npx wrangler login                       # once
cd worker/feedback
npx wrangler secret put FEEDBACK_TO      # paste the address
npm run deploy:feedback                  # from the repo root
```

To change where feedback goes, first add the new address under **Email → Email Routing → Destination addresses** in the Cloudflare dashboard and verify it. Then run `npx wrangler secret put FEEDBACK_TO` again. You don't need to change any code. If sends fail with a 502, check that the address is verified.

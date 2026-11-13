// Pure helpers for the feedback Worker, kept apart from index.js so Node
// tests can load them without the Cloudflare runtime (cloudflare:email).

export const CATEGORIES = ["bug", "idea", "other"];

const oneLine = (s) => s.replace(/[\r\n]+/g, " ");

export function validate(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const category = str(body.category);
  const message = str(body.message);
  if (!CATEGORIES.includes(category)) return { ok: false, error: "Pick a category." };
  if (message.length < 1) return { ok: false, error: "Message is empty." };
  if (message.length > 2000) return { ok: false, error: "Message is too long (max 2000)." };
  const contact = oneLine(str(body.contact)).slice(0, 100);
  const page = oneLine(str(body.page)).slice(0, 200);
  return { ok: true, value: { category, message, contact, page } };
}

function base64Utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  // Chunked so a long message doesn't overflow the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function buildMime({ from, to, subject, text }) {
  const body = base64Utf8(text).match(/.{1,76}/g) ?? [];
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${base64Utf8(oneLine(subject))}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@nullptrscape.com>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...body,
    "",
  ].join("\r\n");
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMime, validate } from "./lib.js";

const good = { category: "bug", message: "It broke", contact: "me#1", page: "/" };

test("valid input passes", () => {
  const r = validate(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, good);
});

test("bad category, empty and overlong messages fail", () => {
  assert.equal(validate({ ...good, category: "spam" }).ok, false);
  assert.equal(validate({ ...good, message: "   " }).ok, false);
  assert.equal(validate({ ...good, message: "a".repeat(2001) }).ok, false);
  assert.equal(validate({ ...good, message: "a".repeat(2000) }).ok, true);
});

test("contact is truncated to 100 chars and loses newlines", () => {
  assert.equal(validate({ ...good, contact: "c".repeat(101) }).value.contact.length, 100);
  assert.equal(validate({ ...good, contact: "a\r\nBcc: x" }).value.contact, "a Bcc: x");
});

test("buildMime uses CRLF, has Message-ID and a decodable UTF-8 body", () => {
  const text = "Café 🧀 works\nline two";
  const mime = buildMime({ from: "f@x", to: "t@x", subject: "Café", text });
  assert.match(mime, /\r\nMessage-ID: <[^>]+@nullptrscape\.com>\r\n/);
  assert.ok(!/[^\r]\n/.test(mime));
  const body = mime.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  assert.equal(Buffer.from(body, "base64").toString("utf8"), text);
});

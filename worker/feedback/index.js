// Cloudflare Worker behind cheezwatch.nullptrscape.com/api/feedback. It
// emails player feedback to the owner so nothing new runs on the VPS.
import { EmailMessage } from "cloudflare:email";
import { buildMime, validate } from "./lib.js";

const json = (status, data) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });

    const { success } = await env.LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "x" });
    if (!success) return json(429, { error: "Too many messages, try again in a minute." });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "Invalid request." });
    }
    if (body && typeof body.website === "string" && body.website.trim()) return json(200, { ok: true });

    const result = validate(body);
    if (!result.ok) return json(400, { error: result.error });
    const { category, message, contact, page } = result.value;

    const text = [
      `Category: ${category}`,
      `Contact: ${contact || "(none)"}`,
      `Page: ${page}`,
      `Country: ${request.headers.get("CF-IPCountry") ?? "?"}`,
      `Time: ${new Date().toISOString()}`,
      "",
      message,
    ].join("\n");
    const subject = `CheezWatch feedback [${category}]: ${message.replace(/[\r\n]+/g, " ").slice(0, 60)}`;

    try {
      const raw = buildMime({ from: env.FEEDBACK_FROM, to: env.FEEDBACK_TO, subject, text });
      await env.MAILER.send(new EmailMessage(env.FEEDBACK_FROM, env.FEEDBACK_TO, raw));
    } catch (err) {
      console.error("feedback send failed", err);
      return json(502, { error: "Could not send right now." });
    }
    return json(200, { ok: true });
  },
};

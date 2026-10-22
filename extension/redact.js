// Strips credentials from observed traffic before it is stored or shown, so a
// copied log entry can't leak a session.

const JWT = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g;
const SECRET_FIELD = /("(?:[\w-]*token|password|passwd|secret|authorization|cookie|session(?:id)?|sid|api[_-]?key)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

export function redact(text) {
  if (typeof text !== "string") return text;
  return text.replace(SECRET_FIELD, '$1"[redacted]"').replace(JWT, "[redacted-jwt]");
}

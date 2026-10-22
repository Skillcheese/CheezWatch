// Passively mirrors one tab's HTTP and WebSocket traffic. Every command goes
// through readOnlyDebugger; events are only listened to.
import { readOnlyDebugger } from "../readonly-policy.js";
import { redact } from "../redact.js";

// Only bodies of these types are read; game assets (images, audio, js) are skipped.
const BODY_MIME = /json|text\/plain|text\/event-stream|text\/html/;
// Binary or untyped bodies may hold encoded state (msgpack, protobuf); shown as hex if not UTF-8.
const BINARY_MIME = /^$|octet-stream|msgpack|protobuf/;
// Missing assets come back as HTML error pages; drop them by URL so they don't flood the log.
// LPC character-sprite definitions (layers, variants, credits) are JSON but pure cosmetics.
const SPRITE_DEF_URL = /\/LPC\//i;
const ASSET_URL = /\.(png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav|woff2?|ttf|css|js|map)(\?|#|$)/i;
// The game page's HTML may embed initial player state, so allow large bodies.
const MAX_PREVIEW = 1024 * 1024;

// Fallback for sprite definitions served outside an /LPC/ path.
function isSpriteDefinition(text) {
  if (!text.startsWith("{") || !text.includes('"credits"')) return false;
  try {
    const j = JSON.parse(text);
    return "layer_1" in j && "type_name" in j && Array.isArray(j.credits);
  } catch { return false; }
}

function base64Bytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Binary frames arrive base64-encoded. Show them as text when they are UTF-8,
// otherwise as hex so the format (e.g. msgpack) can be recognised.
function binaryFrame(b64) {
  const bytes = base64Bytes(b64);
  try {
    return { body: new TextDecoder("utf-8", { fatal: true }).decode(bytes), binary: "utf-8" };
  } catch {
    const hex = Array.from(bytes.subarray(0, MAX_PREVIEW / 3), (b) => b.toString(16).padStart(2, "0")).join(" ");
    return { body: hex, binary: `hex, ${bytes.length} bytes` };
  }
}

/** Attaches to `tabId` and calls `emit(event)` per observed message. Resolves to a stop function. */
export async function observeTab(tabId, emit, onDetach) {
  const dbg = readOnlyDebugger(chrome.debugger, tabId);
  const pending = new Map();

  const onEvent = async (source, method, params) => {
    if (source.tabId !== tabId) return;
    switch (method) {
      case "Network.responseReceived":
        const mime = params.response.mimeType ?? "";
        if ((BODY_MIME.test(mime) || BINARY_MIME.test(mime)) && !ASSET_URL.test(params.response.url) && !SPRITE_DEF_URL.test(params.response.url)) {
          pending.set(params.requestId, { url: params.response.url, status: params.response.status });
        }
        break;
      case "Network.loadingFinished": {
        const meta = pending.get(params.requestId);
        if (!meta) break;
        pending.delete(params.requestId);
        try {
          const { body, base64Encoded } = await dbg.sendCommand("Network.getResponseBody", { requestId: params.requestId });
          const frame = base64Encoded ? binaryFrame(body) : { body };
          if (isSpriteDefinition(frame.body)) break;
          emit({ kind: "http", ...meta, ...frame, body: redact(frame.body).slice(0, MAX_PREVIEW), time: Date.now() });
        } catch { /* body evicted from buffer; nothing to observe */ }
        break;
      }
      case "Network.loadingFailed":
        pending.delete(params.requestId);
        break;
      case "Network.webSocketCreated":
        emit({ kind: "ws-open", url: redact(params.url), time: Date.now() });
        break;
      case "Network.webSocketFrameReceived":
      case "Network.webSocketFrameSent":
      {
        const { opcode, payloadData } = params.response;
        const frame = opcode === 2 ? binaryFrame(payloadData) : { body: payloadData };
        emit({
          kind: method.endsWith("Received") ? "ws-in" : "ws-out",
          ...frame,
          body: redact(frame.body).slice(0, MAX_PREVIEW),
          opcode,
          time: Date.now(),
        });
      }
        break;
    }
  };
  const handleDetach = (source, reason) => {
    if (source.tabId !== tabId) return;
    cleanup();
    onDetach(reason);
  };
  const cleanup = () => {
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(handleDetach);
  };

  await dbg.attach();
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(handleDetach);
  await dbg.sendCommand("Network.enable", { maxTotalBufferSize: 50 * 1024 * 1024 });

  return () => {
    cleanup();
    dbg.detach().catch(() => {});
  };
}

// Passively mirrors one tab's HTTP and WebSocket traffic. Every command goes
// through readOnlyDebugger; events are only listened to.
import { readOnlyDebugger } from "../readonly-policy.js";

// Only bodies of these types are read; game assets (images, audio, js) are skipped.
const BODY_MIME = /json|text\/plain|text\/event-stream/;
const MAX_PREVIEW = 64 * 1024;

function decodeBase64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

/** Attaches to `tabId` and calls `emit(event)` per observed message. Resolves to a stop function. */
export async function observeTab(tabId, emit, onDetach) {
  const dbg = readOnlyDebugger(chrome.debugger, tabId);
  const pending = new Map();

  const onEvent = async (source, method, params) => {
    if (source.tabId !== tabId) return;
    switch (method) {
      case "Network.responseReceived":
        if (BODY_MIME.test(params.response.mimeType)) {
          pending.set(params.requestId, { url: params.response.url, status: params.response.status });
        }
        break;
      case "Network.loadingFinished": {
        const meta = pending.get(params.requestId);
        if (!meta) break;
        pending.delete(params.requestId);
        try {
          const { body, base64Encoded } = await dbg.sendCommand("Network.getResponseBody", { requestId: params.requestId });
          const text = base64Encoded ? decodeBase64(body) : body;
          emit({ kind: "http", ...meta, body: text.slice(0, MAX_PREVIEW), time: Date.now() });
        } catch { /* body evicted from buffer; nothing to observe */ }
        break;
      }
      case "Network.loadingFailed":
        pending.delete(params.requestId);
        break;
      case "Network.webSocketCreated":
        emit({ kind: "ws-open", url: params.url, time: Date.now() });
        break;
      case "Network.webSocketFrameReceived":
      case "Network.webSocketFrameSent":
        emit({
          kind: method.endsWith("Received") ? "ws-in" : "ws-out",
          body: params.response.payloadData.slice(0, MAX_PREVIEW),
          opcode: params.response.opcode,
          time: Date.now(),
        });
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

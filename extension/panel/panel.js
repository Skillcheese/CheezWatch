// Panel UI: shows what the game page sends and receives so we can learn its
// data shapes, before building dedicated read-only views on top of them.
import { observeTab } from "./observer.js";

const MAX_ROWS = 500;
// Login sends state once, then a burst of ticks follows; keep far more than we
// render so early messages stay searchable.
const MAX_EVENTS = 20000;
const GAME_URLS = ["https://scapewatch.com/*", "https://*.scapewatch.com/*"];
const GAME_URL_RE = /^https:\/\/([^/]+\.)?scapewatch\.com\//;
const statusText = document.getElementById("status-text");
const attachBtn = document.getElementById("attach");
const listeners = [];
let stop = null;

/** Subscribe to observed game traffic; may be called more than once. */
export function onObserved(cb) { listeners.push(cb); }
const emit = (ev) => { for (const cb of listeners) cb(ev); };

function setStatus(text, canAttach) {
  statusText.textContent = text;
  attachBtn.hidden = !canAttach;
}

async function attach(tab) {
  if (stop) return;
  try {
    stop = await observeTab(tab.id, emit, (reason) => {
      stop = null;
      setStatus(`Detached (${reason})`, true);
    });
    setStatus(`Observing tab: ${tab.title || tab.url}. Reload the game to capture everything.`, false);
  } catch (err) {
    setStatus(`Attach failed: ${err.message}`, true);
  }
}

async function findGameTab() {
  const tabs = await chrome.tabs.query({ url: GAME_URLS, currentWindow: true });
  return tabs.find((t) => t.active) ?? tabs[0];
}

attachBtn.addEventListener("click", async () => {
  const tab = await findGameTab();
  if (tab) attach(tab); else setStatus("No ScapeWatch tab in this window", true);
});
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (!stop && info.status === "loading" && GAME_URL_RE.test(tab.url ?? "")) attach(tab);
});
window.addEventListener("pagehide", () => stop?.());
findGameTab().then((tab) => (tab ? attach(tab) : setStatus("Open scapewatch.com in this window", true)));
const log = document.getElementById("log");
const filter = document.getElementById("filter");
const paused = document.getElementById("paused");

for (const btn of document.querySelectorAll("nav [data-tab]")) {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav [data-tab], .tab").forEach((n) => n.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
}
const events = [];

// Message types that arrive constantly and hold nothing we need
// (player_state fires for every nearby player; request_appearance is sent for
// each newly seen player; player_gone when one leaves view; plus chat and
// server population updates). Hidden only when a frame holds
// nothing else, so batches mixing in other types still show.
const NOISY_TYPES = new Set([
  "player_state", "request_appearance", "player_gone",
  "chat_message", "chat_room_counts", "online_summary",
]);

// Our own player_state may carry extra fields (e.g. skills) that others' lack,
// so the first frame with each new set of data keys is always shown.
const seenStateShapes = new Set();

function isNewStateShape(m) {
  if (m?.type !== "player_state" || !m.data || typeof m.data !== "object") return false;
  const shape = Object.keys(m.data).sort().join(",");
  if (seenStateShapes.has(shape)) return false;
  seenStateShapes.add(shape);
  return true;
}

function isNoise(ev) {
  if (!ev.kind.startsWith("ws-") || !ev.body?.startsWith("{")) return false;
  try {
    const msg = JSON.parse(ev.body);
    const parts = msg.type === "batch" && Array.isArray(msg.data) ? msg.data : [msg];
    if (parts.map(isNewStateShape).some(Boolean)) return false;
    return parts.length > 0 && parts.every((m) => NOISY_TYPES.has(m?.type));
  } catch { return false; }
}

document.getElementById("clear").addEventListener("click", () => { events.length = 0; log.textContent = ""; });
filter.addEventListener("input", render);

function matches(ev) {
  const q = filter.value.trim().toLowerCase();
  return q === "" || ev.search.includes(q);
}

function pretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function row(ev) {
  const li = document.createElement("li");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = ev.binary ? `${ev.kind} (bin)` : ev.kind;
  const label = ev.url ? `${ev.status ?? ""} ${ev.url}` : (ev.body ?? "").slice(0, 120);
  summary.append(kind, ` ${new Date(ev.time).toLocaleTimeString()} ${label}`);
  const pre = document.createElement("pre");
  // Pretty-print lazily: large HTML bodies would make every render slow.
  details.addEventListener("toggle", () => {
    if (details.open && !pre.textContent) {
      pre.textContent = (ev.binary ? `[binary: ${ev.binary}]
` : "") + (ev.body != null ? pretty(ev.body) : "");
    }
  });
  details.append(summary, pre);
  li.append(details);
  return li;
}

function render() {
  const rows = [];
  for (let i = events.length - 1; i >= 0 && rows.length < MAX_ROWS; i--) {
    if (matches(events[i])) rows.push(row(events[i]));
  }
  log.replaceChildren(...rows);
}

onObserved((ev) => {
  if (paused.checked || isNoise(ev)) return;
  ev.search = `${ev.url ?? ""} ${ev.body ?? ""}`.toLowerCase();
  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  if (!matches(ev)) return;
  log.prepend(row(ev));
  while (log.children.length > MAX_ROWS) log.lastElementChild.remove();
});

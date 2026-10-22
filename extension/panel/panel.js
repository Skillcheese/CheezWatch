// Panel UI: shows what the game page sends and receives so we can learn its
// data shapes, before building dedicated read-only views on top of them.
import { observeTab } from "./observer.js";

const MAX_ROWS = 500;
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
document.getElementById("clear").addEventListener("click", () => { log.textContent = ""; });
filter.addEventListener("input", () => { for (const li of log.children) applyFilter(li); });

function applyFilter(li) {
  const q = filter.value.trim().toLowerCase();
  li.hidden = q !== "" && !li.dataset.search.includes(q);
}

function pretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

onObserved((ev) => {
  if (paused.checked) return;
  const li = document.createElement("li");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = ev.kind;
  const label = ev.url ? `${ev.status ?? ""} ${ev.url}` : (ev.body ?? "").slice(0, 120);
  summary.append(kind, ` ${new Date(ev.time).toLocaleTimeString()} ${label}`);
  const pre = document.createElement("pre");
  pre.textContent = ev.body != null ? pretty(ev.body) : "";
  details.append(summary, pre);
  li.append(details);
  li.dataset.search = `${ev.url ?? ""} ${ev.body ?? ""}`.toLowerCase();
  applyFilter(li);
  log.prepend(li);
  while (log.children.length > MAX_ROWS) log.lastElementChild.remove();
});

// Dark by default, with a "Light mode" toggle in the Lab's File menu.
// The Lab's stylesheet hardcodes its colors and is upstream code we don't
// edit, so its dark look is an inverted filter applied from outside.
const KEY = "cheezwatch-theme";
const frame = document.getElementById("lab");

const LAB_CSS = `
html.cw-dark { filter: invert(0.9) hue-rotate(180deg); background: #fff; }
html.cw-dark img, html.cw-dark canvas, html.cw-dark video { filter: invert(1) hue-rotate(180deg); }
`;

function load() {
  try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
}
let theme = load();

function apply() {
  const dark = theme === "dark";
  document.documentElement.classList.toggle("light", !dark);
  const doc = frame.contentDocument;
  if (!doc?.head) return;
  if (!doc.getElementById("cw-theme-style")) doc.head.append(Object.assign(doc.createElement("style"), { id: "cw-theme-style", textContent: LAB_CSS }));
  doc.documentElement.classList.toggle("cw-dark", dark);
  const btn = doc.getElementById("cw-theme-toggle");
  if (btn) btn.textContent = dark ? "Light mode" : "Dark mode";
}

function toggle() {
  theme = theme === "dark" ? "light" : "dark";
  try { localStorage.setItem(KEY, theme); } catch {}
  apply();
}

function addMenuItem() {
  const doc = frame.contentDocument;
  const menu = doc?.getElementById("file-menu");
  if (menu && !doc.getElementById("cw-theme-toggle")) {
    const btn = doc.createElement("button");
    btn.id = "cw-theme-toggle";
    btn.addEventListener("click", toggle);
    menu.prepend(btn);
  }
  apply();
}

apply();
frame.addEventListener("load", addMenuItem);
if (frame.contentDocument?.readyState === "complete") addMenuItem();

// Gauntlet Lab and the Map Optimizer share one page; #map in the URL picks the tab.
const buttons = [...document.querySelectorAll("nav.tabs button")];
const panes = { lab: document.getElementById("lab"), map: document.getElementById("map-tab") };

function show(tab) {
  for (const b of buttons) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  for (const [k, el] of Object.entries(panes)) el.hidden = k !== tab;
  document.body.dataset.tab = tab;
  document.dispatchEvent(new CustomEvent("cheezwatch-tab", { detail: tab }));
}

for (const b of buttons) b.addEventListener("click", () => {
  history.replaceState(null, "", b.dataset.tab === "lab" ? location.pathname : "#map");
  show(b.dataset.tab);
});
window.addEventListener("hashchange", () => show(location.hash === "#map" ? "map" : "lab"));
show(location.hash === "#map" ? "map" : "lab");

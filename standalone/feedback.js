// Footer "Send feedback" dialog. Posts what the player typed to our own
// Cloudflare Worker at /api/feedback, which emails it to the owner.
// Nothing here talks to the game.
const dialog = document.getElementById("feedback");
const form = dialog.querySelector("form");
const status = document.getElementById("feedback-status");
const counter = document.getElementById("feedback-count");
const send = form.querySelector("button[type=submit]");

const updateCount = () => { counter.textContent = `${form.message.value.length}/2000`; };

function open() {
  status.textContent = "";
  updateCount();
  dialog.showModal();
}

// The button lives in the Lab's own menu bar (next to File and Help), added
// from outside so the Lab submodule stays unmodified.
const frame = document.getElementById("lab");
function addMenuButton() {
  const bar = frame.contentDocument?.querySelector(".menu-bar");
  if (!bar || bar.querySelector("#feedback-menu-button")) return;
  const btn = frame.contentDocument.createElement("button");
  btn.id = "feedback-menu-button";
  btn.className = "menu-button";
  btn.textContent = "Feedback";
  btn.addEventListener("click", open);
  const wrap = frame.contentDocument.createElement("div");
  wrap.className = "menu-wrap";
  wrap.append(btn);
  bar.append(wrap);
}
frame.addEventListener("load", addMenuButton);
if (frame.contentDocument?.readyState === "complete") addMenuButton();

form.message.addEventListener("input", updateCount);

form.addEventListener("submit", async (e) => {
  if (e.submitter?.getAttribute("formmethod") === "dialog") return;
  e.preventDefault();
  send.disabled = true;
  status.textContent = "Sending…";
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: form.category.value,
        message: form.message.value,
        contact: form.contact.value,
        website: form.website.value,
        page: location.pathname,
      }),
    });
    if (res.ok) {
      form.reset();
      updateCount();
      status.textContent = "Thanks! Sent.";
    } else if (res.status === 429) {
      status.textContent = "Too many messages, try again in a minute.";
    } else {
      const data = await res.json().catch(() => ({}));
      status.textContent = data.error || "Couldn't send. Try again later.";
    }
  } catch {
    status.textContent = "Couldn't send. Try again later.";
  } finally {
    send.disabled = false;
  }
});

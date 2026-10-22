// ScapeWatch Companion: hosts scapewatch.com unmodified in one view and a
// read-only side panel in another. The game view gets no preload, no injected
// script, and no request interception. We only listen to network events the
// browser already produces (see readonly-policy.js).
const { app, BaseWindow, WebContentsView, protocol, net, ipcMain, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { readOnlyDebugger } = require("./readonly-policy");

const GAME_URL = "https://scapewatch.com/";
const PANEL_WIDTH = 460;
const ROOT = path.join(__dirname, "..");
// Local assets are served from a custom scheme so the Gauntlet Lab web worker
// and fetch() of its config work (they don't under file://).
const LOCAL_ROOTS = {
  panel: path.join(__dirname, "panel"),
  lab: path.join(ROOT, "gauntlet_lab", "dist"),
};
// Only bodies of these types are read; game assets (images, audio, js) are skipped.
const BODY_MIME = /json|text\/plain|text\/event-stream/;
const MAX_PREVIEW = 64 * 1024;

protocol.registerSchemesAsPrivileged([
  { scheme: "companion", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveLocal() {
  protocol.handle("companion", (req) => {
    const { host, pathname } = new URL(req.url);
    const base = LOCAL_ROOTS[host];
    const file = path.normalize(path.join(base ?? "", decodeURIComponent(pathname)));
    if (!base || !file.startsWith(base)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BaseWindow({ width: 1600, height: 950, title: "ScapeWatch Companion" });

  const game = new WebContentsView({
    webPreferences: { partition: "persist:scapewatch", contextIsolation: true, sandbox: true },
  });
  const panel = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "panel-preload.js"), contextIsolation: true, sandbox: true },
  });
  win.contentView.addChildView(game);
  win.contentView.addChildView(panel);

  let panelVisible = true;
  const layout = () => {
    const { width, height } = win.getContentBounds();
    const pw = panelVisible ? PANEL_WIDTH : 0;
    game.setBounds({ x: 0, y: 0, width: width - pw, height });
    panel.setBounds({ x: width - pw, y: 0, width: pw, height });
  };
  win.on("resize", layout);
  layout();
  ipcMain.on("panel:toggle", () => { panelVisible = !panelVisible; layout(); });

  // Links the game opens in a new window go to the system browser.
  game.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });

  observeNetwork(game.webContents, (event) => {
    if (!panel.webContents.isDestroyed()) panel.webContents.send("observed", event);
  });

  panel.webContents.loadURL("companion://panel/index.html");
  game.webContents.loadURL(GAME_URL);
  win.on("closed", () => { game.webContents.close(); panel.webContents.close(); });
}

/** Passively mirrors the game's HTTP and WebSocket traffic to `emit`. */
function observeNetwork(webContents, emit) {
  const dbg = readOnlyDebugger(webContents.debugger);
  const pending = new Map();

  dbg.attach("1.3");
  dbg.sendCommand("Network.enable", { maxTotalBufferSize: 50 * 1024 * 1024 });

  dbg.on("message", async (_e, method, params) => {
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
          const text = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
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
  });
  webContents.on("did-start-navigation", () => pending.clear());
}

app.whenReady().then(() => { serveLocal(); createWindow(); });
app.on("window-all-closed", () => app.quit());

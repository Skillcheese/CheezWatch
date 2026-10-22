// The extension can only load files inside its own folder, so the built lab is copied in.
import { cpSync, rmSync } from "node:fs";

const src = new URL("../gauntlet_lab/dist/", import.meta.url);
const dest = new URL("../extension/lab/", import.meta.url);
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true, filter: (f) => !f.endsWith(".map") });
console.log("Copied Gauntlet Lab into extension/lab");

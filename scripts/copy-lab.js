// Copies the built lab next to the page so it is served from the same origin (shared localStorage).
import { cpSync, rmSync } from "node:fs";

const src = new URL("../gauntlet_lab/dist/", import.meta.url);
const dest = new URL("../standalone/lab/", import.meta.url);
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true, filter: (f) => !f.endsWith(".map") });
console.log("Copied Gauntlet Lab into standalone/lab");

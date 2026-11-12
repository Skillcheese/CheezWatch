// Copies Tesseract (script, worker, wasm core, English data) into
// standalone/vendor so the screenshot import works offline.
import fs from "node:fs";
import path from "node:path";

const nm = path.resolve("node_modules");
const out = path.resolve("standalone/vendor");
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

for (const f of ["tesseract.min.js", "worker.min.js"]) copy(path.join(nm, "tesseract.js/dist", f), path.join(out, f));
const core = path.join(nm, "tesseract.js-core");
for (const f of fs.readdirSync(core).filter((f) => /^tesseract-core.*\.(js|wasm)$/.test(f))) {
  copy(path.join(core, f), path.join(out, "core", f));
}
copy(path.join(nm, "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), path.join(out, "lang/eng.traineddata.gz"));
console.log(`Copied Tesseract into ${path.relative(process.cwd(), out)}`);

// Gathers the standalone page and what it loads into site/, keeping the
// relative layout (standalone/ -> ../extension/lab, ../extension/parsers)
// so the folder can be served as-is by any static web server.
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("site");
const skip = (f) => /\.test\.js$/.test(f);
const copyDir = (from, to) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyDir(src, dst);
    else if (!skip(e.name)) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
};

for (const need of ["extension/lab/index.html", "standalone/vendor/tesseract.min.js", "standalone/icons/fort"]) {
  if (!fs.existsSync(need)) {
    console.error(`Missing ${need}. Run standalone.cmd (or build:lab, extract-icons, build:standalone) first.`);
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
copyDir("standalone", path.join(out, "standalone"));
copyDir("extension/lab", path.join(out, "extension/lab"));
copyDir("extension/parsers", path.join(out, "extension/parsers"));
fs.writeFileSync(path.join(out, "index.html"), '<!doctype html><meta http-equiv="refresh" content="0; url=standalone/">\n');
console.log(`Site bundled into ${path.relative(process.cwd(), out)}/`);

// Copies the website (standalone/, with the built lab, icons and vendor files)
// into site/ so the folder can be served as-is by any static web server.
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

for (const need of ["standalone/lab/index.html", "standalone/vendor/tesseract.min.js", "standalone/icons/fort"]) {
  if (!fs.existsSync(need)) {
    console.error(`Missing ${need}. Run standalone.cmd (or build:lab, extract-icons, build:standalone) first.`);
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
copyDir("standalone", out);
console.log(`Site bundled into ${path.relative(process.cwd(), out)}/`);

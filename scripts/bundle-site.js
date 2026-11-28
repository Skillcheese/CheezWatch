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

for (const need of ["standalone/lab/index.html", "standalone/vendor/tesseract.min.js", "standalone/icons/fort", "standalone/data/map.json"]) {
  if (!fs.existsSync(need)) {
    console.error(`Missing ${need}. Run standalone.cmd (or build:lab, extract-icons, build:standalone) first.`);
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
copyDir("standalone", out);
console.log(`Site bundled into ${path.relative(process.cwd(), out)}/`);

// Cloudflare caches files in the browser for hours whatever the server says,
// so each bundle stamps its script and style URLs; a deploy then never mixes
// old and new modules.
const stamp = Date.now().toString(36);
const relative = /(["'])((?:\.{1,2}\/|lab\/)?[\w./-]+?\.(?:js|css))\1/g;
const tag = (text) => text.replace(relative, (m, q, url) => /^(https?:|\/)/.test(url) ? m : `${q}${url}?v=${stamp}${q}`);
const stampDir = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "vendor" && e.name !== "icons") stampDir(file); continue; }
    if (/\.html$/.test(e.name)) {
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/((?:src|href)=)"(?!https?:|\/|#)([\w./-]+\.(?:js|css))"/g, `$1"$2?v=${stamp}"`));
    } else if (/\.js$/.test(e.name) && dir !== path.join(out, "lab")) {
      fs.writeFileSync(file, tag(fs.readFileSync(file, "utf8")));
    } else if (file === path.join(out, "lab", "app.js")) {
      // The Lab's own code is left alone except its worker, which a stale
      // cached copy would otherwise run against a newer page.
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes('new Worker("worker.js")')) throw new Error("Lab worker URL not found in lab/app.js");
      fs.writeFileSync(file, src.replace('new Worker("worker.js")', `new Worker("worker.js?v=${stamp}")`));
    }
  }
};
stampDir(out);
console.log(`Stamped script URLs with v=${stamp}`);

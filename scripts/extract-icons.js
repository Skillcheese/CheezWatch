// Copies the skill icons and the numbers font out of the game's app.asar into
// standalone/icons, so the screenshot reader can tell which skill a column or
// box belongs to and read the levels. They stay local (gitignored): they're
// the game's assets, not ours.
import { extractFile, listPackage } from "@electron/asar";
import fs from "node:fs";
import path from "node:path";

const asar = path.resolve(process.argv[2] ?? "app.asar");
const out = path.resolve("standalone/icons");
if (!fs.existsSync(asar)) {
  console.error(`No app.asar at ${asar}. Pass its path: node scripts/extract-icons.js <path to app.asar>`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const icons = listPackage(asar).filter((p) => /[\\/]assets[\\/]icons[\\/]skills[\\/][^\\/]+\.png$/.test(p));
for (const p of icons) {
  fs.writeFileSync(path.join(out, path.basename(p)), extractFile(asar, p.replace(/^[\\/]/, "")));
}
// Fortress collection items (Banners, Ledgers, Beacons, Satchels and the rest
// of the Fortress drops), for reading the Collections screenshot.
const fortOut = path.join(out, "fort");
fs.mkdirSync(fortOut, { recursive: true });
const fortRe = /[\\/]assets[\\/]icons[\\/]items[\\/](gauntlet_(banner|ledger)|beacon_[a-z]+|satchel|chef_spice|trader_notes|corruptors_idol|hot_sauce|enchanted_fortification)_(t[1-5]|c|c7)\.png$/;
const fort = listPackage(asar).filter((p) => fortRe.test(p));
for (const p of fort) {
  fs.writeFileSync(path.join(fortOut, path.basename(p)), extractFile(asar, p.replace(/^[\\/]/, "")));
}
const font = path.join("assets", "fonts", "ChakraPetch-Bold.ttf");
fs.writeFileSync(path.join(out, path.basename(font)), extractFile(asar, font));
console.log(`Copied ${icons.length} skill icons, ${fort.length} Fortress icons and the digit font to ${path.relative(process.cwd(), out)}`);

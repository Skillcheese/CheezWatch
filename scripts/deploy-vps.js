// Builds site/ and pushes it to the VPS as a new release (see docs/vps.md).
// Usage: npm run deploy | npm run deploy -- --rollback
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, "scripts", "vps.env");
const BASE = "/srv/cheezwatch";
const URL = "https://cheezwatch.nullptrscape.com/";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function readEnv() {
  if (!existsSync(envPath)) fail("Missing scripts/vps.env (VPS_SSH, VPS_PORT, VPS_KEY).");
  const env = {};
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of ["VPS_SSH", "VPS_PORT", "VPS_KEY"]) {
    if (!env[k]) fail(`scripts/vps.env is missing ${k}.`);
  }
  if (env.VPS_KEY.startsWith("~")) env.VPS_KEY = join(homedir(), env.VPS_KEY.slice(1));
  return env;
}

const env = readEnv();
// BatchMode stops ssh silently falling back to a password prompt.
const common = ["-i", env.VPS_KEY, "-o", "BatchMode=yes"];

function run(cmd, args, what) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status}).`);
}

function ssh(script) {
  run("ssh", [...common, "-p", env.VPS_PORT, env.VPS_SSH, script], "ssh");
}

function scp(localDir, remote) {
  run("scp", [...common, "-P", env.VPS_PORT, "-r", "-q", localDir, `${env.VPS_SSH}:${remote}`], "scp");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function deploy() {
  run(process.execPath, [join(root, "scripts", "bundle-site.js")], "build:site");
  const s = stamp();
  scp(join(root, "site"), `/tmp/cheezwatch-${s}`);
  ssh([
    "set -e",
    `R=${BASE}/releases`,
    "sudo mkdir -p $R",
    `sudo mv /tmp/cheezwatch-${s} $R/${s}`,
    `sudo chown -R root:root $R/${s}`,
    `sudo chmod -R a+rX $R/${s}`,
    `sudo ln -sfn releases/${s} ${BASE}/current.tmp`,
    `sudo mv -T ${BASE}/current.tmp ${BASE}/current`,
    "cd $R && ls -1 | sort | head -n -5 | xargs -r sudo rm -rf --",
  ].join("\n"));
  console.log(`Deployed ${s}. ${URL}`);
}

function rollback() {
  ssh([
    "set -e",
    `cd ${BASE}`,
    "cur=$(basename \"$(readlink current)\")",
    "prev=$(ls -1 releases | sort | awk -v c=\"$cur\" '$0 < c' | tail -n 1)",
    "if [ -z \"$prev\" ]; then echo \"No release older than $cur.\" >&2; exit 1; fi",
    "sudo ln -sfn releases/$prev current.tmp",
    "sudo mv -T current.tmp current",
    "echo \"Rolled back: $cur -> $prev is now live.\"",
  ].join("\n"));
}

try {
  if (process.argv.includes("--rollback")) rollback();
  else deploy();
} catch (e) {
  fail(e.message);
}

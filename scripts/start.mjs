import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
let shuttingDown = false;

function runSync(label, cwd, args) {
  console.log(`\n>>> ${label}...`);
  const result = spawnSync(npm, args, {
    cwd: path.join(root, cwd),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const serverBuild = path.join(root, "server", "dist", "index.js");
const frontendBuild = path.join(root, "client", ".next");

if (!fs.existsSync(serverBuild) || !fs.existsSync(frontendBuild)) {
  console.log("\nProduction build not found. Building Sakhya first...\n");
  runSync("Building backend", "server", ["run", "build"]);
  runSync("Building frontend", "client", ["run", "build"]);
}

function run(name, cwd, args) {
  const child = spawn(npm, args, {
    cwd: path.join(root, cwd),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env
  });
  children.push(child);

  child.on("error", (err) => {
    if (!shuttingDown) {
      console.error(`\n${name} failed to start: ${err.message}`);
      shutdown(1);
    }
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`\n${name} stopped${code !== null ? ` with code ${code}` : ` (${signal})`}.`);
      shutdown(code ?? 1);
    }
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try { if (!child.killed) child.kill(); } catch {}
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("\n========================================");
console.log(" SAKHYA PRODUCTION MODE");
console.log(" Frontend: http://localhost:3000");
console.log(" Backend : http://localhost:4000");
console.log("========================================\n");

run("Backend", "server", ["start"]);
run("Frontend", "client", ["start"]);

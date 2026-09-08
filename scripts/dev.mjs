import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
let shuttingDown = false;

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
console.log(" SAKHYA DEVELOPMENT MODE");
console.log(" Frontend: http://localhost:3000");
console.log(" Backend : http://localhost:4000");
console.log("========================================\n");

run("Backend", "server", ["run", "dev"]);
run("Frontend", "client", ["run", "dev"]);

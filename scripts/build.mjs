import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, cwd, args) {
  console.log(`\n>>> Building ${label}...`);
  const result = spawnSync(npm, args, {
    cwd: path.join(root, cwd),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env
  });

  if (result.error) {
    console.error(`\n${label} build failed: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n${label} build failed.`);
    process.exit(result.status ?? 1);
  }
}

run("backend", "server", ["run", "build"]);
run("frontend", "client", ["run", "build"]);

console.log("\n========================================");
console.log(" SAKHYA PRODUCTION BUILD COMPLETE");
console.log("========================================\n");

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const serverEnv = path.join(root, "server", ".env");
const serverExample = path.join(root, "server", ".env.example");
const clientEnv = path.join(root, "client", ".env.local");
const clientExample = path.join(root, "client", ".env.local.example");

function ensureFile(target, source, fallback) {
  if (fs.existsSync(target)) return;
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, target);
    return;
  }
  fs.writeFileSync(target, fallback, "utf8");
}

ensureFile(
  serverEnv,
  serverExample,
  `PORT=4000
JWT_SECRET=change_this_to_a_long_random_string
JWT_EXPIRES_IN=7d
CLIENT_ORIGIN=http://localhost:3000
DB_PATH=./data/sakhya.db
`
);

ensureFile(
  clientEnv,
  clientExample,
  `NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
`
);

console.log("Sakhya environment files are ready.");

import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const client = path.join(dist, "client");
const server = path.join(dist, "server");

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });

await Promise.all([
  copyFile(path.join(root, "index.html"), path.join(client, "index.html")),
  copyFile(path.join(root, "styles.css"), path.join(client, "styles.css")),
  cp(path.join(root, "src"), path.join(client, "src"), { recursive: true }),
  cp(path.join(root, "public"), client, { recursive: true }),
  copyFile(path.join(root, "worker", "index.js"), path.join(server, "index.js")),
]);

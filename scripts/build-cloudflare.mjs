import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive:true, force:true });
await mkdir(dist, { recursive:true });

for (const file of ["index.html","styles.css"]) {
  await copyFile(resolve(root,file), resolve(dist,file));
}

for (const directory of ["src","vendor"]) {
  await cp(resolve(root,directory), resolve(dist,directory), { recursive:true });
}

console.log("Cloudflare Pages bundle created in dist/");

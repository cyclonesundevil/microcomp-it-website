import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../frontend/cyber-lab-engine.js");
const targetDirectory = resolve(here, "../generated");
const target = resolve(targetDirectory, "cyber-lab-engine.cjs");
const manifest = resolve(targetDirectory, "engine-manifest.json");
await mkdir(targetDirectory, { recursive: true });
await copyFile(source, target);
const bytes = await readFile(source);
await writeFile(manifest, JSON.stringify({
  source: "frontend/cyber-lab-engine.js",
  sha256: createHash("sha256").update(bytes).digest("hex")
}, null, 2) + "\n");

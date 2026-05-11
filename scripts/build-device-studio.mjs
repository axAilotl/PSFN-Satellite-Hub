import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, "src", "ts", "device-studio-app");
const compiledDir = path.join(rootDir, "dist", "ts", "device-studio-app");
const outputDir = path.join(rootDir, "dist", "device-studio");

const assets = [
  ["index.html", "index.html"],
  ["styles.css", "styles.css"],
  [path.join(compiledDir, "main.js"), "main.js"],
];

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

for (const [sourceName, outputName] of assets) {
  const sourcePath = path.isAbsolute(sourceName)
    ? sourceName
    : path.join(sourceDir, sourceName);
  await fs.copyFile(sourcePath, path.join(outputDir, outputName));
}

console.log(`Built Device Studio at ${path.relative(rootDir, outputDir)}`);

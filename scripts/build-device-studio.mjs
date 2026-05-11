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
];

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

for (const [sourceName, outputName] of assets) {
  const sourcePath = path.isAbsolute(sourceName)
    ? sourceName
    : path.join(sourceDir, sourceName);
  await fs.copyFile(sourcePath, path.join(outputDir, outputName));
}

await copyCompiledJs(compiledDir, outputDir);
await copyCompiledJs(
  path.join(rootDir, "dist", "ts", "device-studio"),
  path.join(outputDir, "device-studio"),
);

console.log(`Built Device Studio at ${path.relative(rootDir, outputDir)}`);

async function copyCompiledJs(sourceDirName, outputDirName) {
  await fs.mkdir(outputDirName, { recursive: true });
  const entries = await fs.readdir(sourceDirName, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await copyCompiledJs(path.join(sourceDirName, entry.name), outputDirName);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js") || entry.name.endsWith(".test.js")) {
      continue;
    }
    await fs.copyFile(path.join(sourceDirName, entry.name), path.join(outputDirName, entry.name));
  }
}

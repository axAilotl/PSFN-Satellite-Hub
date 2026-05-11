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

await copyCompiledTree(compiledDir, outputDir);
await copyCompiledTree(path.join(rootDir, "dist", "ts", "device-studio"), path.join(outputDir, "device-studio"));
await copyCompiledTree(path.join(rootDir, "dist", "ts", "shared"), path.join(outputDir, "shared"));

console.log(`Built Device Studio at ${path.relative(rootDir, outputDir)}`);

async function copyCompiledTree(from, to) {
  await fs.cp(from, to, {
    recursive: true,
    filter: (sourcePath) => !sourcePath.endsWith(".test.js"),
  });
}

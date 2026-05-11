import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, "src", "ts", "device-studio-app");
const compiledDir = path.join(rootDir, "dist", "ts", "device-studio-app");
const compiledStudioDir = path.join(rootDir, "dist", "ts", "device-studio");
const outputDir = path.join(rootDir, "dist", "device-studio");

const assets = [
  ["index.html", "index.html"],
  ["styles.css", "styles.css"],
  [path.join(compiledDir, "main.js"), "main.js"],
  [path.join(compiledDir, "stackchan-preview.js"), "stackchan-preview.js"],
  [path.join(compiledStudioDir, "behavior.js"), path.join("device-studio", "behavior.js")],
  [path.join(compiledStudioDir, "fixtures.js"), path.join("device-studio", "fixtures.js")],
  [path.join(compiledStudioDir, "model.js"), path.join("device-studio", "model.js")],
  [path.join(compiledStudioDir, "profiles.js"), path.join("device-studio", "profiles.js")],
];

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

for (const [sourceName, outputName] of assets) {
  const sourcePath = path.isAbsolute(sourceName)
    ? sourceName
    : path.join(sourceDir, sourceName);
  const outputPath = path.join(outputDir, outputName);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(sourcePath, outputPath);
}

console.log(`Built Device Studio at ${path.relative(rootDir, outputDir)}`);

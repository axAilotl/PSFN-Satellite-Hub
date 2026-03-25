import fs from "node:fs";

import { loadHubConfig, resolveProjectRoot } from "../shared/env.js";
import { RealtimeHubServer } from "./server.js";

async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const config = loadHubConfig(projectRoot);
  fs.mkdirSync(config.artifactsRoot, { recursive: true });
  const server = new RealtimeHubServer(config);
  await server.start();
  console.log(`TS hub listening on ws://${config.bindHost}:${config.port}/`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

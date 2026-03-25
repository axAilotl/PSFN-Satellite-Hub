import { loadPiClientConfig, resolveProjectRoot } from "../shared/env.js";
import { PiRealtimeClient } from "./client.js";

function main(): void {
  const config = loadPiClientConfig(resolveProjectRoot());
  const client = new PiRealtimeClient(config);
  client.start();
  console.log(`TS Pi client connecting to ${config.hubUrl}`);
}

main();

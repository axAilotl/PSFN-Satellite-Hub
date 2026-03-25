import fs from "node:fs";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import WebSocket from "ws";

const pcmPath = process.argv[2] || ".artifacts/runtime/20260321/162306_session-5711889f82c6/audio.pcm";
const wsUrl = process.argv[3] || "ws://127.0.0.1:8787/";

const pcm = fs.readFileSync(pcmPath);
const chunks = [];
for (let index = 0; index < pcm.length; index += 2048) {
  chunks.push(pcm.subarray(index, index + 2048));
}

const socket = new WebSocket(wsUrl);
let transcript = "";
let assistantText = "";
let audioChunks = 0;
let sent = false;
const startedAt = Date.now();

const timeout = setTimeout(() => {
  console.error("smoke timeout");
  socket.close();
  process.exit(1);
}, 45000);

socket.on("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    deviceId: "smoke-test",
    deviceName: "Smoke Test Client",
  }));
});

socket.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.type === "hello.ack" && !sent) {
    sent = true;
    void (async () => {
      socket.send(JSON.stringify({ type: "turn.start" }));
      for (const chunk of chunks) {
        socket.send(JSON.stringify({
          type: "audio",
          audio: chunk.toString("base64"),
        }));
        await delay(64);
      }
      socket.send(JSON.stringify({ type: "turn.end", reason: "smoke_test" }));
    })();
    return;
  }
  if (message.type === "transcript.final") {
    transcript = message.text;
    return;
  }
  if (message.type === "assistant.text") {
    assistantText += message.delta;
    return;
  }
  if (message.type === "assistant.audio.chunk") {
    audioChunks += 1;
    return;
  }
  if (message.type === "assistant.end") {
    clearTimeout(timeout);
    console.log(JSON.stringify({
      transcript,
      assistantText: assistantText.trim(),
      audioChunks,
      elapsedMs: Date.now() - startedAt,
    }, null, 2));
    socket.close();
    return;
  }
  if (message.type === "error") {
    clearTimeout(timeout);
    console.error(JSON.stringify(message, null, 2));
    socket.close();
    process.exit(1);
  }
});

socket.on("close", () => {
  clearTimeout(timeout);
  process.exit();
});

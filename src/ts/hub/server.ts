import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import WebSocket, { WebSocketServer } from "ws";

import { AsyncQueue } from "../shared/async-queue.js";
import type { HubConfig } from "../shared/env.js";
import {
  decodeAudioChunk,
  encodeAudioChunk,
  type ClientToHubMessage,
  type HubToClientMessage,
} from "../shared/protocol.js";
import { appendEvent, appendPcm, createArtifactTurn, finalizeWav, writeJson, type ArtifactTurn } from "./artifacts.js";
import { DeepgramLiveTurn } from "./deepgram-live.js";
import { ElevenLabsStream } from "./elevenlabs-stream.js";
import { HermesModelAdapter } from "./hermes-model.js";
import { SessionStore } from "./session-store.js";

export class RealtimeHubServer {
  private readonly httpServer = http.createServer((_, response) => {
    response.statusCode = 200;
    response.end("opanhome-ts-hub\n");
  });

  private readonly wsServer = new WebSocketServer({ server: this.httpServer });
  private readonly sessions: SessionStore;
  private readonly agent: HermesModelAdapter;
  private readonly tts: ElevenLabsStream;

  constructor(private readonly config: HubConfig) {
    this.sessions = new SessionStore(config.sessionTtlSeconds);
    this.agent = new HermesModelAdapter(config.hermes);
    this.tts = new ElevenLabsStream(
      config.elevenlabsApiKey,
      config.elevenlabsModelId,
      config.elevenlabsVoiceId || "pNInz6obpgDQGcFmaJgB",
    );
  }

  async start(): Promise<void> {
    this.wsServer.on("connection", (socket) => {
      const connection = new RealtimeConnection(socket, this.config, this.sessions, this.agent, this.tts);
      connection.run().catch((error) => {
        console.error("Realtime connection failed:", error);
      });
    });

    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.config.port, this.config.bindHost, () => resolve());
    });
  }

  async close(): Promise<void> {
    await this.tts.close();
    await new Promise<void>((resolve, reject) => {
      this.wsServer.close((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

class RealtimeConnection {
  private deviceId = `client-${Math.random().toString(16).slice(2, 10)}`;
  private deviceName = "Opanhome TS Client";
  private sessionId = `realtime:${this.deviceId}`;
  private activeTurn: ArtifactTurn | null = null;
  private sttTurn: DeepgramLiveTurn | null = null;
  private replyAbort = false;
  private messageChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly socket: WebSocket,
    private readonly config: HubConfig,
    private readonly sessions: SessionStore,
    private readonly agent: HermesModelAdapter,
    private readonly tts: ElevenLabsStream,
  ) {}

  async run(): Promise<void> {
    console.log("Realtime client connected");
    await this.send({
      type: "session.ready",
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      audioFormat: "pcm_s16le_16000_mono_in/mp3_44100_out",
    });

    this.socket.on("message", (raw) => {
      if (typeof raw !== "string" && !(raw instanceof Buffer)) {
        return;
      }
      const payload = JSON.parse(String(raw)) as ClientToHubMessage;
      this.messageChain = this.messageChain
        .then(() => this.handleMessage(payload))
        .catch((error) => {
          console.error("Realtime message handling failed:", error);
        });
    });
    this.socket.on("close", () => {
      void this.cleanup();
    });
  }

  private async handleMessage(message: ClientToHubMessage): Promise<void> {
    switch (message.type) {
      case "hello":
        this.deviceId = message.deviceId;
        this.deviceName = message.deviceName;
        this.sessionId = message.sessionId?.trim() || `realtime:${this.deviceId}`;
        this.sessions.touch(this.sessionId);
        console.log(`hello device=${this.deviceId} session=${this.sessionId}`);
        await this.send({
          type: "hello.ack",
          sessionId: this.sessionId,
          deviceId: this.deviceId,
          deviceName: this.deviceName,
        });
        return;
      case "ping":
        await this.send({ type: "pong", sentAt: message.sentAt });
        return;
      case "interrupt":
        await this.cancelReply("client_interrupt");
        await this.send({ type: "assistant.interrupted", sessionId: this.sessionId });
        return;
      case "turn.start":
        await this.startTurn();
        return;
      case "audio":
        await this.handleAudio(decodeAudioChunk(message.audio));
        return;
      case "turn.end":
        await this.finishTurn(message.reason);
        return;
      default:
        await this.send({ type: "error", message: `Unsupported message type: ${String((message as { type?: string }).type || "")}` });
    }
  }

  private async startTurn(): Promise<void> {
    await this.cancelReply("new_turn");
    await this.cleanupActiveTurn();
    const turn = createArtifactTurn(this.config.artifactsRoot, this.sessionId);
    this.activeTurn = turn;
    appendEvent(turn, "start", {
      sessionId: this.sessionId,
      turnId: turn.turnId,
    });
    this.sttTurn = new DeepgramLiveTurn(this.config.deepgramApiKey, 16000);
    await this.sttTurn.start();
    await this.send({
      type: "turn.started",
      sessionId: this.sessionId,
      turnId: turn.turnId,
    });
  }

  private async handleAudio(chunk: Buffer): Promise<void> {
    if (!this.activeTurn || !this.sttTurn || chunk.length === 0) {
      return;
    }
    appendPcm(this.activeTurn, chunk);
    this.sttTurn.sendAudio(chunk);
  }

  private async finishTurn(reason: string): Promise<void> {
    const turn = this.activeTurn;
    const sttTurn = this.sttTurn;
    this.activeTurn = null;
    this.sttTurn = null;
    if (!turn || !sttTurn) {
      return;
    }
    const transcript = await sttTurn.finish();
    finalizeWav(turn);
    appendEvent(turn, "stop", {
      reason,
      bytesReceived: turn.bytesReceived,
      chunks: turn.chunks,
    });
    appendEvent(turn, "transcript", transcript);
    writeJson(turn.transcriptPath, transcript);
    console.log(`transcript turn=${turn.turnId} latency_ms=${transcript.latencyMs} text=${JSON.stringify(transcript.text)}`);
    await this.send({
      type: "transcript.final",
      sessionId: this.sessionId,
      turnId: turn.turnId,
      text: transcript.text,
      latencyMs: transcript.latencyMs,
      provider: transcript.provider,
    });
    if (!transcript.text.trim()) {
      writeJson(turn.replyPath, {
        sessionId: this.sessionId,
        turnId: turn.turnId,
        status: "no_input",
        reason,
      });
      await this.send({
        type: "turn.no_input",
        sessionId: this.sessionId,
        turnId: turn.turnId,
        reason,
      });
      return;
    }
    this.sessions.append(this.sessionId, { role: "user", content: transcript.text });
    await this.runReply(turn, transcript.text, reason);
  }

  private async runReply(turn: ArtifactTurn, transcript: string, reason: string): Promise<void> {
    this.replyAbort = false;
    let responseText = "";
    const textQueue = new AsyncQueue<string>();
    await this.send({
      type: "assistant.start",
      sessionId: this.sessionId,
      turnId: turn.turnId,
    });

    const audioTask = (async () => {
      let started = false;
      for await (const audioChunk of this.tts.streamText(textQueue)) {
        if (this.replyAbort) {
          break;
        }
        if (!started) {
          started = true;
          await this.send({
            type: "assistant.audio.start",
            sessionId: this.sessionId,
            turnId: turn.turnId,
            mimeType: "audio/mpeg",
          });
        }
        await this.send({
          type: "assistant.audio.chunk",
          sessionId: this.sessionId,
          turnId: turn.turnId,
          audio: encodeAudioChunk(audioChunk),
        });
      }
      if (started) {
        await this.send({
          type: "assistant.audio.end",
          sessionId: this.sessionId,
          turnId: turn.turnId,
        });
      }
    })();

    try {
      const history = this.sessions.getHistory(this.sessionId);
      const stream = this.agent.streamReply({ history, userText: transcript });
      for await (const delta of stream) {
        if (this.replyAbort) {
          break;
        }
        responseText += delta;
        textQueue.push(delta);
        await this.send({
          type: "assistant.text",
          sessionId: this.sessionId,
          turnId: turn.turnId,
          delta,
        });
      }
      textQueue.close();
      await audioTask;

      if (this.replyAbort) {
        await this.send({ type: "assistant.interrupted", sessionId: this.sessionId });
        return;
      }

      responseText = responseText.trim();
      this.sessions.append(this.sessionId, { role: "assistant", content: responseText });
      appendEvent(turn, "reply", { text: responseText });
      console.log(`reply turn=${turn.turnId} text=${JSON.stringify(responseText)}`);
      writeJson(turn.replyPath, {
        sessionId: this.sessionId,
        turnId: turn.turnId,
        transcript,
        response: responseText,
        reason,
      });
      await this.send({
        type: "assistant.end",
        sessionId: this.sessionId,
        turnId: turn.turnId,
        text: responseText,
      });
    } catch (error) {
      textQueue.close();
      await audioTask.catch(() => undefined);
      writeJson(turn.replyPath, {
        sessionId: this.sessionId,
        turnId: turn.turnId,
        transcript,
        error: String(error),
      });
      await this.send({ type: "error", message: String(error) });
    }
  }

  private async cancelReply(reason: string): Promise<void> {
    this.replyAbort = true;
    if (reason && this.activeTurn) {
      appendEvent(this.activeTurn, "reply.cancel", { reason });
    }
  }

  private async cleanupActiveTurn(): Promise<void> {
    if (this.sttTurn) {
      await this.sttTurn.abort();
      this.sttTurn = null;
    }
    this.activeTurn = null;
  }

  private async cleanup(): Promise<void> {
    await this.cancelReply("connection_closed");
    await this.cleanupActiveTurn();
  }

  private async send(message: HubToClientMessage): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }
}

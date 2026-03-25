import { setTimeout as delay } from "node:timers/promises";

import WebSocket from "ws";

export interface TranscriptResult {
  text: string;
  provider: string;
  latencyMs: number;
}

export class DeepgramLiveTurn {
  private ws: WebSocket | null = null;
  private startedAt = Date.now();
  private readonly finalSegments: string[] = [];
  private interimText = "";
  private finalizeRequested = false;
  private readonly finalizeWaiters: Array<() => void> = [];
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private lastSendAt = Date.now();

  constructor(
    private readonly apiKey: string,
    private readonly sampleRate: number,
    private readonly model = "nova-3",
  ) {}

  async start(): Promise<void> {
    this.startedAt = Date.now();
    const url =
      "wss://api.deepgram.com/v1/listen" +
      `?model=${encodeURIComponent(this.model)}` +
      "&encoding=linear16" +
      `&sample_rate=${this.sampleRate}` +
      "&channels=1" +
      "&interim_results=true" +
      "&endpointing=300" +
      "&utterance_end_ms=1000" +
      "&vad_events=true" +
      "&smart_format=true";
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });
    this.ws.on("message", (data) => this.handleMessage(String(data)));
    await waitForOpen(this.ws);
    this.keepAliveTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      if ((Date.now() - this.lastSendAt) < 8000) {
        return;
      }
      this.ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 8000);
  }

  sendAudio(chunk: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || chunk.length === 0) {
      return;
    }
    this.ws.send(chunk);
    this.lastSendAt = Date.now();
  }

  async finish(): Promise<TranscriptResult> {
    if (!this.ws) {
      return { text: "", provider: "deepgram-live", latencyMs: 0 };
    }
    this.finalizeRequested = true;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "Finalize" }));
      this.lastSendAt = Date.now();
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        this.finalizeWaiters.push(resolve);
      }),
      delay(2500).then(() => undefined),
    ]);
    const text = (this.finalSegments.join(" ").trim() || this.interimText.trim());
    await this.close();
    return {
      text,
      provider: "deepgram-live",
      latencyMs: Date.now() - this.startedAt,
    };
  }

  async abort(): Promise<void> {
    await this.close();
  }

  private handleMessage(raw: string): void {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const type = String(payload.type || "");
    if (type === "UtteranceEnd") {
      this.resolveFinalize();
      return;
    }
    if (type !== "Results") {
      return;
    }
    const channel = (payload.channel || {}) as Record<string, unknown>;
    const alternatives = (channel.alternatives || []) as Array<Record<string, unknown>>;
    const transcript = String(alternatives[0]?.transcript || "").trim();
    if (transcript) {
      if (payload.is_final) {
        if (this.finalSegments[this.finalSegments.length - 1] !== transcript) {
          this.finalSegments.push(transcript);
        }
      } else {
        this.interimText = transcript;
      }
    }
    if (this.finalizeRequested && (payload.speech_final || payload.from_finalize)) {
      this.resolveFinalize();
    }
  }

  private resolveFinalize(): void {
    while (this.finalizeWaiters.length > 0) {
      this.finalizeWaiters.shift()?.();
    }
  }

  private async close(): Promise<void> {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (!ws) {
      return;
    }
    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      ws.once("close", () => resolve());
      ws.close();
    });
  }
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (error) => reject(error));
  });
}

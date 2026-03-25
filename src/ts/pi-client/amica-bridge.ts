import { Buffer } from "node:buffer";

import type { AmicaBridgeConfig } from "../shared/env.js";

interface SatelliteBridgeSessionEventData {
  sessionId: string;
}

interface SatelliteUserFinalEvent {
  type: "user.final";
  data: SatelliteBridgeSessionEventData & {
    text: string;
  };
}

interface SatelliteAssistantFinalEvent {
  type: "assistant.final";
  data: SatelliteBridgeSessionEventData & {
    text: string;
    audioBase64: string;
    mimeType: string;
    durationMs?: number;
  };
}

interface SatelliteInterruptEvent {
  type: "interrupt";
  data: SatelliteBridgeSessionEventData;
}

type SatelliteBridgeEvent =
  | SatelliteUserFinalEvent
  | SatelliteAssistantFinalEvent
  | SatelliteInterruptEvent;

export class AmicaBridge {
  private readonly endpointUrl: URL;
  private sessionId: string | null = null;
  private assistantAudioChunks: Buffer[] = [];
  private assistantAudioBytes = 0;

  constructor(private readonly config: AmicaBridgeConfig) {
    this.endpointUrl = new URL(config.endpointUrl);
  }

  isOwnerMode(): boolean {
    return this.config.ownerMode;
  }

  setSessionId(sessionId: string | null | undefined): void {
    const normalized = sessionId?.trim() ?? "";
    this.sessionId = normalized ? normalized : null;
  }

  clearAssistantTurn(): void {
    this.assistantAudioChunks = [];
    this.assistantAudioBytes = 0;
  }

  recordAssistantAudio(chunk: Buffer): void {
    if (chunk.length === 0) {
      return;
    }
    this.assistantAudioChunks.push(Buffer.from(chunk));
    this.assistantAudioBytes += chunk.length;
  }

  estimateAssistantAudioDurationMs(): number {
    return Math.max(0, Math.round(this.assistantAudioBytes / 16));
  }

  async postUserFinal(text: string): Promise<void> {
    const normalized = text.trim();
    if (!normalized) {
      throw new Error("Amica bridge user text is empty");
    }
    await this.postEvent({
      type: "user.final",
      data: {
        sessionId: this.requireSessionId(),
        text: normalized,
      },
    });
  }

  async postAssistantFinal(text: string): Promise<number> {
    const normalized = text.trim();
    if (!normalized) {
      throw new Error("Amica bridge assistant text is empty");
    }
    if (this.assistantAudioBytes === 0) {
      throw new Error("Amica bridge assistant audio is empty");
    }

    const durationMs = this.estimateAssistantAudioDurationMs();
    const audioBase64 = Buffer.concat(this.assistantAudioChunks).toString("base64");

    try {
      await this.postEvent({
        type: "assistant.final",
        data: {
          sessionId: this.requireSessionId(),
          text: normalized,
          audioBase64,
          mimeType: "audio/mpeg",
          durationMs: durationMs > 0 ? durationMs : undefined,
        },
      });
      return durationMs;
    } finally {
      this.clearAssistantTurn();
    }
  }

  async postInterrupt(): Promise<void> {
    await this.postEvent({
      type: "interrupt",
      data: {
        sessionId: this.requireSessionId(),
      },
    });
    this.clearAssistantTurn();
  }

  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error("Amica bridge session ID is not available yet");
    }
    return this.sessionId;
  }

  private async postEvent(event: SatelliteBridgeEvent): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(this.endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Amica-Bridge-Token": this.config.token,
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await formatError(response));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function formatError(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  if (body) {
    return `Amica bridge request failed (${response.status}): ${body}`;
  }
  return `Amica bridge request failed (${response.status})`;
}
